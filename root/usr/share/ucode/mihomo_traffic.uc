// mihomo_traffic：采集脚本、命令行汇总与 rpcd 接口共用的常量和查询逻辑。
// 数据行格式：hour \t src \t node \t host \t upload \t download，hour 形如 2026-10-05 13。

'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';

// 环境变量只给测试用，正常运行都走默认路径
export const DATA_DIR = getenv('MIHOMO_TRAFFIC_DATA') ?? '/etc/mihomo-traffic';
export const CUR_FILE = getenv('MIHOMO_TRAFFIC_CUR') ?? '/tmp/mihomo-traffic.cur';
export const KEEP_DAYS = 30;

// Inner 连接（链式代理承载、DoH 等）与设备连接是同一份流量，统计合计时剔除
export const INNER = '(内部)';

const FIELDS = ['src', 'node', 'host'];

export function hour_of(t) {
	let l = localtime(t);
	return sprintf('%04d-%02d-%02d %02d', l.year, l.mon, l.mday, l.hour);
};

// IP → 主机名：DHCP 静态分配优先，再用动态租约补齐
export function host_names() {
	let names = {};
	for (let line in split(fs.readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		let f = split(line, ' ');
		if (length(f) >= 4 && f[3] != '*')
			names[f[2]] = f[3];
	}
	cursor().foreach('dhcp', 'host', (s) => {
		if (s.ip && s.name)
			names[s.ip] = s.name;
	});
	return names;
};

export const OTHERS = '其他';

const TOP_SERIES = 6;	// 趋势图每个维度最多分几条序列，其余并入「其他」
const TOP_LIST = 10;	// 各维度排行
const TOP_LINKS = 30;	// 设备 → 出口节点的流向

// 超过这个小时数就按天聚合：已结束的日子读日汇总文件，趋势图也按天出柱
export const HOURLY_MAX = 72;
export const SMALL = '(小流量)';
const SMALL_BYTES = 1e6;	// 日汇总里，单日不足 1MB 的目标并入同设备同节点的 SMALL 行

function read_tsv(path, cb) {
	for (let line in split(fs.readfile(path) ?? '', '\n')) {
		let f = split(line, '\t');
		if (length(f) >= 5)
			cb(f);
	}
}

// 已结束那一天的日汇总：src \t node \t host \t up \t down。按需生成，原始 tsv 更新过就重建
function day_rows(day) {
	let tsv = `${DATA_DIR}/${day}.tsv`, sum = `${DATA_DIR}/${day}.day`;
	let rows = [];
	if ((fs.stat(sum)?.mtime ?? -1) >= (fs.stat(tsv)?.mtime ?? 0)) {
		read_tsv(sum, (f) => push(rows, [day, f[0], f[1], f[2], f[3], f[4]]));
		return rows;
	}

	let agg = {};
	read_tsv(tsv, (f) => {
		if (length(f) != 6)
			return;
		let k = `${f[1]}\t${f[2]}\t${f[3]}`;
		let a = agg[k];
		if (a) { a[0] += +f[4]; a[1] += +f[5]; } else agg[k] = [+f[4], +f[5]];
	});
	let kept = {};
	for (let k, a in agg) {
		if (a[0] + a[1] >= SMALL_BYTES) {
			kept[k] = a;
			continue;
		}
		let p = split(k, '\t');
		let sk = `${p[0]}\t${p[1]}\t${SMALL}`;
		let b = kept[sk] ??= [0, 0];
		b[0] += a[0]; b[1] += a[1];
	}

	let out = '';
	for (let k, a in kept) {
		out += sprintf('%s\t%d\t%d\n', k, a[0], a[1]);
		let p = split(k, '\t');
		push(rows, [day, p[0], p[1], p[2], a[0], a[1]]);
	}
	fs.writefile(`${sum}.tmp`, out);
	fs.rename(`${sum}.tmp`, sum);
	return rows;
}

// 读出查询范围内的全部记录（含当前小时快照），每条为 [时段, src, node, host, up, down]
// 时段按小时（hours <= HOURLY_MAX）或按天；返回 since、first（不论过滤条件，范围内最早有数据的时段）、step 和 rows
function load_rows(hours) {
	let daily = hours > HOURLY_MAX;
	let since = hour_of(time() - hours * 3600);
	let today = substr(hour_of(time()), 0, 10);
	if (daily)
		since = substr(since, 0, 10);

	let rows = [];
	for (let name in sort(fs.lsdir(DATA_DIR) ?? [])) {
		let m = match(name, /^(\d{4}-\d{2}-\d{2})\.tsv$/);
		if (!m || m[1] < substr(since, 0, 10))
			continue;
		if (daily && m[1] < today)
			push(rows, ...day_rows(m[1]));
		else
			read_tsv(`${DATA_DIR}/${name}`, (f) => {
				if (length(f) == 6 && f[0] >= since)
					push(rows, daily ? [m[1], f[1], f[2], f[3], f[4], f[5]] : f);
			});
	}
	let cur = json(fs.readfile(CUR_FILE) ?? 'null');
	let cur_bucket = cur?.hour ? (daily ? substr(cur.hour, 0, 10) : cur.hour) : null;
	for (let k, v in cur?.agg ?? {}) {
		let f = split(k, '\t');
		push(rows, [cur_bucket, f[0], f[1], f[2], v[0], v[1]]);
	}
	// 不假设文件内按时间排序，取最早的时段作为趋势图起点
	let first = cur_bucket;
	for (let r in rows)
		if (first == null || r[0] < first)
			first = r[0];
	return { since, first, step: daily ? 'day' : 'hour', rows };
}

// 从 first 到现在的连续时段序列：没有流量（或采集停了）的时段也占位，图表时间轴才不会跳
function bucket_range(first, step) {
	let m = first ? match(first, /^([0-9]+)-([0-9]+)-([0-9]+)( ([0-9]+))?$/) : null;
	if (!m)
		return [];
	let out = [];
	let t = timelocal({ year: +m[1], mon: +m[2], mday: +m[3], hour: +(m[5] ?? 0), min: 0, sec: 0 });
	for (let seen = {}; t <= time(); t += 3600) {
		let b = step == 'day' ? substr(hour_of(t), 0, 10) : hour_of(t);
		if (!seen[b]) {
			seen[b] = true;
			push(out, b);
		}
	}
	return out;
}

function by_total(m) {
	return sort(keys(m), (a, b) => (m[b][0] + m[b][1]) - (m[a][0] + m[a][1]));
}

// 汇总：dims 是 src/node/host 的组合；where 按字段精确匹配；limit 限制返回行数（按合计降序）
// 除表格行外，同一遍扫描里顺带算出图表要的趋势、排行和流向；这些都不含 (内部) 行
export function query(hours, dims, where, limit) {
	hours = +(hours ?? 24) || 24;
	dims = filter(dims ?? ['src'], (d) => d in FIELDS);
	if (!length(dims))
		dims = ['src'];
	where ??= {};

	let total = {}, hourly = {}, sum = [0, 0], links = {};
	let by = { src: {}, node: {}, host: {} };
	let by_hour = { src: {}, node: {} };
	let by_src = by.src, by_node = by.node, by_host = by.host;
	let bh_src = by_hour.src, bh_node = by_hour.node;

	// 30 天约 50 万行，这里是热点：字段按下标取、过滤条件提前展开，避免每行建临时对象
	let col = { src: 1, node: 2, host: 3 };
	let w_src = where.src, w_node = where.node, w_host = where.host;
	let k1 = col[dims[0]], k2 = col[dims[1]], k3 = col[dims[2]];

	let r = load_rows(hours);
	for (let f in r.rows) {
		let src = f[1], node = f[2], host = f[3];
		if ((w_src != null && src != w_src) || (w_node != null && node != w_node) || (w_host != null && host != w_host))
			continue;

		let up = +f[4], down = +f[5], bytes = up + down;
		let key = k3 ? `${f[k1]}\t${f[k2]}\t${f[k3]}` : k2 ? `${f[k1]}\t${f[k2]}` : f[k1];
		let t = total[key];
		if (t) { t[0] += up; t[1] += down; } else total[key] = [up, down];

		if (src == INNER)
			continue;

		sum[0] += up; sum[1] += down;
		let hour = f[0];
		let h = hourly[hour];
		if (h) { h[0] += up; h[1] += down; } else hourly[hour] = [up, down];

		let b = by_src[src];
		if (b) { b[0] += up; b[1] += down; } else by_src[src] = [up, down];
		b = by_node[node];
		if (b) { b[0] += up; b[1] += down; } else by_node[node] = [up, down];
		b = by_host[host];
		if (b) { b[0] += up; b[1] += down; } else by_host[host] = [up, down];

		let bh = bh_src[hour] ??= {};
		bh[src] = (bh[src] ?? 0) + bytes;
		bh = bh_node[hour] ??= {};
		bh[node] = (bh[node] ?? 0) + bytes;

		let l = `${src}\t${node}`;
		links[l] = (links[l] ?? 0) + bytes;
	}

	let keys_sorted = by_total(total);
	let rows = map(slice(keys_sorted, 0, limit ?? length(keys_sorted)), (k) => {
		let row = { up: total[k][0], down: total[k][1] };
		let v = split(k, '\t');
		for (let i, d in dims)
			row[d] = v[i];
		return row;
	});

	let hours_list = bucket_range(r.first > r.since ? r.first : r.since, r.step);

	let series = {};
	for (let d in ['src', 'node']) {
		let names = slice(by_total(by[d]), 0, TOP_SERIES);
		let others = length(by[d]) > TOP_SERIES;
		series[d] = {
			names: others ? [ ...names, OTHERS ] : names,
			data: map(hours_list, (h) => {
				let bh = by_hour[d][h] ?? {}, rest = 0;
				for (let k, v in bh)
					if (!(k in names))
						rest += v;
				let vals = map(names, (k) => bh[k] ?? 0);
				if (others)
					push(vals, rest);
				return vals;
			})
		};
	}

	let top = {};
	for (let d in FIELDS)
		top[d] = map(slice(by_total(by[d]), 0, TOP_LIST), (k) => [k, by[d][k][0], by[d][k][1]]);

	return {
		since: r.since, step: r.step, hours, dims, rows,
		count: length(keys_sorted),
		up: sum[0], down: sum[1],
		devices: length(by.src),
		hourly: map(hours_list, (h) => [h, hourly[h]?.[0] ?? 0, hourly[h]?.[1] ?? 0]),
		series, top,
		links: map(slice(sort(keys(links), (a, b) => links[b] - links[a]), 0, TOP_LINKS), (k) => [...split(k, '\t'), links[k]])
	};
};

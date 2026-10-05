// 生成演示数据：虚构的设备、节点和目标，按作息生成最近 8 天的小时数据、当前小时快照和 DHCP 租约。
// 只用于截图和本地演示，不要在真实路由器上跑（会覆盖已有数据）。
//   MIHOMO_TRAFFIC_DATA=/etc/mihomo-traffic ucode -L /usr/share/ucode tests/demo-data.uc

'use strict';

import * as fs from 'fs';
import { DATA_DIR, CUR_FILE, INNER, SMALL, hour_of } from 'mihomo_traffic';

const HK = '🇭🇰 香港 01', JP = '🇯🇵 日本 02', US = '🇺🇸 美国 03', SG = '🇸🇬 新加坡 01', D = 'DIRECT';
const GB = 1e9, MB = 1e6;

// [IP, 主机名, MAC, [[目标, 节点, 每小时基准字节, 上传占比], ...], 作息]
const DEVICES = [
	[ '192.168.1.10', 'MacBook-Pro', 'a4:83:e7:10:00:01', [
		[ 'github.com', HK, 180 * MB, 0.25 ], [ 'chatgpt.com', US, 260 * MB, 0.35 ], [ 'api.openai.com', US, 150 * MB, 0.55 ],
		[ 'www.google.com', HK, 40 * MB, 0.1 ], [ 'objects.githubusercontent.com', HK, 220 * MB, 0.02 ],
		[ 'registry.npmjs.org', HK, 90 * MB, 0.03 ], [ 'www.bilibili.com', D, 60 * MB, 0.05 ], [ 'gateway.icloud.com', D, 70 * MB, 0.6 ]
	], 'work' ],
	[ '192.168.1.11', 'iPhone-15', 'a4:83:e7:10:00:02', [
		[ 'rr3---sn-oguesn6r.googlevideo.com', JP, 320 * MB, 0.02 ], [ 'x.com', US, 60 * MB, 0.08 ], [ 'scontent.cdninstagram.com', HK, 120 * MB, 0.03 ],
		[ 'weixin.qq.com', D, 50 * MB, 0.2 ], [ 'm.taobao.com', D, 45 * MB, 0.05 ], [ 'mesu.apple.com', D, 30 * MB, 0.01 ]
	], 'evening' ],
	[ '192.168.1.12', 'iPad-Air', 'a4:83:e7:10:00:03', [
		[ 'ipv4-c001-sin001-ix.1.oca.nflxvideo.net', SG, 520 * MB, 0.01 ], [ 'www.youtube.com', JP, 80 * MB, 0.02 ]
	], 'evening' ],
	[ '192.168.1.20', 'Living-Room-TV', '5c:aa:fd:20:00:01', [
		[ 'ipv4-c002-sin001-ix.1.oca.nflxvideo.net', SG, 1.4 * GB, 0.01 ], [ 'rr5---sn-oguelnsy.googlevideo.com', JP, 900 * MB, 0.01 ],
		[ 'upos-sz-mirrorcos.bilivideo.com', D, 600 * MB, 0.01 ]
	], 'tv' ],
	[ '192.168.1.30', 'Gaming-PC', '2c:f0:5d:30:00:01', [
		[ 'cache1-hkg1.steamcontent.com', D, 1.8 * GB, 0.01 ], [ 'discord.com', HK, 40 * MB, 0.3 ], [ 'gateway.discord.gg', HK, 25 * MB, 0.4 ]
	], 'game' ],
	[ '192.168.1.40', 'NAS', '00:11:32:40:00:01', [
		[ 'backup-bucket.s3.us-west-2.amazonaws.com', US, 2.2 * GB, 0.97 ], [ 'registry-1.docker.io', HK, 300 * MB, 0.02 ],
		[ 'github.com', HK, 40 * MB, 0.05 ]
	], 'night' ],
	[ '192.168.1.50', 'Pixel-8', '3c:28:6d:50:00:01', [
		[ 'rr1---sn-oguesnzd.googlevideo.com', JP, 200 * MB, 0.02 ], [ 'play.googleapis.com', HK, 80 * MB, 0.02 ]
	], 'evening' ],
	[ '192.168.1.60', 'Xiaomi-Camera', '78:11:dc:60:00:01', [
		[ 'business.smartcamera.api.io.mi.com', D, 45 * MB, 0.95 ]
	], 'flat' ],
	[ '192.168.1.61', 'Smart-Speaker', '78:11:dc:61:00:01', [
		[ 'api.io.mi.com', D, 4 * MB, 0.5 ]
	], 'flat' ]
];

// 各类作息下每小时的活跃系数（0–23 时）
const PROFILE = {
	work:    [ 0.05, 0.02, 0.02, 0.02, 0.02, 0.02, 0.05, 0.2, 0.5, 1, 1, 0.9, 0.6, 0.9, 1, 1, 0.9, 0.8, 0.5, 0.6, 0.7, 0.6, 0.4, 0.15 ],
	evening: [ 0.3, 0.1, 0.03, 0.02, 0.02, 0.02, 0.1, 0.4, 0.5, 0.3, 0.3, 0.4, 0.6, 0.4, 0.3, 0.3, 0.4, 0.6, 0.8, 1, 1, 0.9, 0.8, 0.6 ],
	tv:      [ 0.1, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.05, 0.05, 0.1, 0.2, 0.1, 0.05, 0.05, 0.1, 0.2, 0.5, 0.9, 1, 1, 0.8, 0.4 ],
	game:    [ 0.3, 0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.1, 0, 0, 0.1, 0.2, 0.3, 0.7, 1, 1, 0.9, 0.6 ],
	night:   [ 0.3, 0.8, 1, 1, 0.9, 0.4, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.1, 0.2 ],
	flat:    [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ]
};

// 可复现的伪随机数，每次生成的数据一样
let seed = 20261005;
function rnd() {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed / 2147483648.0;	// 整数相除在 ucode 里是整除
}

function hour_rows(t) {
	let hour = hour_of(t), h = localtime(t).hour;
	let wday = localtime(t).wday;
	let weekend = wday == 0 || wday == 6;
	let agg = {};
	for (let dev in DEVICES) {
		let ip = dev[0], targets = dev[3], profile = dev[4];
		let p = PROFILE[profile][h];
		if (weekend && profile == 'work') p *= 0.3;
		if (weekend && (profile == 'tv' || profile == 'game')) p = p * 1.3 + 0.2;
		for (let tg in targets) {
			let host = tg[0], node = tg[1], base = tg[2], upr = tg[3];
			let bytes = int(base * p * (0.4 + rnd() * 1.2));
			if (bytes < 1)
				continue;
			agg[`${ip}\t${node}\t${host}`] = [ int(bytes * upr), int(bytes * (1 - upr)) ];
		}
		// 长尾小流量
		let small = int(3 * MB * (0.2 + p) * rnd());
		agg[`${ip}\t${targets[0][1]}\t${SMALL}`] = [ int(small * 0.3), int(small * 0.7) ];
	}
	// 链式代理的承载连接与 DoH
	agg[`${INNER}\t${US}\tus-03.example.net`] = [ int(300 * MB * rnd()), int(500 * MB * rnd()) ];
	agg[`${INNER}\t${D}\tdns.alidns.com`] = [ int(2 * MB * rnd()), int(4 * MB * rnd()) ];
	return { hour, agg };
}

fs.mkdir(DATA_DIR);
for (let name in fs.lsdir(DATA_DIR) ?? [])
	fs.unlink(`${DATA_DIR}/${name}`);

let now = time();
let start = now - 8 * 86400;
start -= start % 3600;
let files = {};
for (let t = start; t < now - now % 3600; t += 3600) {
	let r = hour_rows(t);
	let day = substr(r.hour, 0, 10);
	for (let k, v in r.agg)
		files[day] = (files[day] ?? '') + sprintf('%s\t%s\t%d\t%d\n', r.hour, k, v[0], v[1]);
}
for (let day, text in files)
	fs.writefile(`${DATA_DIR}/${day}.tsv`, text);

// 当前小时按已过去的分钟数折算
let cur = hour_rows(now);
let frac = localtime(now).min / 60 || 0.05;
for (let k, v in cur.agg)
	cur.agg[k] = [ int(v[0] * frac), int(v[1] * frac) ];
fs.writefile(CUR_FILE, sprintf('%J', cur));

let leases = '';
for (let dev in DEVICES)
	leases += sprintf('%d %s %s %s *\n', now + 43200, dev[2], dev[0], dev[1]);
fs.writefile('/tmp/dhcp.leases', leases);

print(sprintf('wrote %d day files, current hour %s\n', length(files), cur.hour));

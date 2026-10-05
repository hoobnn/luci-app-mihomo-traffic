#!/bin/sh
# 冒烟测试：在 OpenWrt rootfs 容器里跑（CI 用 openwrt/rootfs 镜像），也可以直接在路由器上跑。
# 检查所有 ucode 文件能编译，并用造好的数据验证：按小时、按天两种查询的合计都等于原始数据之和，
# 日汇总合并小流量后合计不变，(内部) 行不计入合计。
set -eu

src=$(cd "$(dirname "$0")/.." && pwd)
lib="$src/root/usr/share/ucode"

# 共用模块只能以模块方式编译，下面的测试 import 它时就会检查；这里检查两个脚本
for f in "$src/root/usr/bin/mihomo-traffic" "$src/root/usr/share/rpcd/ucode/luci.mihomo-traffic"; do
	ucode -L "$lib" -c -o /dev/null "$f"
	echo "compile ok: ${f#"$src"/}"
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export MIHOMO_TRAFFIC_DATA="$work/data" MIHOMO_TRAFFIC_CUR="$work/cur"
mkdir -p "$MIHOMO_TRAFFIC_DATA"

ucode -L "$lib" -e '
import * as fs from "fs";
import { DATA_DIR, CUR_FILE, INNER, hour_of, query } from "mihomo_traffic";

function fail(msg) { warn(msg, "\n"); exit(1); }
function check(name, got, want) {
	if (got != want) fail(sprintf("FAIL %s: got %J, want %J", name, got, want));
	print(sprintf("ok   %s = %J\n", name, got));
}

let now = time();
let rows = [], recent = [0, 0], all = [0, 0];

// 最近 5 个已归档小时：两台设备、两个出口，夹一条 (内部) 行和若干小流量目标
for (let k = 1; k <= 5; k++) {
	let h = hour_of(now - k * 3600);
	push(rows, [h, "192.168.1.10", "DIRECT", "example.com", 1000000 * k, 2000000 * k]);
	push(rows, [h, "192.168.1.20", "proxy-a", "video.example", 3000000, 9000000]);
	push(rows, [h, "192.168.1.20", "proxy-a", "tiny-" + k + ".example", 100, 200]);
	push(rows, [h, INNER, "proxy-a", "landing.example", 5000000, 5000000]);
}
// 10 天前的一整天：只有按天查询会读到，并触发日汇总
let old = substr(hour_of(now - 10 * 86400), 0, 10);
for (let h = 0; h < 24; h++) {
	push(rows, [sprintf("%s %02d", old, h), "192.168.1.10", "proxy-a", "old.example", 500000, 700000]);
	push(rows, [sprintf("%s %02d", old, h), "192.168.1.10", "proxy-a", "small-" + h + ".example", 10, 20]);
}

let files = {};
for (let r in rows) {
	let day = substr(r[0], 0, 10);
	files[day] = (files[day] ?? "") + join("\t", r) + "\n";
	if (r[1] != INNER) {
		all[0] += r[4]; all[1] += r[5];
		if (substr(r[0], 0, 10) != old) { recent[0] += r[4]; recent[1] += r[5]; }
	}
}
for (let day, text in files)
	fs.writefile(`${DATA_DIR}/${day}.tsv`, text);

// 当前小时的快照
let cur = hour_of(now);
fs.writefile(CUR_FILE, sprintf("%J", { hour: cur, agg: { "192.168.1.10\tDIRECT\tnow.example": [111, 222] } }));
recent[0] += 111; recent[1] += 222; all[0] += 111; all[1] += 222;

let r = query(24, ["src"], null, 200);
check("hourly step", r.step, "hour");
check("hourly up", r.up, recent[0]);
check("hourly down", r.down, recent[1]);
check("hourly buckets", length(r.hourly) >= 6, true);
let bucket_sum = 0;
for (let h in r.hourly) bucket_sum += h[1] + h[2];
check("hourly sum of buckets", bucket_sum, recent[0] + recent[1]);
check("inner row kept in table", length(filter(r.rows, (x) => x.src == INNER)), 1);

let f = query(24, ["host"], { src: "192.168.1.20" }, 200);
check("filtered up", f.up, 5 * (3000000 + 100));

let d = query(720, ["src", "host"], null, 200);
check("daily step", d.step, "day");
check("daily up", d.up, all[0]);
check("daily down", d.down, all[1]);
check("day rollup written", fs.stat(`${DATA_DIR}/${old}.day`) != null, true);
check("small hosts folded", length(filter(d.rows, (x) => match(x.host, /^small-/))), 0);

let d2 = query(720, ["src"], null, 200);
check("daily up from rollup", d2.up, all[0]);
'
echo "all passed"

#!/bin/sh
# 打包前的临时部署：把 root/ 和 htdocs/ 直接拷到路由器，重载 rpcd 和采集服务。
# 用法：scripts/deploy.sh [root@192.168.31.1]
set -eu

host=${1:-root@192.168.31.1}
cd "$(dirname "$0")/.."

# 只打包文件、不打包目录条目，并强制属主为 root：
# 否则 busybox tar 以 root 解包时会把 / /etc /usr 等已有目录的属主改成本机 uid
pack() { (cd "$1" && find . -type f | COPYFILE_DISABLE=1 tar --uid 0 --gid 0 -cf - -T -); }
# 采集逻辑没变就不重启采集：重启会丢掉最多一分钟未落盘的数据
sum_collector='md5sum /usr/bin/mihomo-traffic /usr/share/ucode/mihomo_traffic.uc 2>/dev/null'
before=$(ssh "$host" "$sum_collector")
pack root | ssh "$host" 'tar -xf - -C /'
pack htdocs | ssh "$host" 'tar -xf - -C /www'
after=$(ssh "$host" "$sum_collector")
ssh "$host" '
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
	/etc/init.d/rpcd reload
	/etc/init.d/mihomo-traffic enable
'
if [ "$before" != "$after" ]; then
	ssh "$host" /etc/init.d/mihomo-traffic restart
	echo "collector restarted"
fi
echo "deployed to $host"

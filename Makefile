# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-mihomo-traffic
PKG_VERSION:=0.1.1
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=hoobnn <111053672+hoobnn@users.noreply.github.com>

LUCI_TITLE:=Per-device traffic statistics for mihomo (OpenClash)
LUCI_DESCRIPTION:=Counts traffic by source device, outbound proxy node and destination host \
	from the mihomo /connections API. Works with full-cone NAT where nlbwmon sees nothing.
LUCI_DEPENDS:=+luci-base +rpcd-mod-ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-ubus +curl
LUCI_PKGARCH:=all

# jsmin 不认识模板字符串，会改坏页面脚本；ECharts 也已经是压缩过的
LUCI_MINIFY_JS:=0

# 默认的 postinst 只清 LuCI 缓存、重载 rpcd；升级时还要重启采集进程才会换上新代码
define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload 2>/dev/null
	/etc/init.d/mihomo-traffic enabled && /etc/init.d/mihomo-traffic restart
	exit 0
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

include $(TOPDIR)/rules.mk

PKG_NAME:=toggle-switch-mt3600be
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Louis

include $(INCLUDE_DIR)/package.mk

define Package/toggle-switch
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=GL-MT3600BE 滑动开关控制
  PKGARCH:=all
  # kmod-gpio-button-hotplug  整条事件链的核心，不可去
  # luci-base + ucode-mod-fs + ucode-mod-uci  -> 只服务 LuCI 面板，不要面板可整组去掉
  # ucode-mod-uloop                           -> 只服务 RESET 多击定时器，不要 RESET 可去掉
  DEPENDS:=+luci-base +ucode-mod-fs +ucode-mod-uci +ucode-mod-uloop +kmod-gpio-button-hotplug
endef

define Package/toggle-switch/description
  Interrupt-driven gpio-keys toggle switch controller and LuCI panel for GL-MT3600BE.
endef

define Build/Compile
endef

define Package/toggle-switch/conffiles
/etc/config/mt3600be-toggle
/etc/mt3600be-toggle.d/high
/etc/mt3600be-toggle.d/low
endef

define Package/toggle-switch/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/etc/rc.button $(1)/etc/mt3600be-toggle.d
	$(INSTALL_CONF) ./etc/config/mt3600be-toggle $(1)/etc/config/mt3600be-toggle
	$(INSTALL_BIN) ./etc/init.d/mt3600be-toggle $(1)/etc/init.d/mt3600be-toggle
	$(INSTALL_BIN) ./etc/rc.button/BTN_0 $(1)/etc/rc.button/BTN_0
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./etc/uci-defaults/99-toggle-switch $(1)/etc/uci-defaults/99-toggle-switch
	$(INSTALL_DATA) ./etc/mt3600be-toggle.d/high.example $(1)/etc/mt3600be-toggle.d/high.example
	$(INSTALL_DATA) ./etc/mt3600be-toggle.d/low.example $(1)/etc/mt3600be-toggle.d/low.example
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./usr/sbin/mt3600be-toggle-apply $(1)/usr/sbin/mt3600be-toggle-apply
	$(INSTALL_BIN) ./usr/sbin/mt3600be-toggle-sync $(1)/usr/sbin/mt3600be-toggle-sync
	$(INSTALL_BIN) ./usr/sbin/mt3600be-toggle-wifi $(1)/usr/sbin/mt3600be-toggle-wifi
	$(INSTALL_BIN) ./usr/sbin/mt3600be-toggle-proxy $(1)/usr/sbin/mt3600be-toggle-proxy
	$(INSTALL_BIN) ./usr/sbin/mt3600be-reset-control $(1)/usr/sbin/mt3600be-reset-control
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./usr/libexec/mt3600be-reset-button $(1)/usr/libexec/mt3600be-reset-button
	$(INSTALL_BIN) ./usr/libexec/mt3600be-delay $(1)/usr/libexec/mt3600be-delay
	$(INSTALL_DIR) $(1)/usr/share/ucode/luci/controller $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./usr/share/ucode/luci/controller/toggle.uc $(1)/usr/share/ucode/luci/controller/toggle.uc
	$(INSTALL_DATA) ./usr/share/luci/menu.d/toggle-switch.json $(1)/usr/share/luci/menu.d/toggle-switch.json
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/toggle
	$(INSTALL_DATA) ./www/luci-static/resources/view/toggle/index.js $(1)/www/luci-static/resources/view/toggle/index.js
	$(INSTALL_DATA) ./www/luci-static/resources/view/toggle/index.js $(1)/www/luci-static/resources/view/toggle/index-v100.js
	$(INSTALL_DATA) ./www/luci-static/resources/view/toggle/index.css $(1)/www/luci-static/resources/view/toggle/index.css
endef

define Package/toggle-switch/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/mt3600be-toggle enable
	uci -q get mt3600be-toggle.main.reset_single_enabled >/dev/null || uci set mt3600be-toggle.main.reset_single_enabled='0'
	uci -q get mt3600be-toggle.main.reset_single_action >/dev/null || uci set mt3600be-toggle.main.reset_single_action='wifi'
	uci -q get mt3600be-toggle.main.reset_double_enabled >/dev/null || uci set mt3600be-toggle.main.reset_double_enabled='0'
	uci -q get mt3600be-toggle.main.reset_double_action >/dev/null || uci set mt3600be-toggle.main.reset_double_action='wifi'
	uci -q get mt3600be-toggle.main.reset_triple_enabled >/dev/null || uci set mt3600be-toggle.main.reset_triple_enabled='0'
	uci -q get mt3600be-toggle.main.reset_triple_action >/dev/null || uci set mt3600be-toggle.main.reset_triple_action='reboot'
	uci -q commit mt3600be-toggle
	[ -e /etc/rc.button/reset.mt3600be-stock ] || cp /etc/rc.button/reset /etc/rc.button/reset.mt3600be-stock
	cp /usr/libexec/mt3600be-reset-button /etc/rc.button/reset
	chmod 0755 /etc/rc.button/reset
	rm -f /tmp/luci-indexcache
	rm -f /usr/lib/lua/luci/controller/toggle.lua /usr/lib/lua/luci/view/toggle/index.htm
}
exit 0
endef

define Package/toggle-switch/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	[ ! -e /etc/rc.button/reset.mt3600be-stock ] || cp /etc/rc.button/reset.mt3600be-stock /etc/rc.button/reset
}
exit 0
endef

$(eval $(call BuildPackage,toggle-switch))

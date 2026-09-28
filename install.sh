#!/bin/sh
set -eu

[ "$(id -u)" = '0' ] || { echo 'Please run as root.' >&2; exit 1; }

BASE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# The stock GL-MT3600BE firmware already ships the gpio-keys node this package
# reacts to: /gpio-keys/button-mode (label "mode", BTN_0, EV_SW, pio 3).
[ -d /proc/device-tree/gpio-keys/button-mode ] || \
	echo 'Warning: /proc/device-tree/gpio-keys/button-mode not found; switch events may never fire.' >&2

mkdir -p /usr/sbin /etc/init.d /etc/config /etc/rc.button /etc/mt3600be-toggle.d \
	/usr/share/ucode/luci/controller /usr/share/luci/menu.d \
	/www/luci-static/resources/view/toggle
cp "$BASE/usr/sbin/mt3600be-toggle-apply" /usr/sbin/mt3600be-toggle-apply
cp "$BASE/usr/sbin/mt3600be-toggle-sync" /usr/sbin/mt3600be-toggle-sync
cp "$BASE/usr/sbin/mt3600be-toggle-wifi" /usr/sbin/mt3600be-toggle-wifi
cp "$BASE/usr/sbin/mt3600be-toggle-proxy" /usr/sbin/mt3600be-toggle-proxy
cp "$BASE/usr/sbin/mt3600be-reset-control" /usr/sbin/mt3600be-reset-control
mkdir -p /usr/libexec
cp "$BASE/usr/libexec/mt3600be-reset-button" /usr/libexec/mt3600be-reset-button
cp "$BASE/usr/libexec/mt3600be-delay" /usr/libexec/mt3600be-delay
cp "$BASE/etc/init.d/mt3600be-toggle" /etc/init.d/mt3600be-toggle
cp "$BASE/etc/rc.button/BTN_0" /etc/rc.button/BTN_0
chmod 0755 /usr/sbin/mt3600be-toggle-apply /usr/sbin/mt3600be-toggle-sync /usr/sbin/mt3600be-toggle-wifi /usr/sbin/mt3600be-toggle-proxy /usr/sbin/mt3600be-reset-control /usr/libexec/mt3600be-reset-button /usr/libexec/mt3600be-delay \
	/etc/init.d/mt3600be-toggle /etc/rc.button/BTN_0
cp "$BASE/usr/share/ucode/luci/controller/toggle.uc" /usr/share/ucode/luci/controller/toggle.uc
cp "$BASE/usr/share/luci/menu.d/toggle-switch.json" /usr/share/luci/menu.d/toggle-switch.json
mkdir -p /usr/share/ucode/luci/template
cp "$BASE/usr/share/ucode/luci/template/toggle.ut" /usr/share/ucode/luci/template/toggle.ut
# 移除旧版 JS 视图（已改为 ucode 模板渲染）
rm -rf /www/luci-static/resources/view/toggle
chmod 0644 /usr/share/ucode/luci/controller/toggle.uc /usr/share/luci/menu.d/toggle-switch.json \
	/usr/share/ucode/luci/template/toggle.ut
rm -f /usr/lib/lua/luci/controller/toggle.lua /usr/lib/lua/luci/view/toggle/index.htm

if [ ! -e /etc/config/mt3600be-toggle ]; then
	cp "$BASE/etc/config/mt3600be-toggle" /etc/config/mt3600be-toggle
	chmod 0600 /etc/config/mt3600be-toggle
else
	echo 'Keeping existing /etc/config/mt3600be-toggle'
fi

uci -q get mt3600be-toggle.main.reset_single_enabled >/dev/null || uci set mt3600be-toggle.main.reset_single_enabled='0'
uci -q get mt3600be-toggle.main.reset_single_action >/dev/null || uci set mt3600be-toggle.main.reset_single_action='wifi'
uci -q get mt3600be-toggle.main.reset_double_enabled >/dev/null || uci set mt3600be-toggle.main.reset_double_enabled='0'
uci -q get mt3600be-toggle.main.reset_double_action >/dev/null || uci set mt3600be-toggle.main.reset_double_action='wifi'
uci -q get mt3600be-toggle.main.reset_triple_enabled >/dev/null || uci set mt3600be-toggle.main.reset_triple_enabled='0'
uci -q get mt3600be-toggle.main.reset_triple_action >/dev/null || uci set mt3600be-toggle.main.reset_triple_action='reboot'
# 开机强制熄灭的灯（与滑块无关）
uci -q get mt3600be-toggle.main.boot_off_leds >/dev/null || uci set mt3600be-toggle.main.boot_off_leds='white:status'
# WiFi 恢复自愈重启（驱动楔死时的一次性救急，1=开 0=关）
uci -q get mt3600be-toggle.main.wifi_selfheal_reboot >/dev/null || uci set mt3600be-toggle.main.wifi_selfheal_reboot='1'
uci -q commit mt3600be-toggle

for example in high.example low.example; do
	if [ ! -e "/etc/mt3600be-toggle.d/$example" ]; then
		cp "$BASE/etc/mt3600be-toggle.d/$example" "/etc/mt3600be-toggle.d/$example"
		chmod 0644 "/etc/mt3600be-toggle.d/$example"
	fi
done

/etc/init.d/mt3600be-toggle enable
/etc/init.d/mt3600be-toggle restart
[ -e /etc/rc.button/reset.mt3600be-stock ] || cp /etc/rc.button/reset /etc/rc.button/reset.mt3600be-stock
cp /usr/libexec/mt3600be-reset-button /etc/rc.button/reset
chmod 0755 /etc/rc.button/reset
rm -f /tmp/luci-indexcache

echo 'Installed. Feature actions and RESET gestures are disabled by default.'
echo 'Switch node: /gpio-keys/button-mode (BTN_0, EV_SW, ACTIVE_HIGH -> pressed=HIGH).'
echo 'Watch events with: logread -f -e mt3600be-toggle'

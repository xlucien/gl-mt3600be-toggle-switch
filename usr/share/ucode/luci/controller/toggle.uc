'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';

const cur = cursor();
const proxy_targets = { auto: true, passwall: true, passwall2: true, openclash: true, ssrplus: true, nikki: true, daed: true, homeproxy: true, mihomo: true };
const reset_actions = { wifi: true, led: true, reboot: true };
// 「检测」按钮用的关键词表：一次收集系统里所有名字，再拿这张表去匹配。
// 故意不含裸 "proxy"（会命中一堆无关脚本）。
const SCAN_WORDS = [
    'passwall', 'openclash', 'clash', 'mihomo', 'ssrplus', 'shadowsocks', 'ss-libev',
    'nikki', 'daed', 'homeproxy', 'xray', 'v2ray', 'singbox', 'sing-box',
    'trojan', 'hysteria', 'naive', 'brook', 'gost', '3proxy', 'tuic', 'juicity'
];

function cfg_get(key, fallback) {
    let value = cur.get('mt3600be-toggle', 'main', key);
    return (value == null || value == '') ? fallback : `${value}`;
}

function cfg_bool(key, fallback) {
    return cfg_get(key, fallback) == '1';
}

// ===== 自定义代理 =====
// 预设 8 个插件之外的代理（比如自己装的 xray / v2raya / 某个小众壳），
// 用户在页面搜索框里查到后选中，名字存进 UCI list proxy_custom。
// 之后 valid_proxy() / proxy_list() / mt3600be-toggle-proxy 都把它当成合法目标。
function custom_list() {
    let value = cur.get('mt3600be-toggle', 'main', 'proxy_custom');
    let out = [];
    if (value == null) return out;
    let items = (type(value) == 'array') ? value : split(`${value}`, /\s+/);
    for (let x in items) {
        let s = trim(`${x}`);
        if (s != '' && !proxy_targets[s] && match(s, /^[A-Za-z0-9][A-Za-z0-9._+-]*$/))
            push(out, s);
    }
    return out;
}

function is_custom(value) {
    for (let c in custom_list()) if (c == value) return true;
    return false;
}

function valid_proxy(value) {
    return (proxy_targets[value] || is_custom(value)) ? value : 'auto';
}

function valid_reset(value) {
    return reset_actions[value] ? value : 'wifi';
}

function command_output(command) {
    let fp = fs.popen(command, 'r');
    if (!fp) return '';
    let output = fp.read('all') ?? '';
    fp.close();
    return output;
}

function kv_file(path, defaults) {
    let result = defaults;
    for (let line in split(fs.readfile(path) ?? '', '\n')) {
        let m = match(line, /^([a-z_]+)=(.*)$/);
        if (m && result[m[1]] != null) result[m[1]] = m[2];
    }
    return result;
}

function proxy_status(target) {
    target = valid_proxy(target ?? cfg_get('proxy_target', 'auto'));
    let result = { target: 'none', state: 'not_installed', configured: false, running: false };
    for (let line in split(command_output(`/usr/sbin/mt3600be-toggle-proxy status ${target} 2>/dev/null`), '\n')) {
        let m = match(line, /^([a-z_]+)=(.*)$/);
        if (!m) continue;
        if (m[1] == 'target' || m[1] == 'state') result[m[1]] = m[2];
        else if (m[1] == 'configured' || m[1] == 'running') result[m[1]] = m[2] == '1';
    }
    return result;
}

// 下拉框用：完整候选列表（自动 + 8 个插件），不管装没装都列出来。
// 注意：ucode 里不能写 `for (let x in [ 'a', 'b' ])` 直接遍历数组字面量（不生效），
// 必须先把数组放进变量再遍历。
function proxy_list() {
    let targets = [ 'passwall', 'passwall2', 'openclash', 'ssrplus', 'nikki', 'daed', 'homeproxy', 'mihomo' ];
    let list = [{ target: 'auto', state: 'auto', configured: false, running: false }];
    for (let target in targets)
        push(list, proxy_status(target));
    // 自定义目标排在预设后面，同样走一遍状态检测
    for (let target in custom_list())
        push(list, proxy_status(target));
    return list;
}

// ===== 自定义代理搜索 =====
// 用户在页面输入关键词，这里到系统里找「名字相近」的程序给他挑：
//   1) /etc/init.d/*  有启停脚本 —— 这类才能被滑块真正控制
//   2) /etc/config/*  有配置文件 —— 装过但不一定能直接启停
//   3) opkg list-installed        —— 已安装的包名
// 结果按「能控制」优先排，不能控制的也列出来，由用户自己判断。
function shell_lines(cmd) {
    let out = [];
    for (let line in split(command_output(cmd), '\n')) {
        let s = trim(line);
        if (s != '') push(out, s);
    }
    return out;
}

function scan_names(path, keyword, source, bucket) {
    let dir = fs.opendir(path);
    if (!dir) return;
    let entry, name;
    while ((entry = dir.read()) != null) {
        name = (type(entry) == 'object') ? entry.name : entry;
        if (name == null) continue;
        name = `${name}`;
        if (name == '' || name == '.' || name == '..') continue;
        if (index(lc(name), keyword) < 0) continue;
        if (bucket[name] == null) bucket[name] = [];
        push(bucket[name], source);
    }
    dir.close();
}

function service_running(name) {
    let json = command_output(`ubus call service list '{"name":"${name}"}' 2>/dev/null`);
    if (index(replace(`${json ?? ''}`, ' ', '', 'g'), '"running":true') >= 0) return true;
    return trim(command_output(`/etc/init.d/${name} running >/dev/null 2>&1 && echo 1`)) == '1';
}

function has_init_script(name) {
    return trim(command_output(`[ -x '/etc/init.d/${name}' ] && echo 1`)) == '1';
}

function proxy_search(keyword) {
    let k = lc(trim(`${keyword ?? ''}`));
    let items = [];
    if (k == '' || !match(keyword, /^[A-Za-z0-9._+ -]+$/)) return items;

    let bucket = {};
    scan_names('/etc/init.d', k, 'initd', bucket);
    scan_names('/etc/config', k, 'config', bucket);
    // 包名：25.12 起固件换成 apk（opkg 已经不存在），两个都试一遍，取并集。
    // opkg 输出 "名字 - 版本"，apk info 只输出 "名字"，正则不要求尾部空白即可兼容。
    for (let line in shell_lines('( opkg list-installed 2>/dev/null; apk info 2>/dev/null )')) {
        let m = match(line, /^([A-Za-z0-9][A-Za-z0-9._+-]*)/);
        if (!m) continue;
        let name = m[1];
        if (index(lc(name), k) < 0) continue;
        if (bucket[name] == null) bucket[name] = [];
        push(bucket[name], 'opkg');
    }

    let names = sort(keys(bucket) ?? []);
    let usable = [], others = [];
    for (let name in names) {
        let can = has_init_script(name);
        let item = {
            target: name,
            label: name,
            src: bucket[name],
            has_init: can,
            running: can ? service_running(name) : false,
            known: (proxy_targets[name] == true) || is_custom(name)
        };
        if (can) push(usable, item);
        else push(others, item);
    }
    for (let it in usable) push(items, it);
    for (let it in others) push(items, it);
    return length(items) > 40 ? slice(items, 0, 40) : items;
}

// ===== 预设代理「检测」按钮 =====
// 页面默认只显示已经检测到的代理；用户点「检测」时跑这一遍，
// 把系统里凡是名字像代理程序的（/etc/init.d、/etc/config、已安装包）都捞出来。
// 三个来源各扫一次，再用 SCAN_WORDS 统一匹配 —— 不做「每个关键词跑一遍 shell」，
// 那样二十多个关键词要几十秒。
function dir_names(path) {
    let out = [];
    let dir = fs.opendir(path);
    if (!dir) return out;
    let entry;
    while ((entry = dir.read()) != null) {
        let name = (type(entry) == 'object') ? entry.name : entry;
        if (name == null) continue;
        name = `${name}`;
        if (name == '' || name == '.' || name == '..') continue;
        push(out, name);
    }
    dir.close();
    return out;
}

function bucket_add(bucket, name, source) {
    if (bucket[name] == null) bucket[name] = [];
    for (let s in bucket[name]) if (s == source) return;
    push(bucket[name], source);
}

function scan_item(name, bucket) {
    let can = has_init_script(name);
    return {
        target: name,
        label: name,
        src: bucket[name],
        has_init: can,
        running: can ? service_running(name) : false,
        known: (proxy_targets[name] == true) || is_custom(name)
    };
}

function proxy_scan_all() {
    let bucket = {};
    let dirs = [ '/etc/init.d', '/etc/config' ];
    for (let d in dirs) {
        let src = (d == '/etc/init.d') ? 'initd' : 'config';
        for (let name in dir_names(d)) bucket_add(bucket, name, src);
    }
    for (let line in shell_lines('( opkg list-installed 2>/dev/null; apk info 2>/dev/null )')) {
        let m = match(line, /^([A-Za-z0-9][A-Za-z0-9._+-]*)/);
        if (m) bucket_add(bucket, m[1], 'opkg');
    }

    let words = SCAN_WORDS;
    let names = sort(keys(bucket) ?? []);
    let usable = [], others = [];
    for (let name in names) {
        let low = lc(name);
        let hit = false;
        for (let w in words) if (index(low, w) >= 0) { hit = true; break; }
        if (!hit) continue;
        let it = scan_item(name, bucket);
        if (it.has_init) push(usable, it);
        else push(others, it);
    }
    let items = [];
    for (let it in usable) push(items, it);
    for (let it in others) push(items, it);
    return length(items) > 30 ? slice(items, 0, 30) : items;
}

// 右栏「可控制」用：只保留实际检测到的插件（未安装的丢弃），这些条目可点击选择。
function proxy_list_detected() {
    let all = proxy_list();
    let list = [];
    for (let p in all) {
        if (p.target != 'auto' && p.state == 'not_installed') continue;
        push(list, p);
    }
    return list;
}

// 可选的 LED 列表，来自 /sys/class/leds（本机是 blue:status / white:status）。
function led_list() {
    let list = [];
    let dir = fs.opendir('/sys/class/leds');
    if (dir) {
        let entry;
        while ((entry = dir.read()) != null) {
            let name = (type(entry) == 'object') ? entry.name : entry;
            if (name == null) continue;
            if (fs.access(`/sys/class/leds/${name}/brightness`)) push(list, `${name}`);
        }
        dir.close();
    }
    return length(list) ? list : [ 'blue:status', 'white:status' ];
}

function physical_state() {
    return trim(fs.readfile('/tmp/mt3600be-toggle-state') ?? '') == '1' ? '1' : '0';
}

// ===== 无线网络清单 =====
// 从 `uci show wireless` 现场解析出所有 wifi-device / wifi-iface。
// 用 uci 命令行而不是再开一个 cursor()，是因为 ucode 的 uci 绑定没有稳定的
// 枚举接口，而 uci show 的输出格式十几年没变过，最稳。
//
// 返回 { section: { section, type, ssid, device, band, disabled } }
function wireless_sections() {
    let map = {};
    for (let line in split(command_output('uci -q show wireless 2>/dev/null'), '\n')) {
        let s = trim(line);
        if (s == '') continue;
        let eq = index(s, '=');
        if (eq < 0) continue;
        let key = substr(s, 0, eq);
        let val = trim(substr(s, eq + 1));
        val = replace(val, /^'/, '');
        val = replace(val, /'$/, '');
        let m = match(key, /^wireless\.([^.]+)\.([A-Za-z0-9_-]+)$/);
        if (m) {
            let sec = m[1], opt = m[2];
            if (type(map[sec]) != 'object')
                map[sec] = { section: sec, type: '', ssid: '', device: '', band: '', disabled: '0' };
            if (opt == 'ssid' || opt == 'device' || opt == 'band' || opt == 'disabled')
                map[sec][opt] = val;
            continue;
        }
        let m2 = match(key, /^wireless\.([^.]+)$/);
        if (m2) {
            let sec = m2[1];
            if (type(map[sec]) != 'object')
                map[sec] = { section: sec, type: '', ssid: '', device: '', band: '', disabled: '0' };
            map[sec].type = val;
        }
    }
    return map;
}

function band_label(band) {
    if (band == '2g') return '2.4G';
    if (band == '5g') return '5G';
    if (band == '6g') return '6G';
    if (band == '60g') return '60G';
    return band == '' ? '无线' : band;
}

// 页面 Wi-Fi 档要显示的条目：每个 SSID 一条。
// 频段取自己没有就问它所在的射频（mtwifi 的 band 写在 wifi-device 上）。
function wireless_ifaces() {
    let map = wireless_sections();
    let names = sort(keys(map) ?? []);
    let out = [];
    for (let n in names) {
        let e = map[n];
        if (e.type != 'wifi-iface') continue;
        // 匿名段（@wifi-iface[0]）没法在脚本里稳定引用，直接跳过
        if (index(e.section, '@') >= 0) continue;
        if (e.ssid == '') continue;
        let band = e.band;
        if (band == '' && e.device != '' && type(map[e.device]) == 'object')
            band = map[e.device].band;
        push(out, {
            section: e.section,
            ssid: e.ssid,
            device: e.device,
            band: band,
            band_label: band_label(band),
            disabled: (e.disabled == '1')
        });
    }
    return out;
}

// Wi-Fi 档的作用范围：空 = 总控（全部射频）；否则是 wifi-iface 段名列表。
function wifi_target_list() {
    let value = cur.get('mt3600be-toggle', 'main', 'wifi_targets');
    let out = [];
    if (value == null) return out;
    let items = (type(value) == 'array') ? value : split(`${value}`, /\s+/);
    let map = wireless_sections();
    for (let x in items) {
        let s = trim(`${x}`);
        if (s == '') continue;
        if (!match(s, /^[A-Za-z0-9_]+$/)) continue;      /* 段名只认安全字符 */
        let e = map[s];
        if (type(e) != 'object') continue;               /* 系统里已经没有这个段了 */
        if (e.type != 'wifi-iface' && e.type != 'wifi-device') continue;
        push(out, s);
    }
    return out;
}

// ===== 灯光模式 =====
// 用户只需要在「单独蓝灯 / 单独白灯 / 双色灯」里三选一，不必手工写灯名。
// 三种模式映射到 led_name：
//   blue  -> blue:status
//   white -> white:status
//   both  -> blue:status white:status
// 灯名来自 led_list()（/sys/class/leds 实测结果），保证只写真实节点。
function led_mode_names(mode) {
    let known = led_list();
    let blue = null, white = null, first = null, second = null;
    for (let n in known) {
        let s = `${n}`;
        if (first == null) first = s;
        else if (second == null) second = s;
        if (blue == null && index(s, 'blue') >= 0) blue = s;
        if (white == null && index(s, 'white') >= 0) white = s;
    }
    // 没有按名字匹配到时，退化成「第一颗 = 蓝、第二颗 = 白」
    blue ??= first;
    white ??= (blue != second) ? second : null;

    let out = [];
    if (mode == 'blue' && blue != null) push(out, blue);
    else if (mode == 'white' && white != null) push(out, white);
    else if (mode == 'both') for (let n in known) push(out, `${n}`);

    // 兜底：至少给一颗，否则 LED 档会完全无灯可控
    if (length(out) == 0 && first != null) push(out, first);
    return out;
}

function led_name_to_mode(name) {
    let parts = split(trim(`${name ?? ''}`), /\s+/);
    let n = 0, blue = false, white = false;
    for (let p in parts) {
        if (p == '') continue;
        n++;
        let s = `${p}`;
        if (index(s, 'blue') >= 0) blue = true;
        if (index(s, 'white') >= 0) white = true;
    }
    if (n > 1) return 'both';
    if (white && !blue) return 'white';
    return 'blue';
}

function led_names_to_mode_string(mode) {
    let names = led_mode_names(mode);
    let s = '';
    for (let n in names) s = (s == '') ? n : (s + ' ' + n);
    return s;
}

function valid_led_mode(value) {
    return (value == 'blue' || value == 'white' || value == 'both') ? value : 'blue';
}

// 直接读 debugfs 里 mode 引脚的真实电平，返回 '1'(HIGH/左) / '0'(LOW/右) / null。
// 用于「当前开关位置」展示——与物理硬件一致，不会被模拟拨动改写的位置缓存影响。
function physical_gpio() {
    let raw = fs.readfile('/sys/kernel/debug/gpio') ?? '';
    if (raw == '') return null;
    for (let line in split(raw, '\n')) {
        if (index(line, '|mode') < 0) continue;
        let m = match(line, /(^|\s)(hi|lo)(\s|$)/);
        if (m) return m[2] == 'hi' ? '1' : '0';
    }
    return null;
}

function json_out(data, status) {
    status ??= 200;
    http.status(status, status == 200 ? 'OK' : 'Bad Request');
    http.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    http.prepare_content('application/json');
    http.write_json(data);
}

function read_led(path) {
    let v = trim(fs.readfile(path) ?? '0');
    return v == '1' ? 'on' : 'off';
}

function full_data() {
    let physical = physical_gpio();
    if (physical == null) physical = physical_state();
    return {
        switch_position: physical == '1' ? 'left' : 'right',
        blue_led: read_led('/sys/class/leds/blue:status/brightness'),
        white_led: read_led('/sys/class/leds/white:status/brightness'),
        global_enabled: cfg_bool('global_enabled', '0'),
        led_enabled: cfg_bool('led_enabled', '0'),
        led_left_action: cfg_bool('led_high_action', '1'),
        led_right_action: cfg_bool('led_low_action', '0'),
        wifi_enabled: cfg_bool('wifi_enabled', '0'),
        wifi_left_action: cfg_bool('wifi_high_action', '0'),
        wifi_right_action: cfg_bool('wifi_low_action', '1'),
        wifi_ifaces: wireless_ifaces(),
        wifi_targets: wifi_target_list(),
        proxy_enabled: cfg_bool('proxy_enabled', '0'),
        proxy_target: cfg_get('proxy_target', 'auto'),
        proxy_left_action: cfg_bool('proxy_high_action', '0'),
        proxy_right_action: cfg_bool('proxy_low_action', '1'),
        proxy_status: proxy_status(),
        proxies: proxy_list(),
        proxies_detected: proxy_list_detected(),
        leds: led_list(),
        reset_single_enabled: cfg_bool('reset_single_enabled', '0'),
        reset_single_action: cfg_get('reset_single_action', 'wifi'),
        reset_double_enabled: cfg_bool('reset_double_enabled', '0'),
        reset_double_action: cfg_get('reset_double_action', 'wifi'),
        reset_triple_enabled: cfg_bool('reset_triple_enabled', '0'),
        reset_triple_action: cfg_get('reset_triple_action', 'reboot'),
        reset_status: kv_file('/tmp/mt3600be-reset/last', { gesture: 'none', action: 'none', result: 'none', time: '' }),
        proxies_custom: custom_list(),
        led_name: cfg_get('led_name', 'blue:status'),
        // 灯光模式由 led_name 反推，老配置不必迁移也能正确显示
        led_mode: led_name_to_mode(cfg_get('led_name', 'blue:status'))
    };
}

// 把 LED 档控制的灯对齐到「滑块当前位置 + 当前动作」。
// 用户每次改完灯光配置都要调一次，否则会留下「配置说开灯、灯却是灭的」这种不一致。
function apply_led_now() {
    let level = physical_state() == '1' ? 'high' : 'low';
    system(`/usr/sbin/mt3600be-toggle-apply ${level} force >/dev/null 2>&1`);
}

// 恢复出厂默认：LED 档=蓝灯、滑块无功能、RESET 三个手势全部禁用。
// 故意不覆盖用户可能自己调过的 boot_off_leds / 网络相关项。
function reset_defaults() {
    let d = {
        global_enabled: '0',
        led_enabled: '0', led_name: 'blue:status',
        led_high_action: '1', led_low_action: '0',
        wifi_enabled: '0', wifi_high_action: '0', wifi_low_action: '1',
        proxy_enabled: '0', proxy_target: 'auto',
        proxy_high_action: '0', proxy_low_action: '1',
        reset_single_enabled: '0', reset_single_action: 'wifi',
        reset_double_enabled: '0', reset_double_action: 'wifi',
        reset_triple_enabled: '0', reset_triple_action: 'wifi'
    };
    for (let k, v in d)
        cur.set('mt3600be-toggle', 'main', k, v);
    // 恢复默认时 Wi-Fi 回到「总控」：list 必须 delete，set 空数组无效
    cur.delete('mt3600be-toggle', 'main', 'wifi_targets');
    cur.delete('mt3600be-toggle', 'main', 'proxy_custom');
    cur.commit('mt3600be-toggle');
    system('/usr/sbin/mt3600be-reset-control clear >/dev/null 2>&1');
    // 默认无功能：把灯恢复成开机基线（boot_off_leds 里的熄灭、其余点亮）
    system('/etc/init.d/mt3600be-toggle reload >/dev/null 2>&1 &');
    return json_out({ success: true, data: full_data() });
}

function save(requested_action) {
    // 自定义代理列表由页面整份回传（记住用户选过的自定义目标）。
    // 必须放在 valid_proxy() 之前：新加的目标要先入表，才算合法。
    let raw_custom = http.formvalue('proxy_custom');
    if (raw_custom != null) {
        let list = [];
        for (let c in split(trim(`${raw_custom}`), /\s+/)) {
            if (c == '' || proxy_targets[c]) continue;
            if (!match(c, /^[A-Za-z0-9][A-Za-z0-9._+-]*$/)) continue;
            push(list, c);
        }
        // 空列表必须 delete 而不能 set([])：set 空数组不会清掉原有 list
        if (length(list) == 0) cur.delete('mt3600be-toggle', 'main', 'proxy_custom');
        else cur.set('mt3600be-toggle', 'main', 'proxy_custom', list);
        cur.commit('mt3600be-toggle');
    }

    let old_wifi = cfg_get('wifi_enabled', '0');
    let old_proxy = cfg_get('proxy_enabled', '0');
    let old_led = cfg_get('led_enabled', '0');
    let old_target = cfg_get('proxy_target', 'auto');
    let new_led = http.formvalue('led_enabled') == '1' ? '1' : '0';
    let new_wifi = http.formvalue('wifi_enabled') == '1' ? '1' : '0';
    let new_proxy = http.formvalue('proxy_enabled') == '1' ? '1' : '0';
    let new_global = (new_led == '1' || new_wifi == '1' || new_proxy == '1') ? '1' : '0';
    let new_target = valid_proxy(http.formvalue('proxy_target') ?? 'auto');

    if ((new_led == '1') + (new_wifi == '1') + (new_proxy == '1') > 1)
        return json_out({ success: false, error: 'LED、WiFi 和代理控制只能选择一项' }, 400);

    if (old_wifi == '0' && new_wifi == '1') system('/usr/sbin/mt3600be-toggle-wifi snapshot >/dev/null 2>&1');

    let bool_map = {
        led_enabled: 'led_enabled', led_left_action: 'led_high_action', led_right_action: 'led_low_action',
        wifi_enabled: 'wifi_enabled', wifi_left_action: 'wifi_high_action', wifi_right_action: 'wifi_low_action',
        proxy_enabled: 'proxy_enabled', proxy_left_action: 'proxy_high_action', proxy_right_action: 'proxy_low_action',
        reset_single_enabled: 'reset_single_enabled', reset_double_enabled: 'reset_double_enabled', reset_triple_enabled: 'reset_triple_enabled'
    };
    for (let form_key, uci_key in bool_map)
        cur.set('mt3600be-toggle', 'main', uci_key, http.formvalue(form_key) == '1' ? '1' : '0');

    cur.set('mt3600be-toggle', 'main', 'global_enabled', new_global);
    cur.set('mt3600be-toggle', 'main', 'proxy_target', new_target);
    // Wi-Fi 作用范围：空 = 总控（全部射频），否则是一串 wifi-iface 段名。
    // 与 proxy_custom 一样：空列表必须 delete，set([]) 清不掉 UCI list。
    let wifi_list = [];
    let raw_wifi = http.formvalue('wifi_targets');
    if (raw_wifi != null) {
        let wsec = wireless_sections();
        for (let w in split(trim(`${raw_wifi}`), /\s+/)) {
            if (w == '' || !match(w, /^[A-Za-z0-9_]+$/)) continue;
            let we = wsec[w];
            if (type(we) != 'object') continue;
            if (we.type != 'wifi-iface' && we.type != 'wifi-device') continue;
            push(wifi_list, w);
        }
        if (length(wifi_list) == 0) cur.delete('mt3600be-toggle', 'main', 'wifi_targets');
        else cur.set('mt3600be-toggle', 'main', 'wifi_targets', wifi_list);
    }
    // 灯光模式 -> led_name。必须落盘，否则页面选的灯（比如白灯）保存后仍是旧值。
    let new_mode = valid_led_mode(http.formvalue('led_mode') ?? led_name_to_mode(cfg_get('led_name', 'blue:status')));
    cur.set('mt3600be-toggle', 'main', 'led_name', led_names_to_mode_string(new_mode));
    for (let gesture in [ 'single', 'double', 'triple' ])
        cur.set('mt3600be-toggle', 'main', `reset_${gesture}_action`, valid_reset(http.formvalue(`reset_${gesture}_action`) ?? 'wifi'));
    cur.commit('mt3600be-toggle');

    system('/usr/sbin/mt3600be-reset-control clear >/dev/null 2>&1');
    // Wi-Fi 档关掉时一定要把射频还回去——这是安全兜底，保存和保存并应用都要做。
    if (old_wifi == '1' && new_wifi == '0')
        system('/usr/sbin/mt3600be-toggle-wifi restore >/dev/null 2>&1');
    if (new_proxy == '1' && (old_proxy == '0' || old_target != new_target))
        system('/usr/sbin/mt3600be-toggle-proxy snapshot >/dev/null 2>&1');

    // LED 档关掉时，把原本受控的灯交还给开机基线，避免「已经不管灯了、灯还亮着」。
    if (old_led == '1' && new_led == '0')
        system('/etc/init.d/mt3600be-toggle reload >/dev/null 2>&1 &');

    // 等一下再刷：led_name 刚提交，而 init.d reload（关档时）是异步的。
    // save    = 只把灯态对齐到新配置（用户要求：改完灯光配置灯就必须跟着变），
    //           不触发 Wi-Fi / 代理动作；
    // apply   = 按当前滑块位置完整执行一次动作（灯 + Wi-Fi + 代理 + 钩子）。
    let level = physical_state() == '1' ? 'high' : 'low';
    let only = (requested_action == 'save') ? ' led' : '';
    system(`( sleep 1; /usr/sbin/mt3600be-toggle-apply ${level} force${only} ) >/dev/null 2>&1 &`);

    return json_out({ success: true, applied: requested_action == 'apply', proxy_status: proxy_status(new_target) });
}

// 模拟一次拨动：按指定方向强制执行一次动作（用于页面演示图点击预览）。
// 用 force 跳过去重，因此即使与当前物理位置相同也会真实触发一次。
function simulate() {
    let side = http.formvalue('side');
    let level = side == 'left' ? 'high' : (side == 'right' ? 'low' : null);
    if (level == null)
        return json_out({ success: false, error: '无效的拨动方向' }, 400);
    system(`/usr/sbin/mt3600be-toggle-apply ${level} force >/dev/null 2>&1`);
    return json_out({ success: true, side: side, data: full_data() });
}

return {
    action_data: function() {
        return json_out({ success: true, data: full_data() });
    },
    action_save: function() {
        return save('save');
    },
    action_apply: function() {
        return save('apply');
    },
    action_proxy_search: function() {
        let kw = trim(`${http.formvalue('kw') ?? ''}`);
        if (kw == '') return json_out({ success: false, error: '请输入关键词' }, 400);
        return json_out({ success: true, keyword: kw, items: proxy_search(kw) });
    },
    action_proxy_scan: function() {
        let items = proxy_scan_all();
        return json_out({ success: true, items: items, count: length(items) });
    },
    action_simulate: function() {
        return simulate();
    },
    action_defaults: function() {
        return reset_defaults();
    }
};

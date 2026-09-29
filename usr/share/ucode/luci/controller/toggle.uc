'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';

const cur = cursor();
const proxy_targets = { auto: true, passwall: true, passwall2: true, openclash: true, ssrplus: true, nikki: true, daed: true, homeproxy: true, mihomo: true };
const reset_actions = { wifi: true, led: true, reboot: true };

function cfg_get(key, fallback) {
    let value = cur.get('mt3600be-toggle', 'main', key);
    return (value == null || value == '') ? fallback : `${value}`;
}

function cfg_bool(key, fallback) {
    return cfg_get(key, fallback) == '1';
}

function valid_proxy(value) {
    return proxy_targets[value] ? value : 'auto';
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
    return list;
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

// 只接受 /sys/class/leds 里真实存在的灯名，多个用空格分隔；去重后拼回字符串。
// 页面只提交检测到的灯名，这里再兜一层，避免写进无效值导致 LED 完全不受控。
//
// 【ucode 坑】`for (let x in 数组)` 遍历出来的是**元素值**，不是下标
// （这一点和 JS 的 for-in 给下标完全不同）。所以判定成员要直接比 `x == part`，
// 写成 `known[x] == part` 会全部落空 —— 曾因此把每个灯名都当成非法值，
// 回退到 known[0]，表现就是「页面选白灯，保存后还是蓝灯」。
function valid_leds(value) {
    let known = led_list();
    let out = [];
    let parts = split(trim(`${value ?? ''}`), /\s+/);
    for (let part in parts) {
        if (part == '') continue;
        let ok = (length(known) == 0);
        for (let k in known) if (k == part) ok = true;
        if (!ok) continue;
        let dup = false;
        for (let o in out) if (o == part) dup = true;
        if (!dup) push(out, part);
    }
    let s = '';
    for (let p in out) s = (s == '') ? p : (s + ' ' + p);
    if (s != '') return s;
    return length(known) ? known[0] : cfg_get('led_name', 'blue:status');
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
        led_name: cfg_get('led_name', 'blue:status')
    };
}

function save(requested_action) {
    let old_wifi = cfg_get('wifi_enabled', '0');
    let old_proxy = cfg_get('proxy_enabled', '0');
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
    // led_name 必须落盘，否则页面选的灯（比如白灯）保存后仍是旧值
    cur.set('mt3600be-toggle', 'main', 'led_name', valid_leds(http.formvalue('led_name')));
    for (let gesture in [ 'single', 'double', 'triple' ])
        cur.set('mt3600be-toggle', 'main', `reset_${gesture}_action`, valid_reset(http.formvalue(`reset_${gesture}_action`) ?? 'wifi'));
    cur.commit('mt3600be-toggle');

    system('/usr/sbin/mt3600be-reset-control clear >/dev/null 2>&1');
    if (requested_action == 'save' && old_wifi == '1' && new_wifi == '0')
        system('/usr/sbin/mt3600be-toggle-wifi restore >/dev/null 2>&1');
    if (new_proxy == '1' && (old_proxy == '0' || old_target != new_target))
        system('/usr/sbin/mt3600be-toggle-proxy snapshot >/dev/null 2>&1');
    if (requested_action == 'save') {
        let level = physical_state() == '1' ? 'high' : 'low';
        system(`/usr/sbin/mt3600be-toggle-apply ${level} force >/dev/null 2>&1 &`);
    }
    return json_out({ success: true, applied: requested_action == 'save', proxy_status: proxy_status(new_target) });
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
    action_simulate: function() {
        return simulate();
    }
};

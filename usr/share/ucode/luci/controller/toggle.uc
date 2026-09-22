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

function physical_state() {
    return trim(fs.readfile('/tmp/mt3600be-toggle-state') ?? '') == '1' ? '1' : '0';
}

function json_out(data, status) {
    status ??= 200;
    http.status(status, status == 200 ? 'OK' : 'Bad Request');
    http.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    http.prepare_content('application/json');
    http.write_json(data);
}

function full_data() {
    let physical = physical_state();
    return {
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
        reset_single_enabled: cfg_bool('reset_single_enabled', '0'),
        reset_single_action: cfg_get('reset_single_action', 'wifi'),
        reset_double_enabled: cfg_bool('reset_double_enabled', '0'),
        reset_double_action: cfg_get('reset_double_action', 'wifi'),
        reset_triple_enabled: cfg_bool('reset_triple_enabled', '0'),
        reset_triple_action: cfg_get('reset_triple_action', 'reboot'),
        reset_status: kv_file('/tmp/mt3600be-reset/last', { gesture: 'none', action: 'none', result: 'none', time: '' }),
        current_mode: physical == '1' ? '0' : '1',
        default_led: cfg_get('led_name', 'white:status')
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

return {
    action_api: function() {
        let method = http.getenv('REQUEST_METHOD') ?? 'GET';
        if (method == 'GET') {
            let physical = physical_state();
            if (http.formvalue('brief') == '1') return json_out({ success: true, data: { current_mode: physical == '1' ? '0' : '1' } });
            return json_out({ success: true, data: full_data() });
        }
        let action = http.formvalue('action');
        if (method == 'POST' && action == 'detect_proxy')
            return json_out({ success: true, proxy_status: proxy_status(http.formvalue('proxy_target')) });
        if (method == 'POST' && (action == 'save' || action == 'save_only')) return save(action);
        return json_out({ success: false, error: '无效请求' }, 400);
    }
};

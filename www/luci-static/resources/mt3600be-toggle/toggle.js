'use strict';
/* mt3600be-toggle 页面脚本（外置，避免内联 <script> 被 ucode 模板引擎解析） */

(function () {
    var INIT = {
        switch_position: 'left', blue_led: 'on', white_led: 'off',
        led_enabled: false, led_left_action: true, led_right_action: false, led_name: 'blue:status',
        wifi_enabled: false, wifi_left_action: false, wifi_right_action: true,
        proxy_enabled: false, proxy_target: 'auto', proxy_left_action: false, proxy_right_action: true,
        reset_single_enabled: false, reset_single_action: 'wifi',
        reset_double_enabled: false, reset_double_action: 'wifi',
        reset_triple_enabled: false, reset_triple_action: 'reboot',
        leds: ['blue:status', 'white:status'],
        proxies: [{ target: 'auto', state: 'auto', configured: false, running: false, label: '自动检测' }]
    };

    var FUNC_LABEL = { none: '无功能', proxy: '代理', wifi: 'Wi-Fi', led: 'LED' };
    var PROXY_NAME = {
        auto: '自动', passwall: 'PassWall', passwall2: 'PassWall2', openclash: 'OpenClash',
        ssrplus: 'SSR Plus+', nikki: 'Nikki', daed: 'Daed', homeproxy: 'HomeProxy', mihomo: 'Mihomo'
    };
    var PROXY_STATE = {
        running: { t: '运行中', c: 'running' },
        installed: { t: '未启用', c: 'idle' },
        error: { t: '配置已开·未运行', c: 'err' },
        conflict: { t: '检测到多个', c: 'conf' },
        not_installed: { t: '未安装', c: 'idle' },
        auto: { t: '自动选择', c: 'idle' }
    };
    var ACT_LABEL = {
        wifi: { on: '开启无线', off: '关闭无线' },
        proxy: { on: '启动代理', off: '关闭代理' },
        led: { on: '打开灯光', off: '关闭灯光' }
    };
    var RESET_GESTURES = ['single', 'double', 'triple'];
    var REFRESH_MS = 3000;

    function clone(o) { var r = {}, k; for (k in o) r[k] = o[k]; return r; }

    var CFG = clone(INIT);
    var SAVED = clone(INIT);
    var firstLoad = true;
    var dataUrl = '', saveUrl = '';

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toast(msg) {
        var el = $('toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
    }

    /* ===== 派生逻辑 ===== */
    function deriveFunc() {
        if (CFG.proxy_enabled) return 'proxy';
        if (CFG.wifi_enabled) return 'wifi';
        if (CFG.led_enabled) return 'led';
        return 'none';
    }
    function applyFunc(f) {
        CFG.led_enabled = (f === 'led');
        CFG.wifi_enabled = (f === 'wifi');
        CFG.proxy_enabled = (f === 'proxy');
    }

    /* 右拨 = 左拨取反；编辑器只暴露左拨 */
    function syncDerived(o) {
        o.led_right_action = !o.led_left_action;
        o.wifi_right_action = !o.wifi_left_action;
        o.proxy_right_action = !o.proxy_left_action;
    }

    function leftKey(f) {
        if (f === 'wifi') return 'wifi_left_action';
        if (f === 'proxy') return 'proxy_left_action';
        return 'led_left_action';
    }
    function leftAction(f) { return !!CFG[leftKey(f)]; }
    function actText(f, on) {
        if (f === 'none' || !ACT_LABEL[f]) return '无动作';
        return on ? ACT_LABEL[f].on : ACT_LABEL[f].off;
    }
    function resetVal(g) {
        if (!CFG['reset_' + g + '_enabled']) return 'disabled';
        var a = CFG['reset_' + g + '_action'];
        return (a === 'led' || a === 'wifi' || a === 'reboot') ? a : 'wifi';
    }
    /* led_name 可能是空格分隔的多个灯 */
    function ledList(name) {
        var out = [], parts = String(name || '').split(/\s+/), i;
        for (i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
        return out;
    }

    /* ===== 渲染辅助 ===== */
    function setSegActive(segId, val) {
        var seg = $(segId);
        if (!seg) return;
        var btns = seg.querySelectorAll('button'), i;
        for (i = 0; i < btns.length; i++)
            btns[i].classList.toggle('active', btns[i].getAttribute('data-v') === String(val));
    }
    function markSelCur(menuId, val) {
        var menu = $(menuId);
        if (!menu) return;
        var opts = menu.querySelectorAll('.opt'), i;
        for (i = 0; i < opts.length; i++)
            opts[i].classList.toggle('cur', opts[i].getAttribute('data-v') === String(val));
    }

    function renderActSeg() {
        var f = deriveFunc(), seg = $('actSeg');
        seg.innerHTML = '';
        if (f === 'none') return;
        var L = ACT_LABEL[f], cur = leftAction(f);
        [{ v: '1', t: L.on }, { v: '0', t: L.off }].forEach(function (b) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('data-v', b.v);
            btn.textContent = b.t;
            btn.onclick = function () { pickAct(b.v); };
            seg.appendChild(btn);
        });
        setSegActive('actSeg', cur ? '1' : '0');
        $('rightAuto').textContent = cur ? L.off : L.on;
    }

    /* 代理下拉：只列出检测到的插件 */
    function renderProxySel() {
        var sel = $('proxySel'), menu = $('proxyMenu');
        var list = (CFG.proxies && CFG.proxies.length) ? CFG.proxies : INIT.proxies;
        var html = '', i, p;
        for (i = 0; i < list.length; i++) {
            p = list[i];
            var nm = PROXY_NAME[p.target] || p.target;
            var st = PROXY_STATE[p.state] || PROXY_STATE.installed;
            var tag = (p.state === 'running') ? '（运行中）'
                : (p.state === 'installed' ? '（未启用）'
                    : (p.state === 'error' ? '（异常）' : ''));
            html += '<div class="opt" data-v="' + esc(p.target) + '" onclick="pickProxy(\'' + esc(p.target) + '\')">'
                + esc(nm) + esc(tag) + '</div>';
        }
        menu.innerHTML = html;
        var curName = PROXY_NAME[CFG.proxy_target] || CFG.proxy_target;
        $('proxyLabel').textContent = curName;
        markSelCur('proxyMenu', CFG.proxy_target);
    }

    /* 多选灯：已有灯用胶囊点选，也可直接编辑输入框 */
    function renderLedPicks() {
        var box = $('ledPicks'), list = CFG.leds || [], picked = ledList(CFG.led_name);
        var html = '', i;
        for (i = 0; i < list.length; i++) {
            var nm = list[i];
            var has = picked.indexOf(nm) >= 0;
            html += '<span class="ledpick' + (has ? ' on' : '') + '" data-led="' + esc(nm) + '">'
                + esc(nm) + '</span>';
        }
        box.innerHTML = html;
        var chips = box.querySelectorAll('.ledpick'), j;
        for (j = 0; j < chips.length; j++) {
            chips[j].onclick = function () { toggleLed(this.getAttribute('data-led')); };
        }
    }
    function toggleLed(name) {
        var picked = ledList(CFG.led_name), idx = picked.indexOf(name);
        if (idx >= 0) picked.splice(idx, 1); else picked.push(name);
        CFG.led_name = picked.join(' ');
        $('ledName').value = CFG.led_name;
        renderLedPicks();
        applyUI();
        markDirty();
    }

    /* 右栏「可控制」能力卡片 */
    function renderCap(f) {
        var box = $('capBox'), html = '';

        if (f === 'none') {
            box.innerHTML = '<div class="cap-empty">未选择功能，滑块仅作位置指示。</div>';
            return;
        }

        if (f === 'wifi') {
            box.innerHTML =
                '<div class="cap">' +
                '<div class="cap-h"><span class="cap-n">无线网络</span><span class="pill idle">2.4G + 5G</span></div>' +
                '<div class="cap-d">左拨：' + esc(actText(f, leftAction(f))) + '　·　右拨：' + esc(actText(f, !leftAction(f))) +
                '<br>关闭时会保存当前各射频的启停状态，重新打开时按快照恢复（含失败自愈重试）。</div></div>';
            return;
        }

        if (f === 'led') {
            var picked = ledList(CFG.led_name), names = '', i;
            for (i = 0; i < picked.length; i++)
                names += '<span class="pill idle" style="margin-right:6px">' + esc(picked[i]) + '</span>';
            if (!names) names = '<span class="pill idle">未指定</span>';
            box.innerHTML =
                '<div class="cap">' +
                '<div class="cap-h"><span class="cap-n">受控 LED</span></div>' +
                '<div class="cap-d" style="margin-bottom:7px">' + names + '</div>' +
                '<div class="cap-d">左拨：' + esc(actText(f, leftAction(f))) + '　·　右拨：' + esc(actText(f, !leftAction(f))) +
                '<br>可点击多个灯同时控制，也可在上方输入框直接写灯名。</div></div>';
            return;
        }

        /* 代理：把每个检测到的插件都列出来并标注可控性 */
        var list = (CFG.proxies && CFG.proxies.length) ? CFG.proxies : INIT.proxies;
        for (var k = 0; k < list.length; k++) {
            var p = list[k];
            var nm = PROXY_NAME[p.target] || p.target;
            var st = PROXY_STATE[p.state] || PROXY_STATE.installed;
            var ctrl = '可启动 / 可关闭';
            if (p.target === 'auto')
                ctrl = '按运行状态自动选择，可由滑块启停';
            else if (p.state === 'not_installed')
                ctrl = '未安装，无法控制';
            else if (p.state === 'conflict')
                ctrl = '检测到多个插件同时运行，无法确定控制目标';
            var cls = p.state === 'running' ? 'ok'
                : (p.state === 'not_installed' ? 'bad' : (p.state === 'conflict' ? 'warn' : ''));
            html += '<div class="cap ' + cls + '">' +
                '<div class="cap-h"><span class="cap-n">' + esc(nm) + '</span>' +
                '<span class="pill ' + st.c + '">' + st.t + '</span>' +
                (CFG.proxy_target === p.target ? '<span class="pill running">当前所选</span>' : '') +
                '</div>' +
                '<div class="cap-d">' + esc(ctrl) + '</div></div>';
        }
        box.innerHTML = html;
    }

    function applyUI() {
        syncDerived(CFG);
        var f = deriveFunc(), la = leftAction(f);

        /* 左栏可见性 */
        $('funcLabel').textContent = FUNC_LABEL[f];
        markSelCur('funcMenu', f);

        var isLed = (f === 'led'), isProxy = (f === 'proxy'), isNone = (f === 'none');
        $('ledNameItem').style.display = isLed ? 'block' : 'none';
        $('actItem').style.display = isNone ? 'none' : 'block';
        $('rightItem').style.display = isNone ? 'none' : 'block';
        if (isLed) renderLedPicks();
        renderActSeg();

        /* 下拉：代理目标只在选「代理」时出现，紧邻功能下拉 */
        var proxyItem = $('proxyItem');
        if (proxyItem) proxyItem.style.display = isProxy ? 'block' : 'none';
        if (isProxy) renderProxySel();

        renderCap(f);

        /* 演示图位置（纯展示，无模拟） */
        var sw = $('swg');
        sw.classList.remove('left', 'right');
        sw.classList.add(CFG.switch_position === 'left' ? 'left' : 'right');
        $('demoPos').textContent = CFG.switch_position === 'left' ? '左侧' : '右侧';

        $('actLeft').textContent = actText(f, la);
        $('actRight').textContent = actText(f, !la);
        $('actLeft').className = 'aval' + (isNone ? ' none' : '');
        $('actRight').className = 'aval' + (isNone ? ' none' : '');

        $('blueSt').textContent = CFG.blue_led === 'on' ? '亮' : '灭';
        $('blueSt').className = 'stv ' + (CFG.blue_led === 'on' ? 'on' : 'off');
        $('whiteSt').textContent = CFG.white_led === 'on' ? '亮' : '灭';
        $('whiteSt').className = 'stv ' + (CFG.white_led === 'on' ? 'on' : 'off');

        RESET_GESTURES.forEach(function (g) {
            setSegActive('reset' + g.charAt(0).toUpperCase() + g.slice(1) + 'Seg', resetVal(g));
        });

        if (document.activeElement !== $('ledName')) $('ledName').value = CFG.led_name || '';
        updateDirty();
    }

    /* ===== 交互 ===== */
    function toggleSel(id) {
        var s = $(id);
        var willOpen = !s.classList.contains('open');
        closeSels();
        if (willOpen) s.classList.add('open');
    }
    function closeSels() {
        var all = document.querySelectorAll('#gl .sel'), i;
        for (i = 0; i < all.length; i++) all[i].classList.remove('open');
    }
    function pickFunc(v) { closeSels(); applyFunc(v); applyUI(); markDirty(); }
    function pickProxy(v) { closeSels(); CFG.proxy_target = v; applyUI(); markDirty(); }
    function pickAct(v) { CFG[leftKey(deriveFunc())] = (v === '1'); syncDerived(CFG); applyUI(); markDirty(); }

    function pickReset(g, val, btn) {
        if (val === 'disabled') {
            CFG['reset_' + g + '_enabled'] = false;
        } else {
            CFG['reset_' + g + '_enabled'] = true;
            CFG['reset_' + g + '_action'] = val;
        }
        setSegActive(btn.parentNode.id, val);
        markDirty();
    }
    function onText(key, val) { CFG[key] = val; renderLedPicks(); applyUI(); markDirty(); }

    /* ===== 脏状态 ===== */
    function isDirty() {
        var keys = Object.keys(SAVED), i;
        for (i = 0; i < keys.length; i++)
            if (JSON.stringify(CFG[keys[i]]) !== JSON.stringify(SAVED[keys[i]])) return true;
        return false;
    }
    function updateDirty() {
        var d = isDirty(), btn = $('btnApply');
        if (d) {
            btn.classList.add('on'); btn.disabled = false;
            $('dirtyNote').style.display = 'inline-flex';
        } else {
            btn.classList.remove('on'); btn.disabled = true;
            $('dirtyNote').style.display = 'none';
        }
    }
    function markDirty() { updateDirty(); }
    function doRevert() { CFG = clone(SAVED); applyUI(); toast('已放弃修改'); }

    /* ===== 保存 / 轮询 ===== */
    function doSave() {
        var fd = new FormData();
        fd.append('led_enabled', CFG.led_enabled ? '1' : '0');
        fd.append('wifi_enabled', CFG.wifi_enabled ? '1' : '0');
        fd.append('proxy_enabled', CFG.proxy_enabled ? '1' : '0');
        fd.append('proxy_target', CFG.proxy_target);
        fd.append('led_left_action', CFG.led_left_action ? '1' : '0');
        fd.append('led_right_action', CFG.led_left_action ? '0' : '1');
        fd.append('wifi_left_action', CFG.wifi_left_action ? '1' : '0');
        fd.append('wifi_right_action', CFG.wifi_left_action ? '0' : '1');
        fd.append('proxy_left_action', CFG.proxy_left_action ? '1' : '0');
        fd.append('proxy_right_action', CFG.proxy_left_action ? '0' : '1');
        fd.append('led_name', CFG.led_name);
        RESET_GESTURES.forEach(function (g) {
            fd.append('reset_' + g + '_enabled', CFG['reset_' + g + '_enabled'] ? '1' : '0');
            fd.append('reset_' + g + '_action', CFG['reset_' + g + '_action']);
        });
        fetch(saveUrl, { method: 'POST', body: fd, credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.success) {
                    SAVED = clone(CFG); updateDirty(); toast('已保存'); poll();
                } else {
                    toast('保存失败：' + ((j && j.error) ? j.error : '未知错误'));
                }
            })
            .catch(function () { toast('保存请求失败'); });
    }

    function mergeAll(d) {
        for (var k in d) if (d[k] !== undefined && d[k] !== null) CFG[k] = d[k];
        syncDerived(CFG);
        SAVED = clone(CFG);
    }
    function mergeLive(d) {
        CFG.switch_position = d.switch_position;
        CFG.blue_led = d.blue_led;
        CFG.white_led = d.white_led;
        if (d.proxies) CFG.proxies = d.proxies;
        if (d.leds) CFG.leds = d.leds;
        if (isDirty()) return;
        CFG.led_enabled = d.led_enabled;
        CFG.wifi_enabled = d.wifi_enabled;
        CFG.proxy_enabled = d.proxy_enabled;
        CFG.led_left_action = d.led_left_action;
        CFG.wifi_left_action = d.wifi_left_action;
        CFG.proxy_left_action = d.proxy_left_action;
        CFG.proxy_target = d.proxy_target;
        CFG.led_name = d.led_name;
        RESET_GESTURES.forEach(function (g) {
            CFG['reset_' + g + '_enabled'] = d['reset_' + g + '_enabled'];
            CFG['reset_' + g + '_action'] = d['reset_' + g + '_action'];
        });
        syncDerived(CFG);
        SAVED = clone(CFG);
    }

    function poll() {
        fetch(dataUrl, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.success && j.data) {
                    if (firstLoad) { mergeAll(j.data); firstLoad = false; }
                    else { mergeLive(j.data); }
                    applyUI();
                }
            })
            .catch(function () {});
    }

    /* ===== 启动 ===== */
    function boot() {
        var root = $('gl');
        dataUrl = root.getAttribute('data-url');
        saveUrl = root.getAttribute('data-save-url');

        document.addEventListener('click', function (e) {
            if (!e.target.closest('#gl .sel')) closeSels();
        });

        window.toggleSel = toggleSel;
        window.pickFunc = pickFunc;
        window.pickProxy = pickProxy;
        window.pickAct = pickAct;
        window.pickReset = pickReset;
        window.onText = onText;
        window.doRevert = doRevert;
        window.doSave = doSave;

        applyUI();
        poll();
        setInterval(poll, REFRESH_MS);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();

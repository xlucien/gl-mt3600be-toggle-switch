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
        running: { t: '运行中', c: 'run' },
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
    /* 灯名 -> 友好中文名 */
    function ledLabel(n) {
        var s = String(n || '').toLowerCase();
        if (s.indexOf('blue') >= 0) return '蓝灯';
        if (s.indexOf('white') >= 0) return '白灯';
        if (s.indexOf('green') >= 0) return '绿灯';
        if (s.indexOf('red') >= 0) return '红灯';
        if (s.indexOf('amber') >= 0 || s.indexOf('orange') >= 0) return '橙灯';
        return n;
    }
    /* 左栏下拉用：全量候选（自动 + 8 个插件，装没装都列出来） */
    function proxyList() {
        return (CFG.proxies && CFG.proxies.length) ? CFG.proxies : INIT.proxies;
    }
    /* 右栏「可控制」用：后端已过滤，只剩检测到的 */
    function proxyDetected() {
        if (CFG.proxies_detected && CFG.proxies_detected.length) return CFG.proxies_detected;
        return (CFG.proxies && CFG.proxies.length) ? CFG.proxies : INIT.proxies;
    }
    /* 默认选中正在运行的代理 */
    function runningProxy() {
        var list = proxyDetected(), i;
        for (i = 0; i < list.length; i++)
            if (list[i].state === 'running' && list[i].target !== 'auto') return list[i].target;
        return null;
    }
    function applyProxyDefault() {
        if (CFG.proxy_target && CFG.proxy_target !== 'auto') {
            var list = proxyDetected(), i, inList = false;
            for (i = 0; i < list.length; i++) if (list[i].target === CFG.proxy_target) inList = true;
            if (inList) return;          /* 已选且仍在检测列表里，尊重用户选择 */
        }
        var run = runningProxy();
        CFG.proxy_target = run ? run : 'auto';
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
        var f = deriveFunc(), seg = $('actSeg'), note = $('rightNote');
        seg.innerHTML = '';
        if (f === 'none') {
            if (note) note.innerHTML = '';
            return;
        }
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
        if (note)
            note.innerHTML = '左拨：<b>' + esc(actText(f, cur)) + '</b>；右拨：<b>'
                + esc(actText(f, !cur)) + '</b>';
    }

    /* 左栏代理下拉：全量候选，装没装都列出来。
       按用户要求只显示程序名，**不显示任何状态** —— 状态统一放右栏「可控制」。 */
    function renderProxySel() {
        var menu = $('proxyMenu'), list = proxyList();
        var html = '', i, p;
        for (i = 0; i < list.length; i++) {
            p = list[i];
            var nm = PROXY_NAME[p.target] || p.target;
            html += '<div class="opt" data-v="' + esc(p.target)
                + '" onclick="pickProxy(\'' + esc(p.target) + '\')">' + esc(nm) + '</div>';
        }
        menu.innerHTML = html;
        $('proxyLabel').textContent = PROXY_NAME[CFG.proxy_target] || CFG.proxy_target;
        markSelCur('proxyMenu', CFG.proxy_target);
    }

    /* 灯名胶囊：渲染到右栏，蓝灯/白灯都可点击多选 */
    function ledPickHtml() {
        var list = (CFG.leds && CFG.leds.length) ? CFG.leds : INIT.leds;
        var picked = ledList(CFG.led_name);
        var html = '', i;
        for (i = 0; i < list.length; i++) {
            var nm = list[i];
            var has = picked.indexOf(nm) >= 0;
            html += '<span class="ledpick' + (has ? ' on' : '') + '" data-led="' + esc(nm) + '" title="'
                + esc(nm) + '">' + esc(ledLabel(nm)) + '</span>';
        }
        return html;
    }
    function wireLedPicks() {
        var chips = document.querySelectorAll('#capBox .ledpick'), i;
        for (i = 0; i < chips.length; i++)
            chips[i].onclick = function () { toggleLed(this.getAttribute('data-led')); };
    }
    function toggleLed(name) {
        var picked = ledList(CFG.led_name), idx = picked.indexOf(name);
        if (idx >= 0) picked.splice(idx, 1); else picked.push(name);
        CFG.led_name = picked.join(' ');
        applyUI();
        markDirty();
        toast(picked.length ? ('已选 ' + picked.map(ledLabel).join('、')) : '未选择任何灯');
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
            box.innerHTML =
                '<div class="cap">' +
                '<div class="cap-h"><span class="cap-n">可控制的灯</span></div>' +
                '<div class="ledpicks">' + ledPickHtml() + '</div>' +
                '<div class="cap-d" style="margin-top:9px">点击灯名可多选，蓝灯和白灯都能单独控制。' +
                '<br>左拨：' + esc(actText(f, leftAction(f))) + '　·　右拨：' + esc(actText(f, !leftAction(f))) + '</div></div>';
            wireLedPicks();
            return;
        }

        /* 代理：只列出检测到的插件，卡片可直接点击选择 */
        var list = proxyDetected(), k, p;
        if (!list.length) {
            box.innerHTML = '<div class="cap-empty">未检测到任何代理插件。</div>';
            return;
        }
        for (k = 0; k < list.length; k++) {
            p = list[k];
            var nm = PROXY_NAME[p.target] || p.target;
            var st = PROXY_STATE[p.state] || PROXY_STATE.installed;
            var ctrl = '可启动 / 可关闭';
            if (p.target === 'auto')
                ctrl = '点此选择：按运行状态自动挑一个代理，可由滑块启停';
            else if (p.state === 'not_installed')
                ctrl = '未安装，无法控制';
            else if (p.state === 'conflict')
                ctrl = '检测到多个插件同时运行，无法确定控制目标';
            var sel = (CFG.proxy_target === p.target);
            html += '<div class="cap pick' + (sel ? ' sel' : '') + '"'
                + ' data-proxy="' + esc(p.target) + '">' +
                '<div class="cap-h"><span class="cap-n">' + esc(nm) + '</span>' +
                '<span class="pill ' + st.c + '">' + st.t + '</span>' +
                (sel ? '<span class="pill run">当前所选</span>' : '') +
                '</div>' +
                '<div class="cap-d">' + esc(ctrl) + '</div></div>';
        }
        box.innerHTML = html;
        wireProxyPicks();
    }

    function wireProxyPicks() {
        var cards = document.querySelectorAll('#capBox .cap.pick'), i;
        for (i = 0; i < cards.length; i++)
            cards[i].onclick = function () { pickProxy(this.getAttribute('data-proxy')); };
    }

    function applyUI() {
        syncDerived(CFG);
        var f = deriveFunc(), la = leftAction(f);

        $('funcLabel').textContent = FUNC_LABEL[f];
        markSelCur('funcMenu', f);

        var isLed = (f === 'led'), isProxy = (f === 'proxy'), isNone = (f === 'none');
        $('actItem').style.display = isNone ? 'none' : 'block';

        var proxyItem = $('proxyItem');
        if (proxyItem) {
            proxyItem.style.display = isProxy ? 'block' : 'none';
            if (isProxy) renderProxySel();
        }

        renderActSeg();
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
    function pickFunc(v) { closeSels(); applyFunc(v); if (v === 'proxy') applyProxyDefault(); applyUI(); markDirty(); }
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
            btn.classList.add('dirty'); btn.disabled = false;
            $('dirtyNote').style.display = 'inline-flex';
        } else {
            btn.classList.remove('dirty'); btn.disabled = true;
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
        applyProxyDefault();   /* 首次进入：默认选中正在运行的代理 */
        SAVED = clone(CFG);
    }
    function mergeLive(d) {
        CFG.switch_position = d.switch_position;
        CFG.blue_led = d.blue_led;
        CFG.white_led = d.white_led;
        if (d.proxies) CFG.proxies = d.proxies;
        if (d.proxies_detected) CFG.proxies_detected = d.proxies_detected;
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
        window.doRevert = doRevert;
        window.doSave = doSave;

        applyUI();
        poll();
        setInterval(poll, REFRESH_MS);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();

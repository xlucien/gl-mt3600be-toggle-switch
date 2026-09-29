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
        reset_triple_enabled: false, reset_triple_action: 'reboot'
    };

    var FUNC_LABEL = { none: '无功能', proxy: '代理', wifi: 'Wi-Fi', led: 'LED' };
    var PROXY_LABEL = {
        auto: '自动', passwall: 'PassWall', passwall2: 'PassWall2', openclash: 'OpenClash',
        ssrplus: 'SSR Plus+', nikki: 'Nikki', daed: 'Daed', homeproxy: 'HomeProxy', mihomo: 'Mihomo'
    };
    var ACT_LABEL = {
        wifi: { on: '开启无线', off: '关闭无线' },
        proxy: { on: '启动代理', off: '关闭代理' },
        led: { on: '打开灯光', off: '关闭灯光' }
    };
    var RESET_GESTURES = ['single', 'double', 'triple'];
    var REFRESH_MS = 3000;
    var SIM_HOLD_MS = 3000;

    function clone(o) { var r = {}, k; for (k in o) r[k] = o[k]; return r; }

    var CFG = clone(INIT);
    var SAVED = clone(INIT);
    var firstLoad = true;
    var simSide = null, simUntil = 0;
    var dataUrl = '', saveUrl = '', simUrl = '';

    function $(id) { return document.getElementById(id); }

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
    function capText(f) {
        if (f === 'proxy') return '代理程序启停 · ' + (PROXY_LABEL[CFG.proxy_target] || '自动');
        if (f === 'wifi') return '2.4G / 5G 无线开关';
        if (f === 'led') return 'LED 亮灭 · ' + (CFG.led_name || 'blue:status');
        return '滑块仅作位置指示';
    }
    function resetVal(g) {
        if (!CFG['reset_' + g + '_enabled']) return 'disabled';
        var a = CFG['reset_' + g + '_action'];
        return (a === 'led' || a === 'wifi' || a === 'reboot') ? a : 'wifi';
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
        var f = deriveFunc();
        if (f === 'none') { $('actSeg').innerHTML = ''; return; }
        var L = ACT_LABEL[f], cur = leftAction(f), seg = $('actSeg');
        seg.innerHTML = '';
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

    function applyUI() {
        syncDerived(CFG);
        var f = deriveFunc(), la = leftAction(f);

        $('funcLabel').textContent = FUNC_LABEL[f];
        markSelCur('funcMenu', f);
        $('proxySel').style.display = (f === 'proxy') ? 'inline-block' : 'none';
        $('proxyLabel').textContent = PROXY_LABEL[CFG.proxy_target] || '自动';
        markSelCur('proxyMenu', CFG.proxy_target);
        $('capText').textContent = capText(f);

        $('cfgBox').style.display = (f === 'none') ? 'none' : 'block';
        $('ledNameRow').style.display = (f === 'led') ? 'flex' : 'none';
        $('ledName').value = CFG.led_name || 'blue:status';
        renderActSeg();

        /* 演示图位置：模拟期间显示模拟方向，之后回到真实 GPIO 电平 */
        var sim = !!(simSide && Date.now() < simUntil);
        var pos = sim ? simSide : CFG.switch_position;
        var sw = $('swg');
        sw.classList.remove('left', 'right', 'sim');
        sw.classList.add(pos === 'left' ? 'left' : 'right');
        if (sim) sw.classList.add('sim');
        $('demoPos').textContent = (pos === 'left' ? '左侧' : '右侧') + (sim ? '（模拟）' : '');
        $('demoPos').className = 'tag' + (sim ? ' sim' : '');

        /* 左右拨分别执行什么 */
        $('actLeft').textContent = actText(f, la);
        $('actRight').textContent = actText(f, !la);
        $('actLeft').className = 'aval' + (f === 'none' ? ' none' : '');
        $('actRight').className = 'aval' + (f === 'none' ? ' none' : '');

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
    function onText(key, val) { CFG[key] = val; applyUI(); markDirty(); }

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

    /* ===== 保存 / 模拟 / 轮询 ===== */
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
                    SAVED = clone(CFG); updateDirty(); toast('已应用'); poll();
                } else {
                    toast('保存失败：' + ((j && j.error) ? j.error : '未知错误'));
                }
            })
            .catch(function () { toast('保存请求失败'); });
    }

    function simulate(side) {
        var sw = $('swg');
        sw.classList.add('busy');
        simSide = side; simUntil = Date.now() + SIM_HOLD_MS;
        applyUI();
        fetch(simUrl, { method: 'POST', body: new URLSearchParams({ side: side }), credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                sw.classList.remove('busy');
                if (j && j.success) {
                    mergeLive(j.data); applyUI();
                    toast(side === 'left' ? '已模拟拨到左侧' : '已模拟拨到右侧');
                } else {
                    simUntil = 0; applyUI(); toast('模拟失败');
                }
            })
            .catch(function () {
                sw.classList.remove('busy'); simUntil = 0; applyUI(); toast('模拟请求失败');
            });
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
        simUrl = root.getAttribute('data-sim-url');

        document.addEventListener('click', function (e) {
            if (!e.target.closest('#gl .sel')) closeSels();
        });

        /* 把事件挂到 window，供模板里的 onclick 调用 */
        window.toggleSel = toggleSel;
        window.pickFunc = pickFunc;
        window.pickProxy = pickProxy;
        window.pickAct = pickAct;
        window.pickReset = pickReset;
        window.onText = onText;
        window.doRevert = doRevert;
        window.doSave = doSave;
        window.simulate = simulate;

        applyUI();
        poll();
        setInterval(poll, REFRESH_MS);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();

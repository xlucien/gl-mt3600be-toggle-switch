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
    var SAVED_CUSTOM = [];
    var firstLoad = true;
    var dataUrl = '', saveUrl = '', applyUrl = '', defaultsUrl = '', searchUrl = '';
    /* 用户自己搜出来并选中的自定义代理（预设 8 个之外），保存时整份回传给后端 */
    var CUSTOM = [];

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
    /* ===== 灯光模式：单独蓝灯 / 单独白灯 / 双色灯 ===== */
    var LED_MODES = [
        { v: 'blue',  t: '单独蓝灯', d: '只控制蓝色运行灯，白灯保持不动' },
        { v: 'white', t: '单独白灯', d: '只控制白色状态灯，蓝灯保持不动' },
        { v: 'both',  t: '双色灯',   d: '蓝灯和白灯一起亮灭' }
    ];
    /* 已检测到的灯（后端来自 /sys/class/leds），匹配不到就退化成默认两颗 */
    function ledPool() {
        return (CFG.leds && CFG.leds.length) ? CFG.leds : INIT.leds;
    }
    function ledPickOne(kind) {
        var pool = ledPool(), i, s;
        for (i = 0; i < pool.length; i++) {
            s = String(pool[i]).toLowerCase();
            if (s.indexOf(kind) >= 0) return pool[i];
        }
        return null;
    }
    /* 模式 -> 灯名数组（与后端 led_mode_names() 同一套规则） */
    function modeNames(mode) {
        var pool = ledPool(), i, out = [];
        if (mode === 'both') {
            for (i = 0; i < pool.length; i++) out.push(pool[i]);
            return out;
        }
        var one = ledPickOne(mode === 'white' ? 'white' : 'blue');
        if (one) return [one];
        return pool.length ? [pool[0]] : [];
    }
    /* 灯名 -> 模式（后端已算好 led_mode，这里只做兜底） */
    function namesToMode(name) {
        var picked = ledList(name), blue = false, white = false, i, s;
        for (i = 0; i < picked.length; i++) {
            s = String(picked[i]).toLowerCase();
            if (s.indexOf('blue') >= 0) blue = true;
            if (s.indexOf('white') >= 0) white = true;
        }
        if (picked.length > 1) return 'both';
        if (white && !blue) return 'white';
        return 'blue';
    }
    function curLedMode() { return CFG.led_mode || namesToMode(CFG.led_name); }
    function ledModeNames() {
        var m = curLedMode(), out = [], i;
        for (i = 0; i < LED_MODES.length; i++) if (LED_MODES[i].v === m) out.push(LED_MODES[i].t);
        return out.join('、');
    }
    /* 左栏下拉用：全量候选（自动 + 8 个插件，装没装都列出来） */
    function proxyList() {
        return (CFG.proxies && CFG.proxies.length) ? CFG.proxies : INIT.proxies;
    }
    /* 右栏「可控制」用：后端已过滤，只剩检测到的 */
    function proxyDetected() {
        var list = (CFG.proxies_detected && CFG.proxies_detected.length)
            ? CFG.proxies_detected.slice()
            : ((CFG.proxies && CFG.proxies.length) ? CFG.proxies.slice() : INIT.proxies.slice());
        /* 自定义目标始终保留在列表里：用户既然选过，就不该因为一次探测失败而消失 */
        var i, j, found;
        for (i = 0; i < CUSTOM.length; i++) {
            found = false;
            for (j = 0; j < list.length; j++) if (list[j].target === CUSTOM[i]) found = true;
            if (!found)
                list.push({ target: CUSTOM[i], state: 'not_installed', configured: false, running: false });
        }
        return list;
    }
    /* 自定义代理（搜索结果里选中的、预设之外的程序） */
    function isCustom(t) {
        var i;
        for (i = 0; i < CUSTOM.length; i++) if (CUSTOM[i] === t) return true;
        return false;
    }
    function addCustom(t) {
        if (!t || PROXY_NAME[t]) return;          /* 预设的不算自定义 */
        if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(t)) return;
        if (isCustom(t)) return;
        CUSTOM.push(t);
    }
    function dropCustom(t) {
        var out = [], i;
        for (i = 0; i < CUSTOM.length; i++) if (CUSTOM[i] !== t) out.push(CUSTOM[i]);
        CUSTOM = out;
        if (CFG.proxy_target === t) CFG.proxy_target = 'auto';
        applyUI(); markDirty();
        toast('已移除自定义代理：' + t);
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

    /* 左栏代理程序：和「左拨动作」一样用分段按钮，点一下即选。
       【候选要列全】预设 8 个 + auto + 用户自定义过的，装没装都列出来 ——
       用户要求「左边下拉的可以选择的很多，都列出来」，只列检测到的
       会让这台只装了 daed 的机器看起来几乎没有可选项。
       未安装的灰显且不可点（选了也控制不了），状态文字统一放右栏，这里只给名字。 */
    function renderProxySeg() {
        var seg = $('proxySeg');
        if (!seg) return;
        var list = proxyList(), html = '', i, p;
        for (i = 0; i < list.length; i++) {
            p = list[i];
            var nm = PROXY_NAME[p.target] || p.target;
            var dead = (p.state === 'not_installed');
            html += '<button type="button" data-v="' + esc(p.target) + '"'
                + (dead ? ' class="dim" disabled title="未安装"'
                        : ' onclick="pickProxy(\'' + esc(p.target) + '\')"')
                + '>' + esc(nm) + '</button>';
        }
        seg.innerHTML = html;
        setSegActive('proxySeg', CFG.proxy_target);
    }

    /* 灯光模式三选一：三张可点选的卡片，点哪张就是哪种模式 */
    function pickLedMode(mode) {
        CFG.led_mode = mode;
        CFG.led_name = modeNames(mode).join(' ');
        applyUI();
        markDirty();
        toast('灯光模式：' + ledModeNames());
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
            var cur = curLedMode(), i, m, names = modeNames(cur).join(' + ');
            for (i = 0; i < LED_MODES.length; i++) {
                m = LED_MODES[i];
                var sel = (m.v === cur);
                html += '<div class="cap pick' + (sel ? ' sel' : '') + '" data-ledmode="' + esc(m.v) + '">' +
                    '<div class="cap-h"><span class="cap-n">' + esc(m.t) + '</span>' +
                    (sel ? '<span class="pill run">当前所选</span>' : '') +
                    '</div>' +
                    '<div class="cap-d">' + esc(m.d) + '</div></div>';
            }
            html += '<div class="cap">' +
                '<div class="cap-h"><span class="cap-n">受控灯</span>' +
                '<span class="pill idle">' + esc(names || '—') + '</span></div>' +
                '<div class="cap-d">左拨：<b>' + esc(actText(f, leftAction(f))) + '</b>' +
                '　右拨：<b>' + esc(actText(f, !leftAction(f))) + '</b></div></div>';
            box.innerHTML = html;
            wireLedModePicks();
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
                ctrl = '按运行状态自动挑一个代理，可由滑块启停';
            else if (p.state === 'not_installed')
                ctrl = '未安装或启停脚本缺失，无法控制';
            else if (p.state === 'conflict')
                ctrl = '检测到多个插件同时运行，无法确定控制目标';
            var sel = (CFG.proxy_target === p.target);
            html += '<div class="cap pick' + (sel ? ' sel' : '') + '"'
                + ' data-proxy="' + esc(p.target) + '">' +
                '<div class="cap-h"><span class="cap-n">' + esc(nm) + '</span>' +
                '<span class="pill ' + st.c + '">' + st.t + '</span>' +
                (sel ? '<span class="pill run">当前所选</span>' : '') +
                (isCustom(p.target)
                    ? '<span class="cap-x" onclick="event.stopPropagation();dropCustom(\''
                        + esc(p.target) + '\')">移除</span>'
                    : '') +
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
    function wireLedModePicks() {
        var cards = document.querySelectorAll('#capBox .cap[data-ledmode]'), i;
        for (i = 0; i < cards.length; i++)
            cards[i].onclick = function () { pickLedMode(this.getAttribute('data-ledmode')); };
    }

    /* 开关演示右侧：RESET 三个手势当前绑定了什么 */
    var RESET_LABEL = { disabled: '禁用', led: 'LED', wifi: '无线', reboot: '重启' };
    var RESET_IDS = { single: 'dsSingle', double: 'dsDouble', triple: 'dsTriple' };
    function renderResetSummary() {
        RESET_GESTURES.forEach(function (g) {
            var el = $(RESET_IDS[g]);
            if (!el) return;
            var v = resetVal(g);
            el.textContent = RESET_LABEL[v] || v;
            el.className = 'ds-v' + (v === 'disabled' ? ' off' : '');
        });
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
            if (isProxy) renderProxySeg();
        }

        renderActSeg();
        renderCap(f);
        renderResetSummary();

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
    /* 这些字段是「实时状态」不是「用户配置」：每 3 秒刷新一次，
       不能因为它们变了就把保存按钮点亮（否则什么都没改也是脏的）。 */
    var VOLATILE = {
        switch_position: 1, blue_led: 1, white_led: 1,
        proxies: 1, proxies_detected: 1, leds: 1, proxies_custom: 1,
        reset_status: 1, proxy_status: 1
    };
    function isDirty() {
        var keys = Object.keys(SAVED), i;
        for (i = 0; i < keys.length; i++) {
            if (VOLATILE[keys[i]]) continue;
            if (JSON.stringify(CFG[keys[i]]) !== JSON.stringify(SAVED[keys[i]])) return true;
        }
        /* 自定义代理的增删也算改动（哪怕当前选中的目标没变） */
        if (CUSTOM.join(' ') !== SAVED_CUSTOM.join(' ')) return true;
        return false;
    }
    /* 与风扇控制一致：左边胶囊常驻显示「已同步 / 有未保存的修改」，
       右边「放弃修改 / 保存」仅在脏时可用；「保存并应用」任何时候都能点
       （即使没有改动，也可以用来把当前配置立刻重新执行一遍）。 */
    function updateDirty() {
        var d = isDirty();
        var note = $('dirtyNote');
        note.className = 'pill ' + (d ? 'dirty' : 'idle');
        note.innerHTML = '<i></i>' + (d ? '有未保存的修改' : '已同步');
        $('saveHint').textContent = d
            ? '「保存」只写配置；「保存并应用」还会立刻按当前位置执行一次'
            : '改动后需点击「保存」或「保存并应用」';
        $('btnRevert').disabled = !d;
        $('btnSave').disabled = !d;
        $('btnApply').classList.toggle('dirty', d);
    }
    function markDirty() { updateDirty(); }
    function doRevert() { CFG = clone(SAVED); CUSTOM = (SAVED_CUSTOM || []).slice(); applyUI(); toast('已放弃修改'); }

    /* ===== 保存 / 轮询 =====
       两个按钮共用这一份表单：
         doSave()  -> action_save  ：只写配置（灯态会顺带对齐，不动 Wi-Fi / 代理）
         doApply() -> action_apply ：写配置 + 立刻按当前开关位置执行一次动作 */
    function saveForm() {
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
        fd.append('led_mode', curLedMode());
        fd.append('led_name', modeNames(curLedMode()).join(' '));
        RESET_GESTURES.forEach(function (g) {
            fd.append('reset_' + g + '_enabled', CFG['reset_' + g + '_enabled'] ? '1' : '0');
            fd.append('reset_' + g + '_action', CFG['reset_' + g + '_action']);
        });
        /* 自定义代理整份回传，后端按这份覆盖 UCI list proxy_custom */
        fd.append('proxy_custom', CUSTOM.join(' '));
        return fd;
    }

    function postSave(url, okMsg) {
        fetch(url, { method: 'POST', body: saveForm(), credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.success) {
                    SAVED = clone(CFG); SAVED_CUSTOM = CUSTOM.slice();
                    updateDirty(); toast(okMsg); poll();
                } else {
                    toast('保存失败：' + ((j && j.error) ? j.error : '未知错误'));
                }
            })
            .catch(function () { toast('保存请求失败'); });
    }
    function doSave() { postSave(saveUrl, '已保存（配置已写入）'); }
    function doApply() { postSave(applyUrl, '已保存并应用'); }

    /* ===== 自定义代理搜索 ===== */
    var SRC_LABEL = { initd: '启停脚本', config: '配置文件', opkg: '已安装包' };
    function srcText(arr) {
        var out = [], i;
        if (!arr) return '';
        for (i = 0; i < arr.length; i++) out.push(SRC_LABEL[arr[i]] || arr[i]);
        return out.join(' · ');
    }
    function doProxySearch() {
        var kw = ($('proxyKw').value || '').replace(/^\s+|\s+$/g, '');
        if (!kw) { toast('先输入关键词，比如 xray、clash、sing-box'); return; }
        var btn = $('btnProxyFind');
        btn.disabled = true; btn.textContent = '检测中';
        var fd = new FormData();
        fd.append('kw', kw);
        fetch(searchUrl, { method: 'POST', body: fd, credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                btn.disabled = false; btn.textContent = '检测';
                if (j && j.success) renderFind(j.items || []);
                else toast('检测失败：' + ((j && j.error) ? j.error : '未知错误'));
            })
            .catch(function () {
                btn.disabled = false; btn.textContent = '检测';
                toast('检测请求失败');
            });
    }
    function renderFind(items) {
        var box = $('proxyFind'), html = '', i, it;
        if (!items.length) {
            box.innerHTML = '<div class="hint">系统上没有找到名字相近的程序，换个关键词试试。</div>';
            return;
        }
        for (i = 0; i < items.length; i++) {
            it = items[i];
            var sel = (CFG.proxy_target === it.target);
            var can = !!it.has_init;
            html += '<div class="frow' + (can ? ' click' : '') + (sel ? ' sel' : '') + '"'
                + (can ? ' onclick="pickProxyFind(\'' + esc(it.target) + '\')"' : '') + '>'
                + '<span class="fn">' + esc(it.label) + '</span>'
                + '<span class="fsrc">' + esc(srcText(it.src)) + '</span>'
                + (can
                    ? '<span class="fbtn">' + (sel ? '已选择' : '选择') + '</span>'
                    : '<span class="fbtn grey">无启停脚本</span>')
                + '</div>';
        }
        box.innerHTML = html;
    }
    /* 选中搜索结果：预设之外的记为自定义，保存时一起回传 */
    function pickProxyFind(name) {
        addCustom(name);
        CFG.proxy_target = name;
        applyUI(); markDirty();
        toast('已选择：' + name + '　（记得保存）');
    }

    function mergeAll(d) {
        for (var k in d) if (d[k] !== undefined && d[k] !== null) CFG[k] = d[k];
        syncDerived(CFG);
        CUSTOM = (d.proxies_custom || []).slice();
        applyProxyDefault();   /* 首次进入：默认选中正在运行的代理 */
        SAVED = clone(CFG);
        SAVED_CUSTOM = CUSTOM.slice();
    }
    function mergeLive(d) {
        CFG.switch_position = d.switch_position;
        CFG.blue_led = d.blue_led;
        CFG.white_led = d.white_led;
        if (d.proxies) CFG.proxies = d.proxies;
        if (d.proxies_detected) CFG.proxies_detected = d.proxies_detected;
        if (d.leds) CFG.leds = d.leds;
        if (d.proxies_custom) CUSTOM = d.proxies_custom.slice();
        if (isDirty()) return;
        CFG.led_enabled = d.led_enabled;
        CFG.wifi_enabled = d.wifi_enabled;
        CFG.proxy_enabled = d.proxy_enabled;
        CFG.led_left_action = d.led_left_action;
        CFG.wifi_left_action = d.wifi_left_action;
        CFG.proxy_left_action = d.proxy_left_action;
        CFG.proxy_target = d.proxy_target;
        CFG.led_name = d.led_name;
        CFG.led_mode = d.led_mode;
        RESET_GESTURES.forEach(function (g) {
            CFG['reset_' + g + '_enabled'] = d['reset_' + g + '_enabled'];
            CFG['reset_' + g + '_action'] = d['reset_' + g + '_action'];
        });
        syncDerived(CFG);
        SAVED = clone(CFG);
    }

    /* 恢复默认设置：后端直接写回出厂默认，成功后重新拉一次配置 */
    function doDefaults() {
        if (!window.confirm('确定恢复默认设置？\n\n滑块将变为无功能，LED 档只控蓝灯，RESET 三个手势全部禁用。')) return;
        fetch(defaultsUrl, { method: 'POST', credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.success) {
                    firstLoad = true;      /* 让下一次 poll 全量覆盖本地状态 */
                    toast('已恢复默认设置');
                    poll();
                } else {
                    toast('恢复失败：' + ((j && j.error) ? j.error : '未知错误'));
                }
            })
            .catch(function () { toast('恢复请求失败'); });
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
        applyUrl = root.getAttribute('data-apply-url');
        searchUrl = root.getAttribute('data-search-url');
        defaultsUrl = root.getAttribute('data-defaults-url');

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
        window.doApply = doApply;
        window.doDefaults = doDefaults;
        window.doProxySearch = doProxySearch;
        window.pickProxyFind = pickProxyFind;
        window.dropCustom = dropCustom;

        applyUI();
        poll();
        setInterval(poll, REFRESH_MS);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();

'use strict';
'require view';

    var apiUrl = '/cgi-bin/luci/admin/system/toggle/api';
    var app, saveBtn, statusText, errorDiv, globalStatusText;
    var proxyEnable, proxyTarget, proxyStatusText, proxyDetectBtn;
    var resetControls = {};
    var currentMode = '0';
    var statusInterval = null;

    var controls = {};

    function $(sel) { return document.querySelector(sel); }

    function create(tag, attrs, children) {
        var el = document.createElement(tag);
        if (attrs) {
            for (var k in attrs) {
                if (k === 'checked') {
                    if (attrs[k] === true) el.checked = true;
                } else if (k === 'text') {
                    el.textContent = attrs[k];
                } else {
                    el.setAttribute(k, attrs[k]);
                }
            }
        }
        if (children) {
            for (var i = 0; i < children.length; i++) {
                var c = children[i];
                if (typeof c === 'string') el.appendChild(document.createTextNode(c));
                else el.appendChild(c);
            }
        }
        return el;
    }

    function wrapSelect(select) {
        return create('div', { 'class': 'select-wrap' }, [
            select,
            create('span', { 'class': 'select-arrow', 'text': '▾' })
        ]);
    }

    function showError(msg) {
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = '❌ ' + msg;
        }
        console.error('[toggle]', msg);
    }
    function hideError() { if (errorDiv) errorDiv.style.display = 'none'; }

    function post(data, callback) {
        var bodyData = {};
        for (var k in data) bodyData[k] = data[k];
        if (typeof csrf_token !== 'undefined' && csrf_token) bodyData.token = csrf_token;
        var body = Object.keys(bodyData).map(function(k){
            return encodeURIComponent(k) + '=' + encodeURIComponent(bodyData[k]);
        }).join('&');

        var xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl, true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        if (typeof csrf_token !== 'undefined' && csrf_token) {
            xhr.setRequestHeader('X-CSRF-Token', csrf_token);
        }
        xhr.onload = function() {
            if (xhr.status === 200) {
                try { callback(JSON.parse(xhr.responseText)); }
                catch(e) { callback({success:false, error:_('Invalid response')}); }
            } else {
                callback({success:false, error:'请求失败：' + xhr.status});
            }
        };
        xhr.onerror = function() { callback({success:false, error:_('Network error')}); };
        xhr.send(body);
    }

    function fetchMode() {
        var xhr = new XMLHttpRequest();
        var url = apiUrl + '?brief=1&_=' + Date.now() + '&r=' + Math.random();
        xhr.open('GET', url, true);
        xhr.setRequestHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        xhr.setRequestHeader('Pragma', 'no-cache');
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var resp = JSON.parse(xhr.responseText);
                    if (resp.success && resp.data) {
                        updateMode(resp.data.current_mode);
                    }
                } catch(e) {}
            }
        };
        xhr.send();
    }

    function updateMode(mode) {
        if (!statusText) return;
        currentMode = (mode === '1' || mode === 1) ? '1' : '0';
        var txt = (mode === '1' || mode === 1) ? '右侧' : '左侧';
        statusText.textContent = '当前滑动开关位置：' + txt;
    }

    function updateGlobalStatus(enabled) {
        if (!globalStatusText) return;
        if (enabled === 'pending') {
            globalStatusText.textContent = '待保存';
            globalStatusText.className = 'control-status is-pending';
            return;
        }
        globalStatusText.textContent = enabled ? '已启用' : '未启用';
        globalStatusText.className = 'control-status ' + (enabled ? 'is-enabled' : 'is-disabled');
    }

    function enableOnlyFeature(active) {
        if (active !== 'led' && controls.led) controls.led.enabled.checked = false;
        if (active !== 'wifi' && controls.wifi) controls.wifi.enabled.checked = false;
        if (active !== 'proxy' && proxyEnable) proxyEnable.checked = false;
    }

    // LED、WiFi、代理控制三者互斥；旧配置冲突时按代理、WiFi、LED保留一个。
    function applyMutexRules() {
        if (proxyEnable && proxyEnable.checked) enableOnlyFeature('proxy');
        else if (controls.wifi && controls.wifi.enabled.checked) enableOnlyFeature('wifi');
        else if (controls.led && controls.led.enabled.checked) enableOnlyFeature('led');
    }

    // ===== 左右互斥：左右不能同时相同 =====
    function setupOppositeMutex(prefix) {
        if (!controls[prefix]) return;
        var g = controls[prefix];

        function setLeftRight(leftIsOn) {
            g.left_on.checked = leftIsOn;
            g.left_off.checked = !leftIsOn;
            g.right_on.checked = !leftIsOn;
            g.right_off.checked = leftIsOn;
        }

        g.left_on.addEventListener('change', function() {
            if (this.checked) setLeftRight(true);
        });
        g.left_off.addEventListener('change', function() {
            if (this.checked) setLeftRight(false);
        });
        g.right_on.addEventListener('change', function() {
            if (this.checked) setLeftRight(false);
        });
        g.right_off.addEventListener('change', function() {
            if (this.checked) setLeftRight(true);
        });
    }

    function buildFunctionBlock(title, prefix, data, actionLabels) {
        var block = create('div', { 'class': 'func-block' });
        block.appendChild(create('div', { 'class': 'func-title', 'text': title }));

        var rowEnable = create('div', { 'class': 'toggle-item' });
        var labelEnable = create('span', { 'class': 'toggle-label', 'text': '启用' });
        var inputEnable = create('input', { 'type': 'checkbox', 'checked': data[prefix + '_enabled'] === true });
        var switchLabel = create('label', { 'class': 'toggle-switch' }, [
            inputEnable,
            create('span', { 'class': 'toggle-slider' })
        ]);
        rowEnable.appendChild(labelEnable);
        rowEnable.appendChild(switchLabel);
        block.appendChild(rowEnable);

        block.appendChild(create('div', { 'class': 'divider' }));

        var labelLeft = create('div', { 'class': 'section-label', 'text': '左侧' });
        block.appendChild(labelLeft);
        var leftVal = data[prefix + '_left_action'] === true;
        var rowLeft = createRadioRow(prefix + '_left_action', leftVal, actionLabels);
        block.appendChild(rowLeft.row);

        var labelRight = create('div', { 'class': 'section-label', 'text': '右侧' });
        block.appendChild(labelRight);
        var rightVal = data[prefix + '_right_action'] === true;
        var rowRight = createRadioRow(prefix + '_right_action', rightVal, actionLabels);
        block.appendChild(rowRight.row);

        controls[prefix] = {
            enabled: inputEnable,
            left_on: rowLeft.input_on,
            left_off: rowLeft.input_off,
            right_on: rowRight.input_on,
            right_off: rowRight.input_off
        };

        setupOppositeMutex(prefix);

        inputEnable.addEventListener('change', function() {
            if (inputEnable.checked) enableOnlyFeature(prefix);
        });

        return block;
    }

    function createRadioRow(name, onChecked, labels) {
        var row = create('div', { 'class': 'radio-row' });
        var input_on  = create('input', { 'type': 'radio', 'name': name, 'id': name + '_on',  'checked': onChecked });
        var label_on  = create('label', { 'for': name + '_on', 'text': labels[0] });
        var spacer    = create('span', { 'class': 'spacer' });
        var input_off = create('input', { 'type': 'radio', 'name': name, 'id': name + '_off', 'checked': !onChecked });
        var label_off = create('label', { 'for': name + '_off', 'text': labels[1] });
        row.appendChild(input_on);
        row.appendChild(label_on);
        row.appendChild(spacer);
        row.appendChild(input_off);
        row.appendChild(label_off);
        return { row: row, input_on: input_on, input_off: input_off };
    }

    function proxyLabel(target) {
        var labels = {
            none: '无', conflict: '检测到多个代理', passwall: 'PassWall', passwall2: 'PassWall2',
            openclash: 'OpenClash', ssrplus: 'SSR Plus', nikki: 'Nikki',
            daed: 'daed', homeproxy: 'HomeProxy', mihomo: 'MihomoTProxy'
        };
        return labels[target] || target;
    }

    function renderProxyStatus(status) {
        status = status || { target: 'none', state: 'not_installed' };
        var states = {
            not_installed: '未安装', installed: '已安装，未启用',
            running: '正在运行', error: '配置已启用，但启动异常',
            conflict: '检测到多个代理，请手动选择'
        };
        proxyStatusText.className = 'proxy-status status-' + status.state;
        proxyStatusText.textContent = '运行状态：' +
            (status.target === 'none' ? '' : proxyLabel(status.target) + ' · ') +
            (states[status.state] || status.state);
    }

    function buildProxyPane(data) {
        var pane = create('div', { 'class': 'control-section', 'id': 'proxy-pane' });
        var card = create('div', { 'class': 'proxy-card' });
        card.appendChild(create('div', { 'class': 'func-title', 'text': '🌐 代理设置' }));

        var enableRow = create('div', { 'class': 'toggle-item proxy-row' });
        enableRow.appendChild(create('span', { 'class': 'toggle-label', 'text': '启用代理滑动开关控制' }));
        proxyEnable = create('input', { 'type': 'checkbox', 'checked': data.proxy_enabled === true });
        proxyEnable.addEventListener('change', function() {
            if (proxyEnable.checked) enableOnlyFeature('proxy');
        });
        enableRow.appendChild(create('label', { 'class': 'toggle-switch' }, [proxyEnable, create('span', { 'class': 'toggle-slider' })]));
        card.appendChild(enableRow);

        var selectRow = create('div', { 'class': 'proxy-field' });
        selectRow.appendChild(create('label', { 'text': '代理程序' }));
        proxyTarget = create('select', { 'class': 'proxy-select' });
        var choices = [
            ['auto', '自动检测'], ['passwall', 'PassWall'], ['passwall2', 'PassWall2'], ['openclash', 'OpenClash'],
            ['ssrplus', 'SSR Plus'], ['nikki', 'Nikki'], ['daed', 'daed'],
            ['homeproxy', 'HomeProxy'], ['mihomo', 'MihomoTProxy']
        ];
        choices.forEach(function(item) {
            var option = create('option', { 'value': item[0], 'text': item[1] });
            if ((data.proxy_target || 'auto') === item[0]) option.selected = true;
            proxyTarget.appendChild(option);
        });
        selectRow.appendChild(wrapSelect(proxyTarget));
        card.appendChild(selectRow);

        var actions = create('div', { 'class': 'proxy-actions proxy-action-settings hidden-control-source' });
        var leftAction = create('div', { 'class': 'proxy-action' });
        leftAction.appendChild(create('div', { 'class': 'section-label', 'text': '左拨' }));
        var leftRadios = createRadioRow('proxy_left_action', data.proxy_left_action === true, ['打开代理', '关闭代理']);
        leftAction.appendChild(leftRadios.row);
        var rightAction = create('div', { 'class': 'proxy-action' });
        rightAction.appendChild(create('div', { 'class': 'section-label', 'text': '右拨' }));
        var rightRadios = createRadioRow('proxy_right_action', data.proxy_right_action === true, ['打开代理', '关闭代理']);
        rightAction.appendChild(rightRadios.row);
        actions.appendChild(leftAction);
        actions.appendChild(rightAction);
        card.appendChild(actions);

        controls.proxy = {
            enabled: proxyEnable,
            left_on: leftRadios.input_on,
            left_off: leftRadios.input_off,
            right_on: rightRadios.input_on,
            right_off: rightRadios.input_off
        };
        setupOppositeMutex('proxy');

        proxyStatusText = create('div', { 'class': 'proxy-status' });
        card.appendChild(proxyStatusText);
        renderProxyStatus(data.proxy_status);

        proxyDetectBtn = create('button', { 'class': 'btn-detect', 'text': '重新检测' });
        proxyDetectBtn.addEventListener('click', function() {
            proxyDetectBtn.disabled = true;
            post({ action: 'detect_proxy', proxy_target: proxyTarget.value }, function(resp) {
                proxyDetectBtn.disabled = false;
                if (resp.success) renderProxyStatus(resp.proxy_status);
                else showError(resp.error || '检测失败');
            });
        });
        card.appendChild(proxyDetectBtn);
        pane.appendChild(card);
        return pane;
    }

    function resetActionLabel(value) {
        return { wifi: '切换 WiFi', led: '切换灯光', reboot: '重启设备', factory_reset: '恢复出厂设置' }[value] || value;
    }

    function buildResetActionRow(gesture, title, data) {
        var row = create('div', { 'class': 'reset-action-row' });
        var head = create('div', { 'class': 'reset-action-head' });
        head.appendChild(create('strong', { 'text': title }));
        var enabled = create('input', { 'type': 'checkbox', 'checked': data['reset_' + gesture + '_enabled'] === true });
        head.appendChild(create('label', { 'class': 'toggle-switch' }, [enabled, create('span', { 'class': 'toggle-slider' })]));
        row.appendChild(head);
        var select = create('select', { 'class': 'proxy-select' });
        [['wifi', '切换 WiFi'], ['led', '切换灯光'], ['reboot', '重启设备']].forEach(function(item) {
            var option = create('option', { 'value': item[0], 'text': item[1] });
            if (data['reset_' + gesture + '_action'] === item[0]) option.selected = true;
            select.appendChild(option);
        });
        row.appendChild(wrapSelect(select));
        resetControls[gesture] = { enabled: enabled, action: select };
        return row;
    }

    function buildResetPane(data) {
        var pane = create('div', { 'class': 'control-section', 'id': 'reset-pane' });
        var card = create('div', { 'class': 'proxy-card reset-card' });
        card.appendChild(create('div', { 'class': 'func-title', 'text': '按键设置' }));
        card.appendChild(create('div', { 'class': 'reset-note', 'text': 'RESET 重置键独立运行，不受滑动开关影响。连续点击间隔为 1.2 秒；单击、双击和三击默认关闭。' }));
        card.appendChild(buildResetActionRow('single', '单击', data));
        card.appendChild(buildResetActionRow('double', '双击', data));
        card.appendChild(buildResetActionRow('triple', '三击', data));

        var longRow = create('div', { 'class': 'reset-long-row' });
        longRow.appendChild(create('strong', { 'text': '长按 5 秒' }));
        longRow.appendChild(create('span', { 'class': 'reset-protected', 'text': '恢复出厂设置（始终启用）' }));
        card.appendChild(longRow);

        var recent = data.reset_status || {};
        var recentText = '最近动作：暂无';
        if (recent.gesture && recent.gesture !== 'none') {
            var gestureText = { single: '单击', double: '双击', triple: '三击', long: '长按' }[recent.gesture] || recent.gesture;
            var resultText = {
                disabled: '未启用', led_on: '灯光已打开', led_off: '灯光已关闭',
                wifi_off: 'WiFi 已关闭', wifi_restored: 'WiFi 已恢复',
                no_wifi_snapshot: '没有可恢复的 WiFi 状态', executing: '执行中', unsupported: '不支持'
            }[recent.result] || recent.result;
            recentText = '最近动作：' + gestureText + ' · ' + resetActionLabel(recent.action) + ' · ' + resultText;
            if (recent.time) recentText += ' · ' + recent.time;
        }
        card.appendChild(create('div', { 'class': 'reset-recent', 'text': recentText }));
        pane.appendChild(card);
        return pane;
    }

    function syncControlsFromData(data) {
        updateGlobalStatus(data.global_enabled === true);
        for (var prefix in controls) {
            if (controls.hasOwnProperty(prefix)) {
                var group = controls[prefix];
                group.enabled.checked = data[prefix + '_enabled'] === true;
                var leftChecked = data[prefix + '_left_action'] === true;
                var rightChecked = data[prefix + '_right_action'] === true;
                group.left_on.checked = leftChecked;
                group.left_off.checked = !leftChecked;
                group.right_on.checked = rightChecked;
                group.right_off.checked = !rightChecked;
            }
        }
        applyMutexRules();
    }

    function syncControlsFromPost(postData) {
        updateGlobalStatus(postData.global_enabled === '1');
        for (var prefix in controls) {
            if (controls.hasOwnProperty(prefix)) {
                var group = controls[prefix];
                var enabled = postData[prefix + '_enabled'] === '1';
                var left = postData[prefix + '_left_action'] === '1';
                var right = postData[prefix + '_right_action'] === '1';
                group.enabled.checked = enabled;
                group.left_on.checked = left;
                group.left_off.checked = !left;
                group.right_on.checked = right;
                group.right_off.checked = !right;
            }
        }
        applyMutexRules();
    }

    function buildUI(data) {
        data = data || {};
        app = $('#toggle-app');
        if (!app) return;

        if (statusInterval) {
            clearInterval(statusInterval);
            statusInterval = null;
        }

        errorDiv = document.getElementById('toggle-error');
        hideError();
        app.innerHTML = '';

        var tabBar = create('div', { 'class': 'tabs page-tabs' });
        var paddleTab = create('button', { 'type': 'button', 'class': 'tab-button active', 'text': '滑动开关' });
        var resetTab = create('button', { 'type': 'button', 'class': 'tab-button', 'text': 'RESET 重置键' });
        tabBar.appendChild(paddleTab); tabBar.appendChild(resetTab); app.appendChild(tabBar);
        var paddlePage = create('div', { 'class': 'tab-page active' });
        var resetPage = create('div', { 'class': 'tab-page' });
        app.appendChild(paddlePage); app.appendChild(resetPage);

        function selectPage(page) {
            var paddle = page === 'paddle';
            paddleTab.classList.toggle('active', paddle);
            resetTab.classList.toggle('active', !paddle);
            paddlePage.classList.toggle('active', paddle);
            resetPage.classList.toggle('active', !paddle);
        }
        paddleTab.addEventListener('click', function() { selectPage('paddle'); });
        resetTab.addEventListener('click', function() { selectPage('reset'); });

        var modeTxt = (data.current_mode === '1' || data.current_mode === 1) ? '右侧' : '左侧';
        currentMode = (data.current_mode === '1' || data.current_mode === 1) ? '1' : '0';
        var modeBar = create('div', { 'class': 'current-mode' });
        statusText = create('span', { 'class': 'mode-position', 'text': '当前滑动开关位置：' + modeTxt });
        var rowGlobal = create('div', { 'class': 'mode-global' });
        rowGlobal.appendChild(create('span', { 'text': '滑动开关状态' }));
        globalStatusText = create('span', { 'class': 'control-status', 'text': data.global_enabled === true ? '已启用' : '未启用' });
        rowGlobal.appendChild(globalStatusText);
        updateGlobalStatus(data.global_enabled === true);
        modeBar.appendChild(statusText);
        modeBar.appendChild(rowGlobal);
        paddlePage.appendChild(modeBar);

        var basicPane = create('div', { 'class': 'control-section', 'id': 'basic-pane' });
        var gridBox = create('div', { 'class': 'grid-box function-proxy-grid' });
        var combined = create('div', { 'class': 'func-block combined-card' });
        combined.appendChild(create('div', { 'class': 'func-title', 'text': '功能设置' }));
        var featureRow = create('div', { 'class': 'proxy-field feature-picker' });
        featureRow.appendChild(create('label', { 'text': '控制功能' }));
        var featureSelect = create('select', { 'class': 'proxy-select' });
        var selectedFeature = data.proxy_enabled ? 'proxy' : (data.wifi_enabled ? 'wifi' : (data.led_enabled ? 'led' : 'none'));
        [['none', '不启用'], ['led', 'LED'], ['wifi', 'WiFi'], ['proxy', '代理']].forEach(function(item) {
            var opt = create('option', { 'value': item[0], 'text': item[1] });
            if (selectedFeature === item[0]) opt.selected = true;
            featureSelect.appendChild(opt);
        });
        featureRow.appendChild(wrapSelect(featureSelect));
        combined.appendChild(featureRow);
        var ledBlock = buildFunctionBlock('🔦 LED', 'led', data, ['开', '关']);
        var wifiBlock = buildFunctionBlock('📶 WiFi', 'wifi', data, ['开', '关']);
        ledBlock.className += ' combined-feature hidden-control-source';
        wifiBlock.className += ' combined-feature hidden-control-source';
        combined.appendChild(ledBlock);
        combined.appendChild(wifiBlock);
        var proxyPane = buildProxyPane(data);
        proxyPane.className += ' grid-proxy-pane';
        var sharedActions = create('div', { 'class': 'shared-action-editor' });
        var leftRow = create('div', { 'class': 'proxy-field' });
        leftRow.appendChild(create('label', { 'text': '左拨动作' }));
        var leftSelect = create('select', { 'class': 'proxy-select' });
        leftRow.appendChild(wrapSelect(leftSelect));
        sharedActions.appendChild(leftRow);
        var actionSummary = create('div', { 'class': 'proxy-action-hint' });
        sharedActions.appendChild(actionSummary);
        combined.appendChild(sharedActions);

        function actionLabelsFor(feature) {
            if (feature === 'proxy') return [['1', '打开代理'], ['0', '关闭代理']];
            if (feature === 'wifi') return [['1', '恢复 WiFi'], ['0', '关闭 WiFi']];
            return [['1', '打开灯光'], ['0', '关闭灯光']];
        }
        function fillActionSelect(select, labels, value) {
            select.innerHTML = '';
            labels.forEach(function(item) {
                var opt = create('option', { 'value': item[0], 'text': item[1] });
                if (item[0] === value) opt.selected = true;
                select.appendChild(opt);
            });
        }
        function setStoredActions(feature, leftOn) {
            var group = controls[feature];
            group.left_on.checked = leftOn;
            group.left_off.checked = !leftOn;
            group.right_on.checked = !leftOn;
            group.right_off.checked = leftOn;
        }
        function updateActionSummary() {
            if (featureSelect.value === 'none') {
                actionSummary.textContent = '滑动开关未启用';
                return;
            }
            var labels = actionLabelsFor(featureSelect.value);
            var rightText = leftSelect.value === '1' ? labels[1][1] : labels[0][1];
            actionSummary.textContent = '滑到左侧：' + leftSelect.options[leftSelect.selectedIndex].text +
                '；滑到右侧：' + rightText + '。';
        }
        function showSelectedFeature() {
            var feature = featureSelect.value;
            controls.led.enabled.checked = feature === 'led';
            controls.wifi.enabled.checked = feature === 'wifi';
            proxyEnable.checked = feature === 'proxy';
            var disabled = feature === 'none';
            leftSelect.disabled = disabled;
            sharedActions.classList.toggle('is-disabled', disabled);
            if (!disabled) {
                var labels = actionLabelsFor(feature);
                fillActionSelect(leftSelect, labels, controls[feature].left_on.checked ? '1' : '0');
            }
            updateActionSummary();
            proxyPane.classList.toggle('is-disabled', feature !== 'proxy');
            proxyTarget.disabled = feature !== 'proxy';
            proxyDetectBtn.disabled = feature !== 'proxy';
        }
        leftSelect.addEventListener('change', function() {
            if (featureSelect.value === 'none') return;
            var leftOn = leftSelect.value === '1';
            setStoredActions(featureSelect.value, leftOn);
            updateActionSummary();
            updateGlobalStatus('pending');
        });
        featureSelect.addEventListener('change', function() {
            showSelectedFeature();
            updateGlobalStatus('pending');
        });
        proxyTarget.addEventListener('change', function() { updateGlobalStatus('pending'); });
        showSelectedFeature();
        gridBox.appendChild(combined);
        gridBox.appendChild(proxyPane);
        basicPane.appendChild(gridBox);
        paddlePage.appendChild(basicPane);
        resetPage.appendChild(buildResetPane(data));

        function saveAll(button, action) {
            hideError();
            var feature = featureSelect.value;
            if (action === 'save' && (feature === 'wifi' || feature === 'proxy')) {
                var group = controls[feature];
                var currentActionOn = currentMode === '1' ? group.right_on.checked : group.left_on.checked;
                if (!currentActionOn) {
                    var targetName = feature === 'wifi' ? 'WiFi' : '代理';
                    if (!window.confirm('保存并应用后将立即关闭' + targetName + '，远程连接可能中断。确定继续吗？')) return;
                }
            }
            var allSaveButtons = document.querySelectorAll('.btn-save');
            for (var b = 0; b < allSaveButtons.length; b++) allSaveButtons[b].disabled = true;
            var origText = button.textContent;
            button.textContent = '正在保存…';

            var postData = { action: action };
            postData['global_enabled'] = feature === 'none' ? '0' : '1';
            postData['proxy_enabled'] = proxyEnable.checked ? '1' : '0';
            postData['proxy_target'] = proxyTarget.value;
            ['single', 'double', 'triple'].forEach(function(gesture) {
                postData['reset_' + gesture + '_enabled'] = resetControls[gesture].enabled.checked ? '1' : '0';
                postData['reset_' + gesture + '_action'] = resetControls[gesture].action.value;
            });
            for (var prefix in controls) {
                if (controls.hasOwnProperty(prefix)) {
                    var group = controls[prefix];
                    postData[prefix + '_enabled'] = group.enabled.checked ? '1' : '0';
                    postData[prefix + '_left_action'] = group.left_on.checked ? '1' : '0';
                    postData[prefix + '_right_action'] = group.right_on.checked ? '1' : '0';
                }
            }

            console.log('[toggle] Sending data:', postData);

            post(postData, function(resp) {
                for (var b = 0; b < allSaveButtons.length; b++) allSaveButtons[b].disabled = false;
                if (resp.success) {
                    button.textContent = '已保存';
                    setTimeout(function() { button.textContent = origText; }, 1500);
                    syncControlsFromPost(postData);
                    if (resp.proxy_status) renderProxyStatus(resp.proxy_status);
                } else {
                    showError(resp.error || '未知错误');
                    button.textContent = '保存失败';
                    setTimeout(function() { button.textContent = origText; }, 3000);
                }
            });
        }
        function addSaveButtons(page, definitions) {
            var btnBox = create('div', { 'class': 'btn-box' });
            definitions.forEach(function(definition) {
                var button = create('button', { 'class': 'btn-save ' + (definition.className || ''), 'text': definition.label });
                button.addEventListener('click', function() { saveAll(button, definition.action); });
                btnBox.appendChild(button);
            });
            page.appendChild(btnBox);
        }
        addSaveButtons(paddlePage, [
            { action: 'save_only', label: '保存', className: 'btn-save-only' },
            { action: 'save', label: '保存并应用' }
        ]);
        addSaveButtons(resetPage, [
            { action: 'save_only', label: '保存' }
        ]);

        syncControlsFromData(data);
        statusInterval = setInterval(fetchMode, 2000);
    }

    function initialize() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', apiUrl + '?_=' + Date.now(), true);
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.onload = function() {
            var data = {};
            if (xhr.status === 200) {
                try {
                    var resp = JSON.parse(xhr.responseText);
                    if (resp.success) data = resp.data;
                } catch(e) {}
            }
            buildUI(data);
        };
        xhr.onerror = function() { buildUI({}); };
        xhr.send();
    }

    return view.extend({
        render: function() {
            if (!document.getElementById('toggle-page-style')) {
                var link = create('link', { id: 'toggle-page-style', rel: 'stylesheet', type: 'text/css', href: L.resource('view/toggle/index.css') + '?v=100' });
                document.head.appendChild(link);
            }
            var root = create('div', {}, [
                create('div', { id: 'toggle-app' }),
                create('div', { id: 'toggle-error', style: 'display:none' })
            ]);
            window.setTimeout(initialize, 0);
            return root;
        },
        handleSaveApply: null,
        handleSave: null,
        handleReset: null
    });

# GL-MT3600BE 滑动开关控制（mt3600be-toggle）

从 [xlucien/oray-x1-pro-toggle-switch](https://github.com/xlucien/oray-x1-pro-toggle-switch)（Oray X1 Pro 版）移植到 **GL.iNet GL-MT3600BE**。

不启动常驻轮询进程：滑动开关由内核 `gpio-keys` + `gpio-button-hotplug` 双边沿中断驱动，
只在真正拨动时拉起一个很短的 shell；开机另做一次状态同步后立即退出。

页面采用 GL.iNet 原厂风格重写（ucode 模板）：

![按键控制页](docs/luci-toggle-gl.png)

旧版（自绘 JS 视图 `view/toggle/index.js`）截图：

| 滑动开关 | RESET 重置键 |
| --- | --- |
| ![滑动开关页](docs/luci-paddle.png) | ![RESET 页](docs/luci-reset.png) |

## 快速安装

SSH 登录路由器后：

```sh
cd /tmp
curl -L https://github.com/xlucien/gl-mt3600be-toggle-switch/archive/refs/heads/main.tar.gz -o pkg.tgz
tar -xzf pkg.tgz
cd gl-mt3600be-toggle-switch-main
sh install.sh
```

卸载方法见文末。

## 硬件事实（本机实测 + 固件取证）

| 项目 | 值 |
| --- | --- |
| 型号 | `glinet,gl-mt3600be`（ImmortalWrt 25.12-SNAPSHOT r0-1b6fa75，mediatek/filogic） |
| DTB 节点 | `/proc/device-tree/gpio-keys/button-mode` |
| label | `mode` |
| gpios | `&pio 3 GPIO_ACTIVE_HIGH` → debugfs `gpio-515` |
| linux,code | `BTN_0`（0x100） |
| linux,input-type | `EV_SW`（0x5） |
| debounce | 10 ms |
| 固件 | `8月17日-istore-os-mediatek-filogic-glinet_gl-mt3600be-squashfs-sysupgrade.bin` |

RESET 键：`/gpio-keys/button-reset` → `gpio-516`，`GPIO_ACTIVE_LOW`。

**不需要改 DTS、不需要重刷固件** —— 原厂固件的运行中 DTB 已经包含这两个节点，
且 `kmod-gpio-button-hotplug` 已加载。

## 与原版（X1 Pro）的关键差异：极性翻转

| 机型 | DTS 极性 | hotplug ACTION | 物理电平 | 沿用 GL-MT3600BE 语义 |
| --- | --- | --- | --- | --- |
| Oray X1 Pro | `GPIO_ACTIVE_LOW` | `pressed` | 低 | Right |
| Oray X1 Pro | `GPIO_ACTIVE_LOW` | `released` | 高 | Left |
| **GL-MT3600BE** | **`GPIO_ACTIVE_HIGH`** | **`pressed`** | **高** | **Left** |
| **GL-MT3600BE** | **`GPIO_ACTIVE_HIGH`** | **`released`** | **低** | **Right** |

所以 `etc/rc.button/BTN_0` 的分发与原版相反：

```sh
pressed)  exec /usr/sbin/mt3600be-toggle-apply high ;;
released) exec /usr/sbin/mt3600be-toggle-apply low  ;;
```

其余逻辑（沿用高电平=左、低电平=右）与原厂 GL-MT3600BE 定制固件一致，无需交换动作。

## 改名对照

| 原版 | 本移植版 |
| --- | --- |
| `/etc/config/x1pro-toggle` | `/etc/config/mt3600be-toggle` |
| `/etc/init.d/x1pro-toggle` | `/etc/init.d/mt3600be-toggle` |
| `/etc/x1pro-toggle.d/` | `/etc/mt3600be-toggle.d/` |
| `/usr/sbin/x1pro-toggle-*` | `/usr/sbin/mt3600be-toggle-*` |
| `/usr/sbin/x1pro-reset-control` | `/usr/sbin/mt3600be-reset-control` |
| `/usr/libexec/x1pro-reset-button` | `/usr/libexec/mt3600be-reset-button` |
| `/usr/libexec/x1pro-delay` | `/usr/libexec/mt3600be-delay` |
| `/etc/rc.button/reset.x1pro-stock` | `/etc/rc.button/reset.mt3600be-stock` |

LuCI 侧沿用 `luci.controller.toggle` / 菜单 `admin/system/toggle`（标题「按键控制」）。
视图已由 `www/luci-static/resources/view/toggle/{index.js,index.css}` 改为
**ucode 模板** `usr/share/ucode/luci/template/toggle.ut`（GL 原厂风格，服务端渲染，无前端构建依赖）。

模板只负责版式，交互逻辑全部放在外置脚本
`www/luci-static/resources/mt3600be-toggle/toggle.js`。

> **重要**：不要把 `<script>` 内联进 `toggle.ut`。ucode 模板引擎会把内联 JS 里的
> `${...}`、模板字符串反引号和引号当作自身语法解析，直接报
> `Unable to compile source file ... Syntax error: Unexpected token`。
> 正确的分工是——模板输出 HTML + 用 `data-url` / `data-save-url` / `data-sim-url`
> 三个属性传后端地址，外置 JS 读取这些属性并 `window.xxx = fn` 暴露给模板的 `onclick`。

### 页面交互约定

页面结构自上而下：**开关演示 → 保存栏 → 拨动开关功能 → RESET 重置键**。

- **保存栏是「开关演示」下面的独立一栏**，有改动才可点「保存」。
- **开关演示是纯状态展示**：不可点击、不做模拟。位置与灯态每 3 秒轮询刷新，
  位置直接取自 `mode` 引脚的 GPIO 电平等（`physical_gpio()`），不受任何缓存影响。
- **「拨动开关功能」两栏等高定长**（`height:328px`，内容超出时栏内滚动），
  切换功能时页面高度不跳动。
  - 左栏「功能选项」：功能下拉（无功能 / 代理 / Wi-Fi / LED）→ 选「代理」时其下方出现
    「代理程序」下拉 → 「左拨动作」分段按钮 + 一行文字说明左右拨各自的动作。
  - 右栏「可控制」：随所选功能实时列出能控制什么。
    - 代理：**只列检测到的插件**（`not_installed` 由控制器直接过滤掉），
      各带状态标签（运行中 / 未启用 / 异常 / 检测到多个）与可控性说明。
    - LED：**受控灯胶囊在右栏**，蓝灯 / 白灯都可点击多选，点击即写入 `led_name`。
    - Wi-Fi：说明控制的是 2.4G + 5G 及其快照恢复行为。
- **代理默认选中正在运行的那个**：首次进入时若 `proxy_target` 为空或已不在检测列表中，
  自动选中 `state == running` 的插件；若都不在运行则退回「自动」。
  用户在页面上的选择不会被轮询覆盖。
- **只暴露「左拨动作」**，右拨动作 = 左拨取反（保存时自动写入 `*_low_action`），
  不再单独占一栏，改为左拨动作下方的一行文字说明。
- **RESET 三个手势都带「禁用」**：`reset_*_enabled=0` + `reset_*_action`，
  选「禁用」即该手势不执行任何动作（长按 5 秒的恢复出厂设置不受影响）。

### ucode 两个容易踩的坑

1. **不要把 `<script>` 内联进 `toggle.ut`**，也不要在模板里内联 `Object.assign()`
   之类含 `{}` 的 JS——模板引擎会把 `${...}`、反引号、引号以及相邻的 `{` `{`
   当作自身语法，直接报 `Unable to compile source file ... Unexpected token`。
   正确分工：模板只出版式，后端地址走 `#gl` 上的
   `data-url` / `data-save-url` 属性，交互逻辑放
   `www/luci-static/resources/mt3600be-toggle/toggle.js`，
   再 `window.xxx = fn` 暴露给模板里的 `onclick`。
2. **ucode 不能写 `for (let x in [ 'a', 'b' ])`** 直接遍历数组字面量（会静默不生效），
   必须先把数组赋给变量再遍历。`proxy_list()` / `led_list()` 都遵循这条。

## 依赖与精简

`Makefile` 里声明的是：

```
DEPENDS:=+luci-base +ucode-mod-fs +ucode-mod-uci +ucode-mod-uloop +kmod-gpio-button-hotplug
```

逐项说明（**在这台固件上 5 个全部已存在，安装不会再额外拉包**）：

| 依赖 | 谁在用 | 能否去掉 |
| --- | --- | --- |
| `kmod-gpio-button-hotplug` | 整条事件链（`/etc/modules.d/30-gpio-button-hotplug` 自动加载） | **不能**，去掉就没有中断事件 |
| `luci-base` | LuCI 菜单 + ucode 控制器框架 | 不要网页面板可整组去掉 |
| `ucode-mod-fs` | 控制器读 `/tmp/mt3600be-toggle-state`、popen 代理状态 | 同上，随面板走 |
| `ucode-mod-uci` | 控制器读写 `/etc/config/mt3600be-toggle` | 同上，随面板走 |
| `ucode-mod-uloop` | `mt3600be-delay` 的毫秒定时器（RESET 多击窗口） | 不要 RESET 多击可去掉 |

注意：**不能用 `sleep` 顶替 uloop**。实测这台机器的 busybox `sleep` 不支持小数
（`sleep 0.05` → `invalid number '0.05'`），而 RESET 去抖需要 50 ms / 200 ms 粒度。

三档精简方案：

1. **只保留滑动开关 + 网页面板**：删掉 `etc/rc.button/reset` 接管、`usr/sbin/mt3600be-reset-control`、
   `usr/libexec/mt3600be-reset-button`、`usr/libexec/mt3600be-delay`，以及 JS 里的 RESET 页签；
   `DEPENDS` 去掉 `ucode-mod-uloop`。
2. **不要网页面板（纯脚本）**：只留 `etc/rc.button/BTN_0` + `usr/sbin/mt3600be-toggle-{apply,sync,wifi,proxy}`
   + `etc/config/mt3600be-toggle`，用 uci 直接配；`DEPENDS` 只剩 `+kmod-gpio-button-hotplug`。
3. **已删掉的僵尸配置**：从 X1 Pro 版带过来的 `passwall_*` / `openclash_*` / `ssr_*` 共 9 个 UCI 选项，
   `apply` 从不读、UI 也不渲染，已在本次移植中移除。若真想让左右拨分别控制 PassWall / OpenClash / SSR Plus，
   直接用「代理」模块选对应程序即可，不需要这三个遗留键。

## 灯光策略（当前配置）

GL-MT3600BE 有两颗状态灯，都是 `max_brightness=1` 的二值灯（没有亮度档位）：

| LED | 设备树别名 | 角色 | 本包的处理 |
| --- | --- | --- | --- |
| `blue:status`（gpio-560，ACTIVE_LOW） | `led-running` | 运行指示 | **由滑块 LED 档控制亮灭** |
| `white:status`（gpio-561，ACTIVE_LOW） | `led-boot` | 开机/升级指示 | **开机后强制熄灭，与滑块无关** |

对应两个配置项：

```
option boot_off_leds 'white:status'   # 每次开机强制熄灭的灯（空格分隔），不受滑块影响
option led_name      'blue:status'    # LED 档控制的灯（空格分隔，可多颗）
```

行为：

- **白灯**：开机过程（preinit/升级）仍会由系统闪一下——那是 `led-boot` 的本职；
  开机结束后 S99 的 `force_boot_off_leds()` 会把它压灭并保持，之后滑块怎么拨都不影响它。
- **蓝灯**：跟随滑块。左拨（高电平）= 亮，右拨（低电平）= 灭（`led_high_action/led_low_action`）。
- **RESET 单击"切换灯光"**：同样只切 `led_name` 里的灯，当前即蓝灯。
- **开机同步**：S99 `mt3600be-toggle-sync` 读一次 debugfs 的实际电平，把蓝灯对齐到滑块当前位置。

开机时序：S95 `done` 先点亮蓝灯（`led-running`）→ S99 强制白灯灭 + 按滑块位置同步蓝灯。
所以蓝灯在开机最后几秒会先亮，随后按滑块位置定格。

想改策略时：

```sh
uci set mt3600be-toggle.main.led_name='blue:status white:status'   # 两颗一起控
uci set mt3600be-toggle.main.boot_off_leds=''                      # 不强制灭白灯
uci commit mt3600be-toggle && /etc/init.d/mt3600be-toggle restart
```

## WiFi 开关与自愈

`mt3600be-toggle-wifi` / `mt3600be-reset-control` 关 WiFi 时会把每个 `wifi-device` 的
`disabled` 状态存进快照（UCI `mt3600be-toggle.wifi_state` / `mt3600be-toggle.reset_wifi_state`），
开 WiFi 时按快照逐项还原。

### 已知固件问题（MTK 闭源 mtwifi）

反复开关 WiFi 后可能出现「只回来一半」：2.4G（`MT7993_1_1`/`ra0`）UP，
5G（`MT7993_1_2`/`rai0`）起不来，且 `wifi up` / `network restart` 都无效。抓到的现象是
netifd 给 5G radio 的 setup 参数里带着 `"disabled": true`，`mtwifi-cfg` 的 `handle_setup()`
走「禁用 radio」分支后**静默返回**（退出码 0、零日志，不是崩溃，因为 `with_lock()` 没有打出
`Crashed during locked operation`）；而 `/etc/config/wireless` 里 `MT7993_1_2.disabled` 又被
写成 `1`，会跨重启保留并被下一次快照"忠实"记录，于是自我强化成"永远只有一半"。

这是闭源 mtwifi + netifd 内部状态的问题，插件层面无法根治。

### 内置兜底（已实测有效）

- `wifi_all_vifs_up()`：用 `ubus call network.wireless status` + `ip link` 校验**每个** radio
  的 vif 是否真的 UP，而不是只看退出码。
- 恢复后每 6 s 校验一次；不完整就**重新套用快照 + `wifi reload`**，最多重试 5 次。
  实测第一轮重试即可补齐（OFF → ON 后约 10 s 内 5G 恢复）。
- `disabled` 每次重试前都会重新写入快照值，对抗固件回写。
- 5 次重试仍失败才考虑**一次性恢复重启**（60 s 延迟，期间恢复则取消）。

兜底开关与保护条件：

```sh
uci set mt3600be-toggle.main.wifi_selfheal_reboot='0'   # 关掉自动重启（默认 1）
uci commit mt3600be-toggle
```

自动重启每次开机最多触发一次（标志位 `/tmp/mt3600be-wifi-selfheal`），且开机 5 分钟内不触发。

> 早期版本用 `wifi up` 强制全量重启作为第一手段，实测无效：5G 的 setup 会继续挂住，
> 且 `disabled='1'` 会被写回 uci 并跨重启保留，重启后依然只有一半 WiFi。
> 现在 `wifi reload` 重试收敛是主路径，重启降级为最后手段。

### 实机验证（2026-09-28，192.168.1.1）

连续两轮 `RESET 单击（关）→ 单击（开）`：

```
20:13:35 single: wifi (wifi_off)          # uci 1_1=1 1_2=1，ra0/rai0 均 down
20:14:11 wifi restore incomplete, retry 1 (wifi reload)
20:14:19 wifi fully up                    # +10s：uci 0/0，ra0/rai0 均 UP
20:15:27 single: wifi (wifi_off)          # 第二轮
20:16:03 wifi restore incomplete, retry 1 (wifi reload)
20:16:11 wifi fully up                    # 同样 10s 内恢复，全程无重启
```

## 安装

把本目录上传到路由器（例如 `/tmp/mt3600be-toggle`）后：

```sh
cd /tmp/mt3600be-toggle
sh install.sh
```

安装脚本会：

- 设置脚本权限 `0755`、UCI 配置 `0600`；
- 备份原厂 `/etc/rc.button/reset` 到 `/etc/rc.button/reset.mt3600be-stock`，换成支持多击的版本；
- 启用 `/etc/init.d/mt3600be-toggle` 并做一次开机状态同步；
- 预检 `/proc/device-tree/gpio-keys/button-mode` 是否存在。

所有功能动作默认关闭，安装不会改变 WiFi / 代理 / 灯光状态。

## 现场确认

```sh
uci set mt3600be-toggle.main.global_enabled='0'
uci commit mt3600be-toggle
logread -f -e mt3600be-toggle
```

拨动一次应看到 `MODE=1 (high)` 与 `MODE=0 (low)`。

直接看物理电平：

```sh
mount -t debugfs debugfs /sys/kernel/debug 2>/dev/null
grep '|mode' /sys/kernel/debug/gpio
```

## 实际验证记录（192.168.1.1 实机）

- 开机同步：`mt3600be-toggle: MODE=0 (low)` → 页面显示「右侧」
- 模拟 `ACTION=pressed`（左/高）→ `MODE=1 (high)` → `white:status` 亮度 1（灯亮）
- 模拟 `ACTION=released`（右/低）→ `MODE=0 (low)` → 亮度 0（灯灭）
- LuCI `系统 → 按键控制` 正常渲染，`/admin/system/toggle/data` 返回完整 JSON
- RESET 单击关 WiFi → 两个 radio 均 down；再单击开 WiFi → `ra0` / `rai0` 均 UP

## 卸载

```sh
cp /etc/rc.button/reset.mt3600be-stock /etc/rc.button/reset
/etc/init.d/mt3600be-toggle disable
rm -f /usr/sbin/mt3600be-* /usr/libexec/mt3600be-* /etc/init.d/mt3600be-toggle \
      /etc/rc.button/BTN_0 /etc/config/mt3600be-toggle
rm -rf /etc/mt3600be-toggle.d
rm -f /usr/share/ucode/luci/controller/toggle.uc /usr/share/luci/menu.d/toggle-switch.json
rm -f /usr/share/ucode/luci/template/toggle.ut
rm -rf /www/luci-static/resources/view/toggle
rm -rf /www/luci-static/resources/mt3600be-toggle
rm -f /tmp/luci-indexcache
```

## License

MIT（沿用上游，见 [LICENSE](LICENSE)）

## 目录结构

```
etc/config/mt3600be-toggle          UCI 配置
etc/init.d/mt3600be-toggle          开机同步 + 强制熄灭 boot_off_leds
etc/rc.button/BTN_0                 滑块事件入口（极性适配在此）
etc/rc.button/reset 由 install.sh 替换为多击处理（原厂备份 .mt3600be-stock）
etc/mt3600be-toggle.d/{high,low}.example  自定义动作 hook
etc/uci-defaults/99-toggle-switch   编入固件时首启接管 RESET
usr/sbin/mt3600be-toggle-{apply,sync,wifi,proxy}
usr/sbin/mt3600be-reset-control
usr/libexec/mt3600be-{reset-button,delay}
usr/share/ucode/luci/controller/toggle.uc
usr/share/ucode/luci/template/toggle.ut    LuCI 页面版式（GL 原厂风格 ucode 模板）
www/luci-static/resources/mt3600be-toggle/toggle.js  页面交互逻辑（外置，勿内联）
usr/share/luci/menu.d/toggle-switch.json
Makefile                            编入固件用（DEPENDS 见上文）
install.sh                          实机安装脚本
docs/                               LuCI 页面截图
```

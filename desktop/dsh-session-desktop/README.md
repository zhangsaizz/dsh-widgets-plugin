# 会话监控桌面悬浮窗（dsh-session-desktop）

把 DeepSeek Harness 的「会话监控」做成一个悬浮在 Windows 桌面上的小窗：
无边框、半透明、置顶、不进任务栏，随时可见当前运行/刚完成的会话，完成一轮时
弹出按状态配色的提醒。点击会话行会用系统浏览器打开 Harness Web 应用。

## 架构

```
┌──────────────────────────────┐
│ 桌面壳（Tauri 2，Rust）       │  ← 只拥有窗口 chrome：
│  · 无边框/透明/置顶/无任务栏   │     拖拽、置顶、隐藏、托盘、打开浏览器
│  · start.html 启动探测重试页   │
└──────────────┬───────────────┘
               │ 加载 + 轮询
               ▼
┌──────────────────────────────┐
│ Harness Web 服务 127.0.0.1:3080 │  ← 插件 Host 半：
│  /_dsh/session-monitor/       │     /sessions（快照 JSON）
│    sessions · status · widget │     /status（turn/end 原因）
└──────────────────────────────┘     /widget（自包含挂件页）
```

- **挂件页**由插件 Host 半提供（`/_dsh/session-monitor/widget`，自包含 HTML，
  无框架），桌面壳只是它的容器——数据/UI 永远与已安装插件版本一致。
- 桌面壳与挂件页通过 Tauri 全局 API（`window.__TAURI__`）通信：头部拖拽
  （`startDragging`）、📌 置顶（`setAlwaysOnTop`）、✕ 隐藏（`hide`）。
- **点击跳转**：点会话行（或 toast「跳转」）→ POST 到 Host 的 jump 队列，**已开着的
  Harness 标签页由插件客户端半取走并直接切到该会话，不新开窗口**；没有网页在听
  才回退系统浏览器（`open_in_browser` 命令），并带 `?dsh-open=<id>` 深链让网页
  启动后自动选中。
- **设置与网页版共享**：挂件页的设置（完成提醒/通知方式/自动消失秒/提示音/只显示
  运行中/子代理/时间范围）存在 Host 的 `session-monitor` settings 命名空间
  （`/_dsh/session-monitor/settings`），网页版（小组件管理 → 配置）与桌面挂件
  读写同一份、实时双向同步——WebView2 与浏览器存储分区隔离，只有服务端中转能
  跨上下文同步。仅「刷新间隔」与「待处理通知级别开关」是本挂件独有。
- **通知列表（inbox）为主视图**：挂件页「待处理」Tab 展示 Host 权威通知存储
  （`/_dsh/session-monitor/notifications`）——审批/回答/计划/出错/阻塞/token 上限/
  完成一轮/子代理完成等，未读徽标 + 处理/忽略/全部已读 + 级别开关；「会话」列表
  迁入副 Tab。已读状态存 Host，与网页版同源共享（网页挂件头部也有未读徽标）。
- 托盘图标：左键单击或菜单「显示挂件」唤回隐藏窗口，「退出」结束进程；托盘
  **tooltip 与菜单第一行实时镜像 inbox 未读数**（挂件页每次未读变化经
  `set_tray_unread` 命令上报，隐藏窗口时也能一眼看到还有几件待处理）。
- **ACL 注意**：自定义 app 命令从远程页（`http://127.0.0.1:3080`）调用必须放行——
  `build.rs` 用 `AppManifest::new().commands(&["open_in_browser", "set_tray_unread"])`
  自动生成权限，`capabilities/default.json` 里以无前缀
  `"allow-open-in-browser"` / `"allow-set-tray-unread"` 引用（改命令时两处要同步）。
- **远程拉起（`dsh-smon://` 深链协议）**：每次启动在 HKCU 注册 `dsh-smon://`
  URL 协议（`reg.exe`，指向当前 exe + `%1`，幂等、无需安装器；移动/更新 exe 后
  下次启动自动重注册）。网页配置面板打开「桌面端会话监控」开关时经隐藏 iframe
  导航 `dsh-smon://show`——应用未运行则由 Windows 启动（检测到协议参数后
  **直接显示窗口**，不走「启动即进托盘」），已运行则经 single-instance 插件
  唤出窗口。

## 构建

前置：Rust（含 MSVC 工具链）、Node ≥ 20、Harness web 服务（`dsh web`，默认
127.0.0.1:3080）已运行且已安装本仓库 bundle（插件 Host 半在跑）。

```sh
cd desktop/dsh-session-desktop
npm install          # 仅装 @tauri-apps/cli（本目录独立于 pnpm workspace）
npx tauri build --no-bundle   # release 可执行文件（首次拉取 crates，10–30 分钟）
```

产物：`src-tauri/target/release/dsh-session-monitor-desktop.exe`（绿色单文件，
双击运行）。要做安装包（NSIS）则去掉 `--no-bundle`。

图标：`icon-source.png`（1024×1024 源图）→ `npx tauri icon icon-source.png`
重新生成 `src-tauri/icons/` 全套。

## 运行

1. 启动 Harness：`dsh web`（本机 127.0.0.1:3080）。
2. 双击 `dsh-session-monitor-desktop.exe`：先显示「正在连接」重试页，就绪后自动
   进入挂件页。**或**从 Harness 网页的「小组件管理 → 会话监控 → 配置」打开
   「桌面端会话监控」开关，自动经 `dsh-smon://` 拉起本应用。
3. 挂件页右上角：📌 置顶开关 / ⚙ 设置（刷新间隔、通知方式、提示音、子代理显示、
   时间范围）/ ✕ 隐藏（托盘唤回）。

## 开发

- 挂件页源码在 `packages/dsh-client-ui-session-monitor/src/widget-page.html`；
  改完跑 `pnpm build`（仓库根）并重启 `dsh web`（Host 半改动需重启）。
- 壳源码在 `src-tauri/src/lib.rs`、窗口配置 `src-tauri/tauri.conf.json`、
  权限 `src-tauri/capabilities/default.json`。
- 调试模式：`npx tauri dev`（会先起一个带控制台的窗口，便于看 Rust 日志）。

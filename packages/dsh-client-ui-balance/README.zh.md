# @dsh-plugins/client-ui-balance

[English](README.md) | 中文

浮动余额看板（浏览器端）。一次 `register` 调用把 `BalanceWidget` 贡献进全帧浮层 `shell.overlay` 列表（id 为 `balance`），安置视图设置 store，并把 `BalanceController` 作为绑定的 `useBalance` hook 与手动 `refresh` 动词注入。

看板是一个 `position: fixed` 面板：可拖拽并在 56px 阈值内吸附到任一视口角落，可经标题栏控件在 75% 到 150% 间缩放，可收起到紧凑胶囊。缩放、吸附角落、自由位置与收起状态持久化到 `localStorage` 的 `dsh.balance.view`。

单个 `BalanceController`（对象层）经 `ctx.sessions` 跟随当前会话，重读当前模型选择，并查询 `ctx.remote.balance`。它按固定 30 秒间隔刷新，会话切换时立即刷新，并在 `ctx.modelDirectories` 存在时随模型切换即时刷新。Host 计算的 `trend`/`delta` 驱动涨跌箭头与配色，金额在两次观测间补间过渡（即「动态滚动」效果）。

看板默认显示**当前账户**（会话所用提供商），可通过头部切换按钮（`▦`）切到**多账户视图**，经 `balance/list` Remote 列出每个已配置提供商的余额——每行含厂商名、金额、币种与趋势。视图模式与其他设置一同持久化。

余额供应商配置面板由插件注册进小组件管理（`@dsh-plugins/client-ui-widget-manager`）的
「配置」弹窗（`widgets.config` 槽），不再占用 Web 设置的菜单页：打开 Web 设置 →
「小组件管理」→ 余额看板行上的「配置」按钮即可管理绑定。

## 使用方式

挂件挂载后（安装方式见仓库根 README）即以浮层形式出现；查询额外提供商时才需要配置。

1. **添加供应商绑定** — Web 设置 → 「小组件管理」→ 余额看板 → **配置**（弹窗）→ 添加绑定：提供商路由（如 `new-api`）、厂商类型（`new-api` / `deepseek` / `moonshot` / `openrouter` / `siliconflow`）、凭据引用（如 `NEW_API_KEY`），自托管网关可选填 Base URL。余额看板的配置面板依赖小组件管理（推荐安装 `@dsh-plugins/balance-bundle`）。
2. **存入令牌** — 把对应 API Key 放入该凭据引用（`$DSH_HOME/.credentials.yaml` 或 Web 设置里的凭据管理）。看板每 30 秒自动刷新，无需重启。
3. **查看看板** — 默认显示当前会话所用提供商的余额；点 `▦` 切多账户视图；拖动移动、拖到角落吸附，头部控件可缩放（75%–150%）或收起为胶囊。

> **本地改动警示**：本包源码同步自 deepseek-harness（`pnpm sync`）。配置面板注册进
> `widgets.config` 槽的这段代码（`src/client/index.ts`）是本地改动，**同步后会覆盖**，需重新应用。

## Model Experience

无。看板只渲染 Host 提供的余额数据；不向会话日志、模型上下文或遥测追加任何内容。

#### KV Cache effect

无；看板只写入自己在 `localStorage` 中的视图设置键。

## Known Limitations and Deferred Work

- **固定刷新间隔** — 30 秒刷新是常量，不是 settings 或组合字段。
- **固定端点** — 厂商 base URL 来自 `balance-vendors`，看板无法覆盖。
- **视口相对吸附** — 吸附判定使用 `window` 边界，匹配全帧浮层，但不匹配将来停靠/内嵌的应用框架。

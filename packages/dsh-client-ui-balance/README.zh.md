# @dsh-plugins/client-ui-balance

[English](README.md) | 中文

浮动余额看板（浏览器端）。一次 `register` 调用把 `BalanceWidget` 贡献进全帧浮层 `shell.overlay` 列表（id 为 `balance`），安置视图设置 store，并把 `BalanceController` 作为绑定的 `useBalance` hook 与手动 `refresh` 动词注入。

看板是一个 `position: fixed` 面板：可拖拽并在 56px 阈值内吸附到任一视口角落，可经标题栏控件在 75% 到 150% 间缩放，可收起到紧凑胶囊。缩放、吸附角落、自由位置与收起状态持久化到 `localStorage` 的 `dsh.balance.view`。

单个 `BalanceController`（对象层）经 `ctx.sessions` 跟随当前会话，重读当前模型选择，并查询 `ctx.remote.balance`。它按固定 30 秒间隔刷新，会话切换时立即刷新，并在 `ctx.modelDirectories` 存在时随模型切换即时刷新。Host 计算的 `trend`/`delta` 驱动涨跌箭头与配色，金额在两次观测间补间过渡（即「动态滚动」效果）。

看板默认显示**当前账户**（会话所用提供商），可通过头部切换按钮（`▦`）切到**多账户视图**，经 `balance/list` Remote 列出每个已配置提供商的余额——每行含厂商名、金额、币种与趋势。视图模式与其他设置一同持久化。

插件还在 Web 设置中注册了**余额供应商**页（`settings.section`，id `balance`）：列出 `balance` 设置分区中的用户自管绑定，可添加（提供商路由 + 厂商类型 + 凭据引用 + 可选 base URL）或删除。Host 实时应用该分区，因此在此添加的绑定无需重启即可在下一次刷新生效。

## Model Experience

无。看板只渲染 Host 提供的余额数据；不向会话日志、模型上下文或遥测追加任何内容。

#### KV Cache effect

无；看板只写入自己在 `localStorage` 中的视图设置键。

## Known Limitations and Deferred Work

- **固定刷新间隔** — 30 秒刷新是常量，不是 settings 或组合字段。
- **固定端点** — 厂商 base URL 来自 `balance-vendors`，看板无法覆盖。
- **视口相对吸附** — 吸附判定使用 `window` 边界，匹配全帧浮层，但不匹配将来停靠/内嵌的应用框架。

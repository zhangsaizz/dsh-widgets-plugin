# @dsh-plugins/balance

[English](README.md) | 中文

余额能力缝隙（capability seam）的服务定义与运行时一半。`ctx.balance` 服务（`BalanceRuntime`）把 LLM 提供商路由绑定到厂商余额提供商，每次查询时通过可选的凭据缝隙（`ctx.credentials`）解析厂商 API Key，并经生成的 `balance/query` Remote 应答余额查询。Web 看板（`@dsh-plugins/client-ui-balance`）是 Consumer；具体厂商在 `@dsh-plugins/balance-vendors`。

厂商实现 `BalanceProvider`：声明其 `info`（厂商 id、显示名、所服务的 LLM 提供商路由、凭据引用、是否提供公开余额接口），以及一个返回规范化 `BalanceAccountData` 的 `query(credential, signal)`。`BalanceRuntime.register()` 在该提供商的 fiber 生命周期内绑定其声明的每条路由；重复路由会让整个注册失败。

每次 `balance/query` 先把路由解析到提供商，再解析凭据，最后取厂商账户。业务状态以 `BalanceQueryResult` 分支返回而非抛出：`bound: false`（无提供商），或 `account.status` 为 `unconfigured`（缺少 Key）、`unsupported`（无公开接口）、`error`（厂商失败或超时）、`ok`。运行时按路由折叠上一次观测，得到 `trend`（`up`/`down`/`flat`/`unknown`）与 `delta`，让 UI 无需自持历史即可渲染涨跌。配套的 `balance/list` Remote 按注册顺序返回每条已绑定路由的条目（同一解析过程，串行调用厂商），支撑配置多家提供商时的看板多账户视图。

## Model Experience

无。余额服务只被 Web 看板消费；任何余额值、凭据或趋势都不会进入会话日志、模型上下文或遥测。

#### KV Cache effect

无；运行时按路由保留进程内的趋势种子，不落盘。

## Known Limitations and Deferred Work

- **趋势历史是进程内的** — 重启后首次观测回到 `unknown`，没有持久化的余额历史。
- **每条路由一个提供商** — 一条路由最多绑定一个厂商；转售多家厂商的 OpenAI 兼容网关暂不能按账户分派。
- **超时是部署级的** — `requestTimeoutMs`（默认 10000）作用于所有厂商查询，暂不支持按厂商配置超时。

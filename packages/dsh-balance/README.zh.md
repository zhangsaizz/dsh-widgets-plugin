# @dsh-plugins/balance

[English](README.md) | 中文

余额插件，一个包装齐整条余额链路：`ctx.balance` 能力缝隙（服务定义、Provider 角色、
领域类型、生成的 Remote）、随包厂商 Provider 与用户自管绑定、以及浮动的 Web 余额看板。
原先拆成三个包（`balance` 缝隙、`balance-vendors` 厂商、`client-ui-balance` 看板），
现已合并为**一个插件行**，一次安装即可挂载整条余额链路。

## 预览

![余额看板预览：展开 / 多账户 / 收起胶囊 / 悬停提示 / 加载中（浅色与深色主题）](../../docs/previews/balance-widget.png)

## 内部组成

- **能力缝隙** — `ctx.balance`（`BalanceRuntime`）把 LLM 提供商路由绑定到厂商余额
  提供商，每次查询时通过可选的凭据缝隙（`ctx.credentials`）解析厂商 API Key，并经
  生成的 `balance/query` Remote 应答余额查询。业务状态以 `BalanceQueryResult` 分支
  返回而非抛出：`bound: false`（无提供商），或 `account.status` 为 `unconfigured`
  （缺 Key）/ `unsupported`（无公开接口）/ `error`（失败或超时）/ `ok`。运行时按路由
  折叠上一次观测得到 `trend`（`up`/`down`/`flat`/`unknown`）与 `delta`。配套的
  `balance/list` Remote 按注册顺序返回每条已绑定路由的条目（串行调用厂商），支撑
  看板的多账户视图。
- **随包厂商** — 针对通过 API Key 提供公开余额/额度接口的主流厂商的具体 Provider，
  以及对不提供此类接口的主要厂商（OpenAI / Anthropic / Google / xAI / Mistral）的
  显式 `supported: false` 绑定，使看板显示清晰的「无公开余额接口」而非「未绑定」。

  | Provider | 端点 | 默认提供商路由 | 默认凭据引用 | 币种 |
  |---|---|---|---|---|
  | DeepSeek | `GET /user/balance` | `deepseek-official` | `DEEPSEEK_API_KEY` | CNY |
  | Moonshot | `GET /v1/users/me/balance` | `moonshot` | `MOONSHOT_API_KEY` | CNY |
  | OpenRouter | `GET /api/v1/credits` | `openrouter` | `OPENROUTER_API_KEY` | USD |
  | SiliconFlow | `GET /v1/user/info` | `siliconflow` | `SILICONFLOW_API_KEY` | CNY |
  | New API | `GET /api/user/self`（quota ÷ 500000 = USD） | `new-api` | `NEW_API_KEY` | USD |

- **用户自管绑定** — `balance` 设置分区（`bindings[]`：`provider` + `vendor` +
  `credentialRef` 或 `credential` + 可选 `baseURL`）注册进
  `settings` 缝隙并在变更时实时对账；同源 Web 路由（`/_dsh/balance/settings`）
  提供脱敏 GET 快照与 POST 保存（留空凭据 = 保留原值；`credentialClear` 标记 =
  显式清除）。小组件管理「配置」弹窗里的供应商配置面板支持添加、就地编辑（提供商
  路由 / 厂商 / 凭据来源 / Base URL）与两步删除。这是为自托管或自定义
  路由配置余额查询而无需改代码的方式。
- **Web 看板** — 浏览器半（`exports["./client"]`，经 `dsh.client` 声明被发现）先把
  balance Remote 挂进 `ctx.remote`，再注册浮动 `BalanceWidget` 到 `shell.overlay`
  （id `balance`，order 100）并安置视图设置 store（缩放/吸附/折叠，持久化于
  `dsh.balance.view`），同时把供应商配置面板注册进小组件管理的「配置」弹窗
  （`widgets.config` 槽）。单个 `BalanceController` 跟随当前会话 + 模型，按固定
  30 秒间隔刷新。

## 安装

推荐安装 bundle——它会连同 Token 暴击挂件、会话监控看板与小组件管理页一起挂载本插件。
发布到 npm 后，用官方 `dsh plugin` 命令装进目标 profile（自动安装依赖并追加
`dsh.profile.bundles`）：

```sh
dsh plugin --profile <name> add @dsh-plugins/dsh-widgets-plugin
```

本地开发时也可直接 `link:` 本仓库的 bundle 目录（见根 README「安装」）。

或把插件行直接加进 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: balance
      name: '@dsh-plugins/balance'
      config:
        requestTimeoutMs: 10000
        # New API 是自托管实例；把 /api/user/self 余额查询指向该实例。
        newApiBaseURL: http://localhost:3000
        bindings: []
        # bindings:
        #   - provider: new-api
        #     vendor: new-api
        #     credential: sk-xxxxxxxx          # 内联密钥，或...
        #     baseURL: http://localhost:3000
        #   - provider: deepseek-official
        #     vendor: deepseek
        #     credentialRef: DEEPSEEK_API_KEY  # ...引用凭据库中的凭据
```

打开会话后看板即以浮层出现。随包默认绑定无需任何配置——把对应 API Key 存入相应
凭据引用即可（DeepSeek → `DEEPSEEK_API_KEY`、Moonshot → `MOONSHOT_API_KEY`、
OpenRouter → `OPENROUTER_API_KEY`、SiliconFlow → `SILICONFLOW_API_KEY`、
New API → `NEW_API_KEY`）。要查询额外或自托管路由，在 Web 设置 → 「小组件管理」
→ 余额看板 → **配置**（弹窗）中添加绑定并存入令牌（提供商路由的下拉候选与
模型列表一致——只含有模型的提供商，也可直接输入自定义路由），下一次看板刷新即生效，无需重启。
绑定支持就地编辑与两步删除；要清除已保存的 Key，编辑该绑定后点「清除已保存的 Key」
并保存即可（留空 Key 则保留原值）。

## Model Experience

无。余额服务与看板只被 Web 挂件消费；任何余额值、凭据或趋势都不会进入会话日志、
模型上下文或遥测。

#### KV Cache effect

无；运行时按路由保留进程内的趋势种子，看板只把视图设置写入自己的 `localStorage` 键。

## Known Limitations and Deferred Work

- **趋势历史是进程内的** — 重启后首次观测回到 `unknown`，没有持久化的余额历史。
- **每条路由一个提供商** — 一条路由最多绑定一个厂商；转售多家厂商的 OpenAI 兼容
  网关暂不能按账户分派。
- **超时是部署级的** — `requestTimeoutMs`（默认 10000）作用于所有厂商查询，暂不支持
  按厂商配置超时。
- **固定刷新间隔** — 看板的 30 秒刷新是常量，不是 settings 或组合字段。
- **对响应结构敏感** — 厂商变更响应结构会以 `provider-error` 使规范化失败，没有
  版本化回退。

## Invariant 伴侣

`@dsh-plugins/balance/invariant` 提供本包的 invariant 伴侣（注册进 `invariants`
缝隙）。它是可选的，bundle 不会挂载它。

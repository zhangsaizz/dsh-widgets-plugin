# @dsh-plugins/balance-vendors

[English](README.md) | 中文

针对通过 API Key 提供公开余额/额度接口的主流厂商的具体余额提供商，以及对不提供此类接口的主要厂商的显式 `supported: false` 绑定。由 `balance-vendors` 插件注册进 `ctx.balance`；卸载该插件会级联撤回全部路由绑定。

已交付的可用提供商（各为一次 HTTP 请求加响应规范化）：

- **DeepSeek** — `GET /user/balance`，绑定 `deepseek-official`，凭据 `DEEPSEEK_API_KEY`。
- **Moonshot** — `GET /v1/users/me/balance`，绑定 `moonshot`，凭据 `MOONSHOT_API_KEY`。
- **OpenRouter** — `GET /api/v1/credits`，绑定 `openrouter`，凭据 `OPENROUTER_API_KEY`。
- **SiliconFlow** — `GET /v1/user/info`，绑定 `siliconflow`，凭据 `SILICONFLOW_API_KEY`。
- **New API** — `GET /api/user/self`，绑定 `new-api`，凭据 `NEW_API_KEY`；自托管，实例地址由 `newApiBaseURL` 配置（默认 `http://localhost:3000`），返回的 `quota` 按 1/500000 美元单位换算。

已绑定但不受支持的厂商（OpenAI、Anthropic、Google、xAI、Mistral）解析到一个 `supported` 为 false 的提供商，使看板显示清晰的「无公开余额接口」状态，而非「未绑定」。

除随包默认绑定外，插件还会应用 `balance` 设置分区中的**用户自管绑定**：每条记录（`provider`、`vendor`、`credentialRef`、可选 `baseURL`）实时注册一个提供商到 `ctx.balance`，设置变更即对账（新路由出现、移除路由消失）。这是为自托管或自定义路由配置余额查询而无需改代码的方式——Web 设置页（ui-balance）编辑该分区，可用的厂商类型（`new-api`、`deepseek`、`moonshot`、`openrouter`、`siliconflow`）支持覆盖路由、凭据引用与 base URL。

## 使用方式

随包默认绑定无需任何配置：把对应的 API Key 放进相应的凭据引用，看板即可读取。

- DeepSeek → `DEEPSEEK_API_KEY` · Moonshot → `MOONSHOT_API_KEY`
- OpenRouter → `OPENROUTER_API_KEY` · SiliconFlow → `SILICONFLOW_API_KEY`
- New API → `NEW_API_KEY`（自托管；把 `newApiBaseURL` 指向你的实例，默认 `http://localhost:3000`）

自定义或自托管路由请在 `balance` 设置分区（或 Web 设置 → 「余额供应商」页）添加绑定：

```yaml
bindings:
  - provider: new-api
    vendor: new-api
    credential: sk-xxxxxxxx          # 内联密钥，或...
    baseURL: http://localhost:3000
  - provider: deepseek-official
    vendor: deepseek
    credentialRef: DEEPSEEK_API_KEY  # ...引用凭据库中的凭据
```

每条记录应答一个提供商路由；`credentialRef` 与 `credential` 二选一即可。绑定在下一次看板刷新时生效，无需重启。

## Model Experience

无。提供商只调用厂商 HTTP 接口并规范化响应；任何账户数据都不会进入会话日志、模型上下文或遥测。

#### KV Cache effect

无；每个提供商均无状态。

## Known Limitations and Deferred Work

- **固定端点和凭据** — 每个提供商写死了其 base URL 与凭据引用；自定义 base URL（网关或代理）暂不能按厂商配置。
- **对响应结构敏感** — 厂商变更响应结构会以 `provider-error` 使规范化失败，没有版本化回退。
- **无用量/费用报告** — Anthropic 与 Google 确实通过独立的 admin API 提供用量/费用报告，但那不是余额值，超出范围。

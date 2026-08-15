# @dsh-plugins/balance-vendors

English | [中文](README.zh.md)

Concrete balance providers for the mainstream vendors that expose a public balance/credit endpoint through their API key, plus explicit `supported: false` bindings for the major vendors that do not. Registered into `ctx.balance` by the `balance-vendors` plugin; unloading the plugin withdraws every route binding in one cascade.

Shipped working providers, each a small HTTP fetch plus response normalization:

- **DeepSeek** — `GET /user/balance`, bound to `deepseek-official`, credential `DEEPSEEK_API_KEY`.
- **Moonshot** — `GET /v1/users/me/balance`, bound to `moonshot`, credential `MOONSHOT_API_KEY`.
- **OpenRouter** — `GET /api/v1/credits`, bound to `openrouter`, credential `OPENROUTER_API_KEY`.
- **SiliconFlow** — `GET /v1/user/info`, bound to `siliconflow`, credential `SILICONFLOW_API_KEY`.
- **New API** — `GET /api/user/self`, bound to `new-api`, credential `NEW_API_KEY`; self-hosted, so the instance origin is the `newApiBaseURL` config (default `http://localhost:3000`) and the reported `quota` is converted from 1/500000-USD units.

Bound-but-unsupported vendors (OpenAI, Anthropic, Google, xAI, Mistral) resolve to a provider whose `supported` is false, so the dashboard shows a clear "no public balance endpoint" state instead of "unbound".

Besides the shipped defaults, the plugin applies **user-managed bindings** from the `balance` settings section: each entry (`provider`, `vendor`, `credentialRef`, optional `baseURL`) registers a provider live into `ctx.balance`, and a settings change reconciles the set (new routes appear, removed routes drop). This is how a self-hosted or custom route gets a balance query without a code change — the Web Settings page (ui-balance) edits the section, and the same vendor types (`new-api`, `deepseek`, `moonshot`, `openrouter`, `siliconflow`) are available with overridable route, credential reference, and base URL.

## Model Experience

None, as each provider only calls a vendor HTTP endpoint and normalizes the response; no account data reaches the session log, the model context, or telemetry.

#### KV Cache effect

None; each provider is stateless.

## Known Limitations and Deferred Work

- **Fixed endpoints and credentials** — each provider hardcodes its base URL and credential reference; a custom base URL (a gateway or proxy) is not yet configurable per vendor.
- **Response-shape sensitivity** — a vendor changing its response shape breaks normalization with a `provider-error`; there is no versioned fallback.
- **No usage/cost reports** — Anthropic and Google do expose usage/cost reports through separate admin APIs, but those are not balance values and are out of scope.

# @dsh-plugins/balance

English | [中文](README.zh.md)

Balance capability seam, Service Definition and runtime half. The `ctx.balance` service (`BalanceRuntime`) binds LLM provider routes to vendor balance providers, resolves the vendor API key through the optional credential seam (`ctx.credentials`) once per query, and answers balance queries over the generated `balance/query` Remote. The Web dashboard (`@dsh-plugins/client-ui-balance`) is the Consumer; concrete vendors live in `@dsh-plugins/balance-vendors`.

A vendor implements `BalanceProvider`: it declares its `info` (vendor id, display name, the LLM provider routes it serves, the credential reference, and whether it exposes a public balance endpoint) and one `query(credential, signal)` returning normalized `BalanceAccountData`. `BalanceRuntime.register()` binds every declared route for the provider's fiber lifetime; a duplicate route rejects the whole registration.

Each `balance/query` resolves the route to a provider, then the credential, then the vendor account. Business conditions return as `BalanceQueryResult` branches rather than rejecting: `bound: false` (no provider), or `account.status` of `unconfigured` (missing key), `unsupported` (no public endpoint), `error` (vendor failure or timeout), or `ok`. The runtime folds the previous observation per route into `trend` (`up`/`down`/`flat`/`unknown`) and `delta`, so the UI renders up/down without keeping its own history. The companion `balance/list` Remote returns one entry per bound route in registration order (same resolution, sequential vendor calls), which powers the dashboard's multi-account view when several providers are configured.

## Model Experience

None, as the balance service is consumed only by the Web dashboard; no balance value, credential, or trend ever reaches the session log, the model context, or telemetry.

#### KV Cache effect

None; the runtime keeps an in-memory trend seed per route, which is process-local and never persisted.

## Known Limitations and Deferred Work

- **Trend history is process-local** — a restart resets the first observation to `unknown`; there is no durable balance history.
- **One provider per route** — a route can bind at most one vendor; an OpenAI-compatible gateway that resells multiple vendors cannot yet dispatch per-account.
- **Timeout is deployment-wide** — `requestTimeoutMs` (default 10000) applies to every vendor query; per-vendor timeouts are not yet configurable.

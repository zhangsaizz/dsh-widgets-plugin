# @dsh-plugins/balance

[English](README.md) | [中文](README.zh.md)

The balance plugin, one package: the `ctx.balance` capability seam (Service
Definition, provider role, domain types, generated Remotes), the shipped
vendor providers plus user-managed bindings, and the floating Web balance
dashboard. Formerly three packages (`balance` seam, `balance-vendors`,
`client-ui-balance`); merged into one plugin row so a single install mounts
the whole balance line.

## Preview

![Balance dashboard preview: expanded / multi-account / collapsed pill /
hover tooltip / loading states, light & dark themes](../../docs/previews/balance-widget.png)

## What's inside

- **Capability seam** — `ctx.balance` (`BalanceRuntime`) binds LLM provider
  routes to vendor balance providers, resolves the vendor API key through the
  optional credential seam (`ctx.credentials`) once per query, and answers
  balance queries over the generated `balance/query` Remote. Business states
  return as `BalanceQueryResult` branches (`bound: false`, or `account.status`
  of `unconfigured` / `unsupported` / `error` / `ok`) rather than throwing;
  the runtime folds the previous observation into `trend` (`up`/`down`/`flat`/
  `unknown`) and `delta` per route. The `balance/list` Remote returns every
  bound route in registration order (serial vendor calls) for the dashboard's
  multi-account view.
- **Shipped vendors** — concrete providers for the mainstream vendors that
  expose a public balance endpoint through their API key, plus explicit
  `supported: false` bindings for OpenAI / Anthropic / Google / xAI / Mistral
  so the dashboard shows a clear "no public balance endpoint" state instead of
  "unbound".

  | Provider | Endpoint | Default route | Credential ref | Currency |
  |---|---|---|---|---|
  | DeepSeek | `GET /user/balance` | `deepseek-official` | `DEEPSEEK_API_KEY` | CNY |
  | Moonshot | `GET /v1/users/me/balance` | `moonshot` | `MOONSHOT_API_KEY` | CNY |
  | OpenRouter | `GET /api/v1/credits` | `openrouter` | `OPENROUTER_API_KEY` | USD |
  | SiliconFlow | `GET /v1/user/info` | `siliconflow` | `SILICONFLOW_API_KEY` | CNY |
  | New API | `GET /api/user/self` (quota ÷ 500000 = USD) | `new-api` | `NEW_API_KEY` | USD |

- **User-managed bindings** — the `balance` settings section (`bindings[]`:
  `provider` + `vendor` + `credentialRef` or `credential` + optional `baseURL`)
  is registered on the `settings` seam and reconciled live on change; a
  same-origin Web route (`/_dsh/balance/settings`) serves a redacted GET
  snapshot and POST save (blank credential keeps the stored value). This is
  how self-hosted or custom routes get balance queries without code changes.
- **Web dashboard** — the browser half (`exports["./client"]`, discovered
  through `dsh.client`) mounts the balance Remote into `ctx.remote`, then
  registers the floating `BalanceWidget` into `shell.overlay` (id `balance`,
  order 100) with its view-settings store (zoom/dock/collapse, persisted under
  `dsh.balance.view`), and the providers config panel into the widget
  manager's "Configure" dialog (`widgets.config` slot). A single
  `BalanceController` follows the current session + model and refreshes on a
  fixed 30 s interval.

## Installation

Recommended: install the bundle, which mounts this plugin together with the
token-crit widget and the widgets manager page:

```sh
npm install @dsh-plugins/balance-bundle
```

Or add the plugin row directly to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: balance
      name: '@dsh-plugins/balance'
      config:
        requestTimeoutMs: 10000
        # New API is self-hosted; point the /api/user/self balance query at the instance.
        newApiBaseURL: http://localhost:3000
        bindings: []
        # bindings:
        #   - provider: new-api
        #     vendor: new-api
        #     credential: sk-xxxxxxxx
        #     baseURL: http://localhost:3000
        #   - provider: deepseek-official
        #     vendor: deepseek
        #     credentialRef: DEEPSEEK_API_KEY
```

The dashboard appears as a floating overlay once a session is open. The
default bindings need no configuration — just store the matching API key in
the credential reference (DeepSeek → `DEEPSEEK_API_KEY`, Moonshot →
`MOONSHOT_API_KEY`, OpenRouter → `OPENROUTER_API_KEY`, SiliconFlow →
`SILICONFLOW_API_KEY`, New API → `NEW_API_KEY`). To query additional or
self-hosted routes, add a binding in Web settings → Widgets manager →
Balance → **Configure** (dialog) and store the token; the next dashboard
refresh picks it up without a restart.

## Model Experience

None. The balance service and dashboard are consumed only by the Web widget;
no balance value, credential or trend enters session logs, model context or
telemetry.

#### KV Cache effect

None; the runtime keeps an in-process trend seed per route and the widget
persists only its own view-settings key in `localStorage`.

## Known Limitations and Deferred Work

- **Trend history is in-process** — after a restart the first observation
  returns to `unknown`; there is no persisted balance history.
- **One provider per route** — a route binds at most one vendor; OpenAI
  compatible gateways reselling several vendors cannot dispatch per account.
- **Deployment-wide timeout** — `requestTimeoutMs` (default 10000) applies to
  all vendor queries; per-vendor timeouts are not supported yet.
- **Fixed refresh interval** — the 30 s dashboard refresh is a constant, not a
  settings or composition field.
- **Response-structure sensitive** — vendors changing their response shape
  fail normalization with `provider-error`; no versioned fallback.

## Invariant companion

`@dsh-plugins/balance/invariant` ships the package-owned invariant companion
registered with the `invariants` seam. It is optional and not mounted by the
bundle.

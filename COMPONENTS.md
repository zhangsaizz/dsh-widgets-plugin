# 组件管理列表（Component Registry）

本文件是 `dsh-balance-plugin` 仓库的组件登记册：仓库里每一个组件、发布包、插槽注册点、
构建产物、依赖关系与维护要求的唯一清单。**新增或修改组件时，请同步更新本表**（总览 →
明细 → 插槽 → 产物 → 维护清单），发布前按第 7 节过一遍。

> 术语约定：
> - **组件**：一个可独立识别的最小可交付单元（服务、Provider、挂件、设置页、bundle）。
> - **包**：发布到 npm 的容器（`@dsh-plugins/*`），一个包可含多个组件。
> - **插槽（slot）**：Harness 浏览器端/宿主的扩展点（`shell.overlay`、`settings.section`、`remote`、`webServer`）。

---

## 1. 组件总览

| # | 组件 | 类型 | 所属包 | 呈现位置 | 一句话说明 |
|---|---|---|---|---|---|
| 1 | balance 能力缝隙（Host） | 能力缝隙 | `@dsh-plugins/balance` | Host 服务 | `ctx.balance`（`BalanceRuntime`）：绑定提供商路由，应答 `balance/query`、`balance/list` Remote |
| 2 | balance Remote 挂载（Client） | 客户端服务 | `@dsh-plugins/balance` | client `remote` 服务 | 把生成的 balance Remote（`balance/query` + `balance/list`）挂进 client 的 `remote` |
| 3 | 余额厂商 Provider ×5 | Host 插件 | `@dsh-plugins/balance-vendors` | Host | deepseek / moonshot / openrouter / siliconflow / new-api 五个真实余额查询 |
| 4 | 不支持厂商占位 ×5 | Host 插件 | `@dsh-plugins/balance-vendors` | Host | openai / anthropic / google / xai / mistral 的「无公开余额接口」占位 |
| 5 | 余额设置 Web 后端 | Host Web 路由 | `@dsh-plugins/balance-vendors` | `/_dsh/balance/settings` | 设置页的 GET 快照（脱敏）与 POST 持久化 |
| 6 | 余额看板挂件 `BalanceWidget` | Web 挂件 | `@dsh-plugins/client-ui-balance` | `shell.overlay`（order 100） | 浮动余额看板：缩放/吸附/折叠、滚动金额、趋势箭头、单/多账户视图 |
| 7 | 余额供应商配置面板 `BalanceSettings` | Web 配置弹窗 | `@dsh-plugins/client-ui-balance` | `widgets.config`（管理器「配置」弹窗） | 管理 `balance` 设置分区的用户绑定（provider/vendor/凭据/baseURL） |
| 8 | `BalanceController` + `useBalance` | 客户端数据层 | `@dsh-plugins/client-ui-balance` | 注入 hook | 跟随当前 session + model，固定 30s 轮询刷新，暴露 `refresh()` |
| 9 | balance 视图 store | 客户端状态 | `@dsh-plugins/client-ui-balance` | 注入 store | 缩放 / 吸附 / 折叠视图状态（`createBalanceViewStore`） |
| 10 | 字典 NS `balance` | 客户端 i18n | `@dsh-plugins/client-ui-balance` | client locale | zh / en 双语文案 |
| 11 | Token 暴击挂件 `TokenCritWidget` | Web 挂件 | `@dsh-plugins/client-ui-token-crit` | `shell.overlay`（order 50） | 透明可拖动/缩放的 token 用量计数器 + 暴击动效 + 设置面板 |
| 12 | 安装 bundle | 分发层 | `@dsh-plugins/balance-bundle` | `cordis.patch.yml` | 一次插入 5 个插件，一键挂载全部组件 |
| 13 | 小组件管理页 `WidgetManagerSettings` | Web 设置页 | `@dsh-plugins/client-ui-widget-manager` | `settings.section`（order 10） | 实时列出小组件，支持「添加/关闭」，并为带配置的挂件提供「配置」弹窗 |

---

## 2. 发布包清单

6 个包版本号保持一致（当前 **0.1.0**），全部带 `"publishConfig": { "access": "public" }`，
包间依赖一律 `workspace:*`（禁止 `link:`）。

| 包 | 版本 | 角色 | 发布内容（files） | 关键 exports | 维护来源 |
|---|---|---|---|---|---|
| `@dsh-plugins/balance` | 0.1.0 | 能力缝隙（Host + client Remote） | `lib` | `.`、`./invariant`、`./types`、`./typert`、`./remote`、`./client` | 同步自 harness（sync.mjs） |
| `@dsh-plugins/balance-vendors` | 0.1.0 | 厂商 Provider + 设置 Web 后端 | `lib` | `.`、`./invariant` | 同步自 harness（sync.mjs） |
| `@dsh-plugins/client-ui-balance` | 0.1.0 | 余额看板挂件 + 设置页（浏览器端） | `lib` | `.`、`./invariant`、`./client` | 同步自 harness（sync.mjs） |
| `@dsh-plugins/client-ui-token-crit` | 0.1.0 | Token 暴击挂件（浏览器端，纯 UI） | `lib` | `.`、`./client` | 独立维护（不在同步列表） |
| `@dsh-plugins/client-ui-widget-manager` | 0.1.0 | 小组件管理设置页（浏览器端，纯 UI） | `lib` | `.`、`./client` | 独立维护（不在同步列表） |
| `@dsh-plugins/balance-bundle` | 0.1.0 | 可安装 bundle | `cordis.patch.yml` | `./cordis.patch.yml` | 独立维护 |

每个包的 `package.json` 还带 `dsh.client` 声明（`inject` 依赖列表 + `platform: "web"`），
浏览器产物由该声明被发现。

---

## 3. 组件明细

### 3.1 `balance` 能力缝隙（Host seam）

- 包：`@dsh-plugins/balance`（`packages/dsh-balance`）
- Host 入口 `src/index.ts`：导出 `BalanceRuntime`（默认导出）、`BalanceProvider` 基类、
  `BalanceAccountData` / `BalanceProviderInfo` 类型、`Config`（`requestTimeoutMs`，默认 10000）。
  宿主注册后提供 `ctx.balance` 服务：绑定 LLM 提供商路由 → 厂商 Provider，应答
  `balance/query`（单账户查询）+ `balance/list`（列表）两个 Remote。
- Client 入口 `src/client/index.ts`：`inject = ['remote']`，通过 `ctx.remote.$mount(TYPERT_REMOTE)`
  把生成的 balance Remote 挂进 client 的 `remote` 服务；dispose 时撤回。
- `dsh.client`：`inject: ["@deepseek-ai/dsh-api-remotes"]`，`platform: "web"`。
- 依赖：`zod`、`@deepseek-ai/schemastery`（deps）；`@deepseek-ai/cordis`、
  `@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-invariants`、
  `@deepseek-ai/dsh-typert-protocol`（peer）。
- 构建：Host → `lib/index.js`（ESM，外部化 `@deepseek-ai/*`、`@dsh-plugins/*`、`zod`）；
  Client → `lib/client.js`（ModuleLoader CJS 包装，zod 内联）。`lib/typert.*` 为同步产物。

### 3.2 厂商 Provider（`balance-vendors`）

- 包：`@dsh-plugins/balance-vendors`（`packages/dsh-balance-vendors`），入口 `src/index.ts`。
- `inject = ['balance', 'settings']`；注册 `PROVIDERS`（内置 5 厂商 + 5 占位）后，再按
  部署配置 `bindings[]` 与设置区的用户绑定逐一注册；绑定随插件 fiber 级联卸载。
- 支持厂商（均继承 `BalanceProvider`，凭据值不进日志/报错）：

| Provider 类 | 厂商 | 端点 | 默认提供商路由 | 默认凭据引用 | 币种 |
|---|---|---|---|---|---|
| `DeepSeekBalanceProvider` | deepseek | `GET https://api.deepseek.com/user/balance` | `deepseek-official` | `DEEPSEEK_API_KEY` | CNY |
| `MoonshotBalanceProvider` | moonshot | `GET https://api.moonshot.cn/v1/users/me/balance` | `moonshot` | `MOONSHOT_API_KEY` | CNY |
| `OpenRouterBalanceProvider` | openrouter | `GET https://openrouter.ai/api/v1/credits` | `openrouter` | `OPENROUTER_API_KEY` | USD |
| `SiliconFlowBalanceProvider` | siliconflow | `GET https://api.siliconflow.cn/v1/user/info` | `siliconflow` | `SILICONFLOW_API_KEY` | CNY |
| `NewApiBalanceProvider` | new-api | `GET {baseURL}/api/user/self`（quota ÷ 500000 = USD） | `new-api` | `NEW_API_KEY` | USD |

- 不支持厂商占位：`UnsupportedBalanceProvider` ×5（`UNSUPPORTED_VENDORS`）——
  openai / anthropic / google（含 gemini）/ xai / mistral，查询直接拒绝，
  看板显示「无公开余额接口」而非「未绑定」。
- 配置（`Config`）：`newApiBaseURL`（New API 自托管实例，默认 `http://localhost:3000`）、
  `bindings[]`（`provider` + `vendor` + `credentialRef` 或 `credential` + 可选 `baseURL`）。
- 设置区：`BALANCE_SETTINGS_NS = settingsNamespace('balance')`；
  `bindingSchema = { provider, vendor, credentialRef, credential, baseURL }`；
  `BalanceSettingsSchema = { bindings[] }`；设置变化时 `reconcile` 增量增删绑定。
- Web 后端（`src/web.ts`）：`BalanceWebBackend` 挂载在
  `SETTINGS_ROUTE = '/_dsh/balance/settings'`（`webServer` 精确路由）——
  GET 返回脱敏快照（内联凭据替换为 `credentialConfigured`），POST `save`
  （`expectedRevision` 乐观并发，留空凭据 = 保留原值）。

### 3.3 余额看板（`client-ui-balance`）

- 包：`@dsh-plugins/client-ui-balance`（`packages/dsh-client-ui-balance`）。
- Host 半（`src/index.ts`）：**空 apply**（surface 占位，无 Host 行为）。
- Client 半（`src/client/index.ts`）：`inject = ['slots', 'sessions', 'remote',
  'remote.balance', 'connection', 'locale']`，注册挂件 + 数据层 + 字典 + 配置面板：
  - `shell.overlay`，id `balance`，order **100** → `BalanceWidget`；
    store = `createBalanceViewStore`；locale NS = `balance`；
    inject = `{ hooks: { balance: BalanceController }, refresh }`。
  - `widgets.config`，id `balance`，order **0** → `BalanceSettings`（余额供应商
    配置面板）。**（本地改动）** 配置面板注册进小组件管理（`client-ui-widget-manager`）
    声明的 `widgets.config` 子槽，在管理页的「配置」弹窗中渲染——不再占用 Web 设置的
    菜单页；管理器缺席时该槽不被声明，注册自动跳过（配置面板随 bundle 一起分发）。
    此改动会随 `pnpm sync` 被覆盖，同步后需重新应用（`BalanceSettings` 经
    type-only 导入依赖管理器的 SlotMap 类型，peer 依赖 `client-ui-widget-manager`）。
  - `BalanceController`：以 `ctx.remote.balance` 为源，跟随当前会话 + 模型，
    `REFRESH_INTERVAL_MS = 30_000` 固定轮询，暴露 `refresh()` 手动刷新动词。
  - 字典 NS `balance`（zh / en），经 `LocaleNamespaceMap` 类型合并声明。
- `BalanceWidget` 行为要点：缩放（`MIN_SCALE` / `MAX_SCALE`）、角落吸附
  （`SNAP_THRESHOLD = 56px`、`DOCK_INSET = 16px`）、折叠胶囊（其他供应商余额变化时
  3s 高亮，`HIGHLIGHT_MS = 3000`）、观察值间滚动动画、趋势箭头（▲/▼/–）。
- 数据/类型出口（`exports["./client"]` 类型面）：`BalanceController`、`BalancePhase`、
  `BalanceRemote`、`BalanceViewState`、`BalanceWidgetProps`、`BalanceInject`、
  `BalanceSettingsInjected`、`BalanceKey`、`createBalanceViewStore`、`BalanceViewSettings`。

### 3.4 Token 暴击挂件（`client-ui-token-crit`）

- 包：`@dsh-plugins/client-ui-token-crit`（`packages/dsh-client-ui-token-crit`），**纯 UI**。
- Host 半（`src/index.ts`）：空 apply（surface 占位）。
- Client 半（`src/client/index.ts`）：`inject = ['slots']`，注册
  `shell.overlay`，id `token-crit`，order **50** → `TokenCritWidget`。
- 数据来源：标准 `useSessions` 会话投影 `tokenUsage`（uncachedInput / output /
  cacheRead / cacheWrite 分桶）——**无 Host RPC、无轮询**，运行时响应式推送。
- 动效：滚动数字、浮动 input/output 伤害数字、粒子、连击计数、边缘泛光、可选音效；
  hover 显示设置面板（语言、数字格式/字号、标签、连击、粒子、暴击阈值/比例、音效、泛光）；
  位置与缩放写入 `localStorage`。

### 3.5 安装 bundle（`balance-bundle`）

- 包：`@dsh-plugins/balance-bundle`（`bundles/dsh-balance-bundle`）。
- `dsh.bundle.patch = ./cordis.patch.yml`；依赖 5 个 `workspace:*` 包。
- `cordis.patch.yml` 插入顺序：`balance`（requestTimeoutMs 10000）→
  `balance-vendors`（newApiBaseURL / bindings）→ `ui-balance` → `ui-token-crit` →
  `ui-widget-manager`。

### 3.6 小组件管理页（`client-ui-widget-manager`）

- 包：`@dsh-plugins/client-ui-widget-manager`（`packages/dsh-client-ui-widget-manager`），**纯 UI**。
- Host 半（`src/index.ts`）：空 apply（surface 占位）。
- Client 半（`src/client/index.ts`）：`inject = ['slots', 'locale']`，注册
  `settings.section`，id `widgets`，order **10** → `WidgetManagerSettings`（「小组件管理」页），
  并在同一注册中**声明 `widgets.config` 子槽**（list，条目 id = 挂件 id）。
- 列表数据：`WidgetManagerController` 订阅 `shell.overlay` 与 `widgets.config` 台账
  （`ctx.slots.subscribe` + `entries`），结合内置目录（`widgets.ts`：balance / token-crit）
  投影每行的「已启用 / 已关闭 / 未安装」状态；`hasConfig` 由 `widgets.config` 的
  实时注册推导（挂件贡献了配置面板才显示「配置」按钮）；目录外的已注册挂件以通用行展示。
- **关闭（禁用）机制**：向 `shell.overlay` 注册同 `id`、`priority: -1` 的影子条目
  （list 槽单元渲染最低优先级胜者，ui-slots 影子机制）——挂件条目仍存活但不渲染；
  影子条目打 `registrant: "widget-manager"` 标记，随插件 fiber 卸载级联清理。
- **添加（启用）机制**：dispose 影子条目，挂件恢复渲染。
- **配置弹窗**：每行在「已启用且有配置面板」时显示**配置**按钮；点击后用
  `renderSlot('widgets.config', {}, { only: 挂件id })` 在独立弹窗中渲染挂件自己的
  配置组件（如 `BalanceSettings`）——配置不再占用 Web 设置的菜单页；挂件被关闭时
  配置按钮随之隐藏。
- 持久化：禁用 id 列表写 `localStorage`（`dsh-plugins.widget-manager.disabled`），
  启动与台账变化时自动对账（挂件晚挂载也会被立即补影子）。
- 字典 NS `widgets`（zh / en），经 `LocaleNamespaceMap` 类型合并声明。

---

## 4. 依赖关系

```mermaid
graph LR
  BUNDLE[@dsh-plugins/balance-bundle]
  SEAM[@dsh-plugins/balance]
  VENDORS[@dsh-plugins/balance-vendors]
  UI_BALANCE[@dsh-plugins/client-ui-balance]
  UI_CRIT[@dsh-plugins/client-ui-token-crit]
  UI_MANAGER[@dsh-plugins/client-ui-widget-manager]

  BUNDLE --> SEAM
  BUNDLE --> VENDORS
  BUNDLE --> UI_BALANCE
  BUNDLE --> UI_CRIT
  BUNDLE --> UI_MANAGER
  VENDORS -. peer .-> SEAM
  UI_BALANCE -. peer .-> SEAM
```

外部 peer 依赖（Harness 生态，`@deepseek-ai/*`）：

| 依赖 | 被谁需要 |
|---|---|
| `@deepseek-ai/cordis` | 全部 5 个可运行包 |
| `@deepseek-ai/dsh-invariants` | balance、balance-vendors |
| `@deepseek-ai/dsh-credentials` / `dsh-typert-protocol` | balance |
| `@deepseek-ai/dsh-settings` | balance-vendors（设置区 + Web 后端） |
| `@deepseek-ai/dsh-api-remotes` | balance（client）、client-ui-balance |
| `@deepseek-ai/dsh-client-runtime` | client-ui-balance、client-ui-token-crit、client-ui-widget-manager |
| `@deepseek-ai/dsh-client-ui-layout` | client-ui-balance、client-ui-token-crit、client-ui-widget-manager（`shell.overlay` 类型合并） |
| `@deepseek-ai/dsh-client-locale` | client-ui-balance、client-ui-widget-manager |
| `@deepseek-ai/dsh-client-ui-settings` | client-ui-balance、client-ui-widget-manager（`settings.section`） |
| `@deepseek-ai/dsh-client-ui-slots` | client-ui-balance、client-ui-token-crit、client-ui-widget-manager |
| `react` | client-ui-balance、client-ui-token-crit、client-ui-widget-manager |

---

## 5. 构建产物

`pnpm build`（`node scripts/build.mjs`）用 esbuild 构建，产物全部进 `lib/`（gitignore，不提交）：

| 包 | Host 产物 | 浏览器产物 | 包装方式 |
|---|---|---|---|
| `@dsh-plugins/balance` | `lib/index.js`（ESM，外部化） | `lib/client.js` | ModuleLoader CJS，zod 内联；`lib/typert.*` 为同步产物 |
| `@dsh-plugins/balance-vendors` | `lib/index.js`（ESM，外部化） | — | — |
| `@dsh-plugins/client-ui-balance` | `lib/index.js`（空 apply 壳） | `lib/client.js` | ModuleLoader CJS + 内联 CSS（`--loader:.css=local-css`） |
| `@dsh-plugins/client-ui-token-crit` | `lib/index.js`（空 apply 壳） | `lib/client.js` | ModuleLoader CJS + 内联 CSS |
| `@dsh-plugins/client-ui-widget-manager` | `lib/index.js`（ESM，空 apply 壳） | `lib/client.js` | ModuleLoader CJS + 内联 CSS |
| `@dsh-plugins/balance-bundle` | —（仅 `cordis.patch.yml`） | — | — |

外部化清单：`@deepseek-ai/*`、`@dsh-plugins/*`、`zod`、`react`、`react/*`。

---

## 6. 插槽注册汇总

| 插槽 | id | order | 注册方（包） | 组件 |
|---|---|---|---|---|
| `shell.overlay` | `balance` | 100 | client-ui-balance | `BalanceWidget` |
| `shell.overlay` | `token-crit` | 50 | client-ui-token-crit | `TokenCritWidget` |
| `shell.overlay` | `balance` / `token-crit` | priority -1（影子） | client-ui-widget-manager | `ShadowWidget`（禁用时隐藏挂件） |
| `settings.section` | `widgets` | 10 | client-ui-widget-manager | `WidgetManagerSettings`（声明子槽 `widgets.config`） |
| `widgets.config` | `balance` | 0 | client-ui-balance | `BalanceSettings`（管理页「配置」弹窗内容） |
| `remote` | balance Remote | — | balance（client 半） | `balance/query` + `balance/list` |
| `webServer` | `/_dsh/balance/settings` | — | balance-vendors | `BalanceWebBackend` |

---

## 7. 维护清单

**新增组件（按 AGENTS.md 第 4 节与 [WIDGET-DEVELOPMENT.md](WIDGET-DEVELOPMENT.md) 后）：**

- [ ] 在「组件总览」加一行（类型、所属包、呈现位置）
- [ ] 若发布新包：更新「发布包清单」+ 版本号与其余包对齐
- [ ] 若新增插槽注册：更新「插槽注册汇总」（注意 order 冲突）
- [ ] 若新增 Provider：更新 3.2 的厂商表（端点/路由/凭据/币种）
- [ ] 若新增浏览器产物：在 `scripts/build.mjs` 照抄 client bundle 段落，并更新「构建产物」
- [ ] 若新增带配置的小组件：把配置面板注册进管理器声明的 `widgets.config` 槽
  （`ctx.slots.inject('widgets.config', …)`，条目 id = 挂件 id），管理页即自动显示
  「配置」按钮并在弹窗中渲染
- [ ] 若改动**同步自 harness 的包**（balance 三个包）：标注「本地改动」，`pnpm sync` 会覆盖，同步后需重新应用
- [ ] 补双语 README + `README.i18n.yaml`（hash 用 `git hash-object` 重算）

**发布前：**

- [ ] `pnpm build` 让 `lib/` 产物跟上（CI 断言 build 后 git 干净）
- [ ] `pnpm -r pack` 检查 tarball 内容（`workspace:*` 应被改写为实际版本）
- [ ] 改过 README 则同步双语对 + 更新 `README.i18n.yaml`
- [ ] 5 个包版本一致；打 `v*` tag 触发 publish.yml（需 `NPM_TOKEN`）

**同步（`pnpm sync`）注意：**

- 只覆盖 `dsh-balance`、`dsh-balance-vendors`、`dsh-client-ui-balance` 三个包的
  `src` + `lib`，并把 `@deepseek-ai/dsh-balance*` 改写为 `@dsh-plugins/*`；
  **token-crit 与 bundle 不在同步列表**，改动会保留。
- 同步后必须重跑 `pnpm build` 与 `pnpm -r publish`。

---

## 8. 版本与状态

| 项 | 值 |
|---|---|
| 包版本 | 0.1.0（5 包一致） |
| 语言约定 | 根文档中文；包 README 双语对 + `README.i18n.yaml` hash 凭据 |
| CI | install → build → pack → git diff 干净（ci.yml）；`v*` tag 发布（publish.yml） |

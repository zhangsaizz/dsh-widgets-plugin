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
| 3 | 余额厂商 Provider ×5 | Host 插件 | `@dsh-plugins/balance` | Host | deepseek / moonshot / openrouter / siliconflow / new-api 五个真实余额查询 |
| 4 | 不支持厂商占位 ×5 | Host 插件 | `@dsh-plugins/balance` | Host | openai / anthropic / google / xai / mistral 的「无公开余额接口」占位 |
| 5 | 余额设置 Web 后端 | Host Web 路由 | `@dsh-plugins/balance` | `/_dsh/balance/settings` | 设置页的 GET 快照（脱敏）与 POST 持久化 |
| 6 | 余额看板挂件 `BalanceWidget` | Web 挂件 | `@dsh-plugins/balance` | `shell.overlay`（order 100） | 浮动余额看板：视口内拖动/角吸附/缩放/折叠过渡、滚动金额、趋势箭头、单/多账户视图 |
| 7 | 余额供应商配置面板 `BalanceSettings` | Web 配置弹窗 | `@dsh-plugins/balance` | `widgets.config`（管理器「配置」弹窗） | 管理 `balance` 设置分区的用户绑定（provider/vendor/凭据/baseURL） |
| 8 | `BalanceController` + `useBalance` | 客户端数据层 | `@dsh-plugins/balance` | 注入 hook | 跟随当前 session + model，固定 30s 轮询刷新，暴露 `refresh()` |
| 9 | balance 视图 store | 客户端状态 | `@dsh-plugins/balance` | 注入 store | 缩放 / 吸附 / 折叠视图状态（`createBalanceViewStore`） |
| 10 | 字典 NS `balance` | 客户端 i18n | `@dsh-plugins/balance` | client locale | zh / en 双语文案 |
| 11 | Token 暴击挂件 `TokenCritWidget` | Web 挂件 | `@dsh-plugins/client-ui-token-crit` | `shell.overlay`（order 50） | 透明可拖动/缩放的 token 用量计数器 + 暴击动效 + 设置面板 |
| 12 | 安装 bundle | 分发层 | `@dsh-plugins/balance-bundle` | `cordis.patch.yml` | 一次插入 3 个插件，一键挂载全部组件 |
| 13 | 小组件管理页 `WidgetManagerSettings` | Web 设置页 | `@dsh-plugins/client-ui-widget-manager` | `settings.section`（order 10） | 实时列出小组件，支持「添加/关闭」，并为带配置的挂件提供「配置」弹窗 |

> 1–10 全部由 `@dsh-plugins/balance` 一个包、一个插件行承载（原 `balance` 缝隙 +
> `balance-vendors` + `client-ui-balance` 三个包已合并）。

---

## 2. 发布包清单

4 个包版本号保持一致（当前 **0.1.0**），全部带 `"publishConfig": { "access": "public" }`，
包间依赖一律 `workspace:*`（禁止 `link:`）。

| 包 | 版本 | 角色 | 发布内容（files） | 关键 exports | 维护来源 |
|---|---|---|---|---|---|
| `@dsh-plugins/balance` | 0.1.0 | 合并后的余额插件（Host 缝隙 + 厂商 + Web 看板） | `lib` | `.`、`./invariant`、`./types`、`./typert`、`./remote`、`./client` | 独立维护（已废弃 harness 同步） |
| `@dsh-plugins/client-ui-token-crit` | 0.1.0 | Token 暴击挂件（浏览器端，纯 UI） | `lib` | `.`、`./client` | 独立维护 |
| `@dsh-plugins/client-ui-widget-manager` | 0.1.0 | 小组件管理设置页（浏览器端，纯 UI） | `lib` | `.`、`./client` | 独立维护 |
| `@dsh-plugins/balance-bundle` | 0.1.0 | 可安装 bundle | `cordis.patch.yml` | `./cordis.patch.yml` | 独立维护 |

每个包的 `package.json` 还带 `dsh.client` 声明（`inject` 依赖列表 + `platform: "web"`），
浏览器产物由该声明被发现。

---

## 3. 组件明细

### 3.1 合并后的余额插件（`@dsh-plugins/balance`）

- 包：`@dsh-plugins/balance`（`packages/dsh-balance`），**一个插件行**。
- Host 入口 `src/index.ts`：`name`/`inject: ['settings']`/`Config`/`apply`。
  `apply()` 依次：
  1. `new BalanceRuntime(ctx, { requestTimeoutMs })` —— 构造即经 `Service` 基类
     自注册 `ctx.balance`（绑定提供商路由，应答 `balance/query` + `balance/list` 两个
     Remote；凭据经 `ctx.credentials` 或环境变量解析；按路由折叠 trend/delta）。
  2. 注册 `PROVIDERS`（5 厂商 + 5 占位）与 `bindings[]` 静态绑定；New API 实例地址由
     `newApiBaseURL` 配置。
  3. 注册 `balance` 设置分区（`BALANCE_SETTINGS_NS`，`bindingSchema`），监听变更实时
     对账用户绑定。
  4. 挂 `/_dsh/balance/settings` Web 后端（`BalanceWebBackend`，GET 脱敏快照 /
     POST 乐观并发保存，`webServer` 缺席时跳过）。
  - 所有注册都是本 fiber 的 effect，卸载级联撤回。
- 浏览器半 `src/client/index.ts`：`inject = ['remote', 'slots', 'sessions', 'connection',
  'locale']`（**不含 `remote.balance`**——由本插件自己 `$mount` 提供；cordis 会把
  声明式 inject 沿 fiber 父链解析，而 `$mount` 的贡献在旁支 fiber，声明反而会卡死插件，
  所以挂载后经 `ctx.get('remote.balance')` 按 store 直读，不经属性解析）：
  - `await ctx.remote.$mount(TYPERT_REMOTE)` 先挂 Remote，再注册：
  - `shell.overlay`，id `balance`，order **100** → `BalanceWidget`；store =
    `createBalanceViewStore`；locale NS = `balance`；inject = `{ hooks: { balance:
    BalanceController }, refresh }`。
  - `widgets.config`，id `balance`，order **0** → `BalanceSettings`（供应商配置面板，
    注册进小组件管理声明的 `widgets.config` 子槽；管理器缺席时自动跳过）。
  - `BalanceController`：以 `ctx.get('remote.balance')` 为源，跟随当前会话 + 模型，
    `REFRESH_INTERVAL_MS = 30_000` 固定轮询，暴露 `refresh()`。
  - 字典 NS `balance`（zh / en），经 `LocaleNamespaceMap` 类型合并声明。
- 厂商 Provider（`src/providers.ts`，均继承 `BalanceProvider`，凭据值不进日志/报错）：

| Provider 类 | 厂商 | 端点 | 默认提供商路由 | 默认凭据引用 | 币种 |
|---|---|---|---|---|---|
| `DeepSeekBalanceProvider` | deepseek | `GET https://api.deepseek.com/user/balance` | `deepseek-official` | `DEEPSEEK_API_KEY` | CNY |
| `MoonshotBalanceProvider` | moonshot | `GET https://api.moonshot.cn/v1/users/me/balance` | `moonshot` | `MOONSHOT_API_KEY` | CNY |
| `OpenRouterBalanceProvider` | openrouter | `GET https://openrouter.ai/api/v1/credits` | `openrouter` | `OPENROUTER_API_KEY` | USD |
| `SiliconFlowBalanceProvider` | siliconflow | `GET https://api.siliconflow.cn/v1/user/info` | `siliconflow` | `SILICONFLOW_API_KEY` | CNY |
| `NewApiBalanceProvider` | new-api | `GET {baseURL}/api/user/self`（quota ÷ 500000 = USD） | `new-api` | `NEW_API_KEY` | USD |

  不支持厂商占位：`UnsupportedBalanceProvider` ×5（`UNSUPPORTED_VENDORS`）——
  openai / anthropic / google（含 gemini）/ xai / mistral，查询直接拒绝，
  看板显示「无公开余额接口」而非「未绑定」。

- 配置（`Config`）：`requestTimeoutMs`（默认 10000）、`newApiBaseURL`（默认
  `http://localhost:3000`）、`bindings[]`（`provider` + `vendor` + `credentialRef`
  或 `credential` + 可选 `baseURL`）。
- 设置区（`src/settings.ts`）：`BALANCE_SETTINGS_NS = settingsNamespace('balance')`；
  `BalanceSettingsSchema = { bindings[] }`；`bindingSchema`（credential 带 `secret`
  role、credentialRef 带 `credential-ref` role）。
- Web 后端（`src/web.ts`）：`SETTINGS_ROUTE = '/_dsh/balance/settings'`（`webServer`
  精确路由）——GET 返回脱敏快照，POST `save`（`expectedRevision` 乐观并发，留空
  凭据 = 保留原值）。
- `src/invariant.ts`：包级 invariant 伴侣（`./invariant` 子路径，可选，bundle 不挂载）。
- 类型面：`BalanceProvider`、`BalanceRuntime`、`BalanceProviderInfo`、
  `BalanceAccountData`、`BalanceAccount`、`BalanceQueryResult`、`BalanceListResult`、
  `BalanceBindingConfig`（`./types`）、client 面 `BalanceController`、`BalancePhase`、
  `BalanceRemote`、`BalanceViewState`、`BalanceWidgetProps`、`BalanceInject`、
  `BalanceSettingsInjected`、`BalanceKey`、`createBalanceViewStore`（`./client` 类型面）。
- 依赖：`zod`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-settings`（deps）；
  `@deepseek-ai/cordis`、`dsh-credentials`、`dsh-invariants`、`dsh-typert-protocol`、
  `dsh-api-remotes`、`dsh-client-runtime`、`dsh-client-locale`、`dsh-client-ui-layout`、
  `dsh-client-ui-slots`、`@dsh-plugins/client-ui-widget-manager`（type-only，peer）、
  `react`（peer）。
- 构建：Host → `lib/index.js`（ESM，外部化）；Client → `lib/client.js`
  （ModuleLoader CJS + 内联 CSS，`--loader:.css=local-css`）。`lib/typert.*` 为
  typert codegen 产物，`pnpm build` 不重建。

### 3.2 Token 暴击挂件（`client-ui-token-crit`）

- 包：`@dsh-plugins/client-ui-token-crit`（`packages/dsh-client-ui-token-crit`），**纯 UI**。
- Host 半（`src/index.ts`）：空 apply（surface 占位）。
- Client 半（`src/client/index.ts`）：`inject = ['slots']`，注册
  `shell.overlay`，id `token-crit`，order **50** → `TokenCritWidget`。
- 数据来源：标准 `useSessions` 会话投影 `tokenUsage`（uncachedInput / output /
  cacheRead / cacheWrite 分桶）——**无 Host RPC、无轮询**，运行时响应式推送。
- 动效：滚动数字、浮动 input/output 伤害数字、粒子、连击计数、边缘泛光、可选音效；
  hover 显示设置面板（语言、数字格式/字号、标签、连击、粒子、暴击阈值/比例、音效、泛光）；
  位置与缩放写入 `localStorage`。

### 3.3 安装 bundle（`balance-bundle`）

- 包：`@dsh-plugins/balance-bundle`（`bundles/dsh-balance-bundle`）。
- `dsh.bundle.patch = ./cordis.patch.yml`；依赖 3 个 `workspace:*` 包。
- `cordis.patch.yml` 插入顺序：`balance`（requestTimeoutMs / newApiBaseURL / bindings）→
  `ui-token-crit` → `ui-widget-manager`。

### 3.4 小组件管理页（`client-ui-widget-manager`）

- 包：`@dsh-plugins/client-ui-widget-manager`（`packages/dsh-client-ui-widget-manager`），**纯 UI**。
- Host 半（`src/index.ts`）：空 apply（surface 占位）。
- Client 半（`src/client/index.ts`）：`inject = ['slots', 'locale']`，注册
  `settings.section`，id `widgets`，order **10** → `WidgetManagerSettings`（「小组件管理」页），
  并在同一注册中**声明 `widgets.config` 子槽**（list，条目 id = 挂件 id）。
- 列表数据：`WidgetManagerController` 订阅 `shell.overlay` 与 `widgets.config` 台账
  （`ctx.slots.subscribe` + `entries`），结合内置目录（`widgets.ts`：balance /
  token-crit）投影每行的「已启用 / 已关闭 / 未安装」状态；`hasConfig` 由 `widgets.config`
  的实时注册推导。**目录中余额看板的 `packageName` 是 `@dsh-plugins/balance`**。
- **关闭（禁用）机制**：向 `shell.overlay` 注册同 `id`、`priority: -1` 的影子条目
  （list 槽单元渲染最低优先级胜者，ui-slots 影子机制）——挂件条目仍存活但不渲染；
  影子条目打 `registrant: "widget-manager"` 标记，随插件 fiber 卸载级联清理。
- **添加（启用）机制**：dispose 影子条目，挂件恢复渲染。
- **配置弹窗**：每行在「已启用且有配置面板」时显示**配置**按钮；点击后用
  `renderSlot('widgets.config', {}, { only: 挂件id })` 在独立弹窗中渲染挂件自己的
  配置组件（如 `BalanceSettings`）；挂件被关闭时配置按钮随之隐藏。
- 持久化：禁用 id 列表写 `localStorage`（`dsh-plugins.widget-manager.disabled`），
  启动与台账变化时自动对账。
- 字典 NS `widgets`（zh / en），经 `LocaleNamespaceMap` 类型合并声明。

---

## 4. 依赖关系

```mermaid
graph LR
  BUNDLE[@dsh-plugins/balance-bundle]
  BALANCE[@dsh-plugins/balance]
  UI_CRIT[@dsh-plugins/client-ui-token-crit]
  UI_MANAGER[@dsh-plugins/client-ui-widget-manager]

  BUNDLE --> BALANCE
  BUNDLE --> UI_CRIT
  BUNDLE --> UI_MANAGER
  BALANCE -. peer（type-only） .-> UI_MANAGER
```

外部 peer 依赖（Harness 生态，`@deepseek-ai/*`）：

| 依赖 | 被谁需要 |
|---|---|
| `@deepseek-ai/cordis` | 全部 3 个可运行包 |
| `@deepseek-ai/dsh-invariants` | balance（invariant 伴侣） |
| `@deepseek-ai/dsh-credentials` / `dsh-typert-protocol` | balance |
| `@deepseek-ai/dsh-settings` | balance（设置区 + Web 后端） |
| `@deepseek-ai/dsh-api-remotes` | balance（client） |
| `@deepseek-ai/dsh-client-runtime` | balance、client-ui-token-crit、client-ui-widget-manager |
| `@deepseek-ai/dsh-client-ui-layout` | balance、client-ui-token-crit、client-ui-widget-manager（`shell.overlay` 类型合并） |
| `@deepseek-ai/dsh-client-locale` | balance、client-ui-widget-manager |
| `@deepseek-ai/dsh-client-ui-settings` | client-ui-widget-manager（`settings.section`） |
| `@deepseek-ai/dsh-client-ui-slots` | balance、client-ui-token-crit、client-ui-widget-manager |
| `react` | balance、client-ui-token-crit、client-ui-widget-manager |

---

## 5. 构建产物

`pnpm build`（`node scripts/build.mjs`）用 esbuild 构建，产物全部进 `lib/`（gitignore，不提交）：

| 包 | Host 产物 | 浏览器产物 | 包装方式 |
|---|---|---|---|
| `@dsh-plugins/balance` | `lib/index.js`（ESM，外部化） | `lib/client.js` | ModuleLoader CJS + 内联 CSS（`--loader:.css=local-css`）；`lib/typert.*` 为 typert codegen 产物（不重建） |
| `@dsh-plugins/client-ui-token-crit` | `lib/index.js`（空 apply 壳） | `lib/client.js` | ModuleLoader CJS + 内联 CSS |
| `@dsh-plugins/client-ui-widget-manager` | `lib/index.js`（ESM，空 apply 壳） | `lib/client.js` | ModuleLoader CJS + 内联 CSS |
| `@dsh-plugins/balance-bundle` | —（仅 `cordis.patch.yml`） | — | — |

外部化清单：`@deepseek-ai/*`、`@dsh-plugins/*`、`zod`、`react`、`react/*`。

---

## 6. 插槽注册汇总

| 插槽 | id | order | 注册方（包） | 组件 |
|---|---|---|---|---|
| `shell.overlay` | `balance` | 100 | balance | `BalanceWidget` |
| `shell.overlay` | `token-crit` | 50 | client-ui-token-crit | `TokenCritWidget` |
| `shell.overlay` | `balance` / `token-crit` | priority -1（影子） | client-ui-widget-manager | `ShadowWidget`（禁用时隐藏挂件） |
| `settings.section` | `widgets` | 10 | client-ui-widget-manager | `WidgetManagerSettings`（声明子槽 `widgets.config`） |
| `widgets.config` | `balance` | 0 | balance | `BalanceSettings`（管理页「配置」弹窗内容） |
| `remote` | balance Remote | — | balance（client 半） | `balance/query` + `balance/list` |
| `webServer` | `/_dsh/balance/settings` | — | balance | `BalanceWebBackend` |

---

## 7. 维护清单

**新增组件（按 AGENTS.md 第 4 节与 [WIDGET-DEVELOPMENT.md](WIDGET-DEVELOPMENT.md) 后）：**

- [ ] 在「组件总览」加一行（类型、所属包、呈现位置）
- [ ] 若发布新包：更新「发布包清单」+ 版本号与其余包对齐
- [ ] 若新增插槽注册：更新「插槽注册汇总」（注意 order 冲突）
- [ ] 若新增 Provider：更新 3.1 的厂商表（端点/路由/凭据/币种）
- [ ] 若新增浏览器产物：在 `scripts/build.mjs` 照抄 client bundle 段落，并更新「构建产物」
- [ ] 若新增带配置的小组件：把配置面板注册进管理器声明的 `widgets.config` 槽
  （`ctx.slots.inject('widgets.config', …)`，条目 id = 挂件 id），管理页即自动显示
  「配置」按钮并在弹窗中渲染
- [ ] 若改动 `@dsh-plugins/balance` 的 Remote 线协议：同步重新生成 `lib/typert.*`
  （typert codegen，build.mjs 不重建）
- [ ] 若重命名/新增余额相关包：同步更新 `dsh-client-ui-widget-manager/src/client/widgets.ts`
  目录里的 `packageName`
- [ ] 补双语 README + `README.i18n.yaml`（hash 用 `git hash-object` 重算）

**发布前：**

- [ ] `pnpm build` 让 `lib/` 产物跟上（CI 断言 build 后 git 干净）
- [ ] `pnpm -r pack` 检查 tarball 内容（`workspace:*` 应被改写为实际版本）
- [ ] 改过 README 则同步双语对 + 更新 `README.i18n.yaml`
- [ ] 各包版本一致；打 `v*` tag 触发 publish.yml（需 `NPM_TOKEN`）

**同步（已废弃）：**

- `scripts/sync.mjs` 已删除，余额源码**不再从 deepseek-harness 同步**（上游结构已
  重构）。上游若有余额改动，需人工搬移并做「三合一」适配（Host apply 合并、client
  合并、跨包 import 改相对 import）。

---

## 8. 版本与状态

| 项 | 值 |
|---|---|
| 包版本 | 0.1.0（4 包一致） |
| 语言约定 | 根文档中文；包 README 双语对 + `README.i18n.yaml` hash 凭据 |
| CI | install → build → pack → git diff 干净（ci.yml）；`v*` tag 发布（publish.yml） |

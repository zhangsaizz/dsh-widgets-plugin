# 组件管理列表（Component Registry）

本文件是 `dsh-widgets-plugin` 仓库的组件登记册：仓库里每一个组件、发布包、插槽注册点、
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
| 12 | 会话监控看板 `SessionMonitorWidget` | Web 挂件 | `@dsh-plugins/client-ui-session-monitor` | `shell.overlay`（order 90） | 列出运行中/空闲/本轮完成的会话（子代理默认过滤、可配置时间范围默认 1h），完成一轮主动弹提醒（按状态配色：完成/待处理/出错/中止/阻塞/token 上限等，可自动消失或需确认），点击行一键跳转；可收起为胶囊、拖角缩放 |
| 13 | 会话监控 Host 半 + 状态路由 | Host 插件 + Web 路由 | `@dsh-plugins/client-ui-session-monitor` | `/_dsh/session-monitor/status` | 监听 `turn/end` 记录结束原因（completed/aborted/blocked/error/max-tokens/interrupted），浏览器半 3s 轮询取回 |
| 14 | 会话监控配置面板 `SessionSettings` | Web 配置弹窗 | `@dsh-plugins/client-ui-session-monitor` | `widgets.config`（管理器「配置」弹窗） | 提醒开关/关闭方式/秒数/音效/提醒范围与列表显示选项，localStorage 持久化 |
| 15 | 安装 bundle | 分发层 | `@dsh-plugins/dsh-widgets-plugin` | `cordis.patch.yml` | 一次插入 4 个插件，一键挂载全部组件 |
| 16 | 小组件管理页 `WidgetManagerSettings` | Web 设置页 | `@dsh-plugins/client-ui-widget-manager` | `settings.section`（order 10） | 实时列出小组件，支持「添加/关闭」，并为带配置的挂件提供「配置」弹窗 |

> 1–10 全部由 `@dsh-plugins/balance` 一个包、一个插件行承载（原 `balance` 缝隙 +
> `balance-vendors` + `client-ui-balance` 三个包已合并）。

---

## 2. 发布包清单

5 个包版本号保持一致（当前 **0.1.0**），全部带 `"publishConfig": { "access": "public" }`，
包间依赖一律 `workspace:*`（禁止 `link:`）。

| 包 | 版本 | 角色 | 发布内容（files） | 关键 exports | 维护来源 |
|---|---|---|---|---|---|
| `@dsh-plugins/balance` | 0.1.0 | 合并后的余额插件（Host 缝隙 + 厂商 + Web 看板） | `lib` | `.`、`./invariant`、`./types`、`./typert`、`./remote`、`./client` | 独立维护（已废弃 harness 同步） |
| `@dsh-plugins/client-ui-token-crit` | 0.1.0 | Token 暴击挂件（浏览器端，纯 UI） | `lib` | `.`、`./client` | 独立维护 |
| `@dsh-plugins/client-ui-session-monitor` | 0.1.0 | 会话监控看板（Host 半：turn/end 原因跟踪 + 状态路由；浏览器端看板） | `lib` | `.`、`./client` | 独立维护 |
| `@dsh-plugins/client-ui-widget-manager` | 0.1.0 | 小组件管理设置页（浏览器端，纯 UI） | `lib` | `.`、`./client` | 独立维护 |
| `@dsh-plugins/dsh-widgets-plugin` | 0.1.0 | 可安装 bundle | `cordis.patch.yml` | `./cordis.patch.yml` | 独立维护 |

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
  （ModuleLoader CJS + 内联 CSS，`--loader:.css=local-css`）。`lib/types/**`
  由 `pnpm build` 的 tsc 步骤重新生成（`tsconfig.build.json`，改写 `.ts` 相对
  引用为 `.js`）；`lib/typert.*` 为 typert codegen 产物，**已提交进 git**
  （仓库无 codegen 工具，无法重建），`pnpm build` 不重建但会校验其存在。

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

### 3.3 安装 bundle（`dsh-widgets-plugin`）

- 包：`@dsh-plugins/dsh-widgets-plugin`（`bundles/dsh-widgets-plugin`）。
- `dsh.bundle.patch = ./cordis.patch.yml`；依赖 4 个 `workspace:*` 包。
- `cordis.patch.yml` 插入顺序：`balance`（requestTimeoutMs / newApiBaseURL / bindings）→
  `ui-token-crit` → `ui-session-monitor` → `ui-widget-manager`。

### 3.4 小组件管理页（`client-ui-widget-manager`）

- 包：`@dsh-plugins/client-ui-widget-manager`（`packages/dsh-client-ui-widget-manager`），**纯 UI**。
- Host 半（`src/index.ts`）：空 apply（surface 占位）。
- Client 半（`src/client/index.ts`）：`inject = ['slots', 'locale']`，注册
  `settings.section`，id `widgets`，order **10** → `WidgetManagerSettings`（「小组件管理」页），
  并在同一注册中**声明 `widgets.config` 子槽**（list，条目 id = 挂件 id）。
- 列表数据：`WidgetManagerController` 订阅 `shell.overlay` 与 `widgets.config` 台账
  （`ctx.slots.subscribe` + `entries`），结合内置目录（`widgets.ts`：balance /
  token-crit / session-monitor）投影每行的「已启用 / 已关闭 / 未安装」状态；`hasConfig` 由 `widgets.config`
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

### 3.5 会话监控看板（`client-ui-session-monitor`）

- 包：`@dsh-plugins/client-ui-session-monitor`（`packages/dsh-client-ui-session-monitor`），
  **Host 半 + 浏览器半**（双半插件行）。
- Host 半（`src/index.ts`）：监听 `session/event` 过滤 `turn/end`，`TurnEndStore`
  维护 per-session 结束原因表（`reason.kind`：completed / aborted / blocked /
  error / max-tokens / interrupted，插入序 LRU 上限 100、TTL 5 分钟），
  `session/disposed` 清理；经 `ctx.inject(['webServer'])` 可选挂载
  `/_dsh/session-monitor/status` 路由（GET → `{ ok, value: { sessions: { id: {
  reason, at } } } }`，webServer 缺席时跳过）。
- Client 半（`src/client/index.ts`）：`inject = ['slots', 'sessions', 'locale']`，注册
  `shell.overlay`，id `session-monitor`，order **90** → `SessionMonitorWidget`；再注册
  `widgets.config`，id `session-monitor`，order 0 → `SessionSettings`（配置弹窗，
  管理器缺席时自动跳过）。
- 数据来源：标准 `useSessions` 全局 prop（`SessionListState`：`ids` / `byId` /
  `current`）——**无 Host RPC、无轮询**，运行时经 `host/session-status` 帧实时推送
  `running` 状态。
- 会话列表：过滤 blank（从未开跑的 New Session）行与**子代理会话（默认过滤，
  `showSubagents` 开关可重新显示）**；运行中置顶（呼吸绿点）+ 本轮完成（黄点，
  访问后清除）+ 空闲（灰点）排序；每行显示 `displayTitle`、子代理（仅开启时）/
  当前徽标、等待输入状态、相对更新时间；主代理行带**「子×N」徽标**（聚合
  `origin==='subagent' && running && parentId` 的实时计数，N=0 不显示）。
- **时间窗口过滤**：`timeWindowMin`（默认 60，0=全部）只保留窗口内活跃过的会话；
  **运行中会话始终显示**（`updatedAt` 只反映创建/最近 prompt，不能据此隐藏正在
  工作的长任务）；"最近活跃"取 `max(updatedAt, lastActive)`——挂件在观察到会话
  开始/结束一轮时把时间戳写入 `dsh.smon.lastActive`（localStorage，25h TTL 裁剪），
  刷新后仍生效；被窗口隐藏的会话数在列表底部淡色提示（`hiddenRecent`）。过滤与
  相对时间由 30s 的 `now` tick 驱动重算（`useSessions` 快照只在列表变更时更新，
  没有 tick 则超时会话不会随时间被隐藏）。
- **完成一轮提醒**：`useEffect` 内 diff `running` true→false 边沿（一次边沿 = 一轮
  完成，goal 多轮同样适用）把完成会话放入 pending 队列；**3s 轮询** `/_dsh/
  session-monitor/status` 拿到 Host 的 `turn/end` reason 后由 `flushPending`
  生成 toast（右上堆叠，新的在最上），带「跳转」（`ctx.sessions.open(id)`，inject
  面注入）与「知道了」按钮；Host 缺席（路由 404）或 reason 超时（12s）退回基础
  kind。**toast 按状态配色**（CSS 变量 `--toast-accent` 驱动左侧色条与标题色）：
  `done`（琥珀 ✓ 正常完成）/ `interaction`（蓝 ✋ 等待输入）/ `subagent`（紫 ⇄）/
  `error`（红 ✕）/ `aborted`（灰 ■）/ `blocked`（橙 ⚠）/ `max-tokens`（橙 ⇥）/
  `interrupted`（灰 ⏸）；
  `notifyMode: 'auto'`（N 秒自动消失，默认 8s，上限 5 条丢最旧）或 `'confirm'`
  （需确认才关：同会话新一轮替换旧提醒、未确认不被新提醒挤掉，上限 12 条，超高
  滚动）；可选 WebAudio 双音提示音。**浏览器通知**（`browserNotify`，默认关）：
  `Notification` API 权限 granted 时对每轮完成发系统通知（标题按 kind 区分，
  `tag` = `dsh-smon:<id>` 同会话替换不堆叠，`onclick` 跳转会话 + focus 窗口）；
  权限在配置弹窗勾选时经 `requestPermission()` 请求，denied 时提示去站点设置。
  浏览器通知与挂件 toast 互相独立，且都受子代理/当前会话过滤。
- **点击跳转**：行点击 / toast「跳转」→ `ctx.sessions.open(id)`，应用立即切会话。
- 配置（`SessionSettings`，读写 `localStorage` `dsh.smon.settings`，改后经 window
  CustomEvent 通知挂件即时生效）：提醒开关、关闭方式、自动消失秒数、提示音、
  **浏览器通知（含权限状态：已授权 / 被拒 / 待授权）**、提醒当前会话开关、
  显示子代理开关（默认关）、只显示运行中、**时间范围**（全部 / 15m / 30m / 1h /
  3h / 6h / 24h，默认 1h）、显示完成标记；另有重置位置/重置设置。**配置依赖提示**：
  「只显示运行中」开启时时间范围不生效（运行中豁免窗口、空闲被开关藏掉）——配置
  面板此时对时间范围做视觉淡化并提示"关掉后立即生效"，值仍可预配置；列表的
  「已隐藏 N 个更早的会话」提示只统计时间窗口隐藏数，运行中模式下不显示。
- 面板位置持久化（`dsh.smon.pos`），默认右下角（right 16 / bottom 150），拖拽夹紧
  视口；缩放持久化（`dsh.smon.scale`，0.6×–1.6×，拖右下角手柄）；头部「—」收起为
  胶囊（显示运行中数量），点胶囊展开（tap 检测，拖动不误触）。
- 字典 NS `session-monitor`（zh / en），经 `LocaleNamespaceMap` 类型合并声明。
- 类型面：`SessionMonitorWidgetProps`、`SessionMonitorInject`、`SessionSettingsInjected`、
  `SessionMonitorKey`、`MonitorSettings` + `DEFAULT_SETTINGS` / `loadSettings` /
  `saveSettings`（`./client` 类型面）。
- 依赖：`@dsh-plugins/client-ui-widget-manager`（type-only，peer）；`@deepseek-ai/cordis`、
  `dsh-client-runtime`、`dsh-client-ui-layout`、`dsh-client-ui-slots`、
  `dsh-client-locale`、`dsh-session`（Host 半 `session/event` 类型，peer）、`react`（peer）。
- 构建：Host → `lib/index.js`（ESM，外部化）；Client → `lib/client.js`
  （ModuleLoader CJS + 内联 CSS，`--loader:.css=local-css`）。

---

## 4. 依赖关系

```mermaid
graph LR
  BUNDLE[@dsh-plugins/dsh-widgets-plugin]
  BALANCE[@dsh-plugins/balance]
  UI_CRIT[@dsh-plugins/client-ui-token-crit]
  UI_SMON[@dsh-plugins/client-ui-session-monitor]
  UI_MANAGER[@dsh-plugins/client-ui-widget-manager]

  BUNDLE --> BALANCE
  BUNDLE --> UI_CRIT
  BUNDLE --> UI_SMON
  BUNDLE --> UI_MANAGER
  BALANCE -. peer（type-only） .-> UI_MANAGER
  UI_SMON -. peer（type-only） .-> UI_MANAGER
```

外部 peer 依赖（Harness 生态，`@deepseek-ai/*`）：

| 依赖 | 被谁需要 |
|---|---|
| `@deepseek-ai/cordis` | 全部 4 个可运行包 |
| `@deepseek-ai/dsh-invariants` | balance（invariant 伴侣） |
| `@deepseek-ai/dsh-credentials` / `dsh-typert-protocol` | balance |
| `@deepseek-ai/dsh-settings` | balance（设置区 + Web 后端） |
| `@deepseek-ai/dsh-api-remotes` | balance（client） |
| `@deepseek-ai/dsh-client-runtime` | balance、client-ui-token-crit、client-ui-session-monitor、client-ui-widget-manager |
| `@deepseek-ai/dsh-client-ui-layout` | balance、client-ui-token-crit、client-ui-session-monitor、client-ui-widget-manager（`shell.overlay` 类型合并） |
| `@deepseek-ai/dsh-client-locale` | balance、client-ui-session-monitor、client-ui-widget-manager |
| `@deepseek-ai/dsh-session` | client-ui-session-monitor（Host 半 `session/event` 类型） |
| `@deepseek-ai/dsh-client-ui-settings` | client-ui-widget-manager（`settings.section`） |
| `@deepseek-ai/dsh-client-ui-slots` | balance、client-ui-token-crit、client-ui-session-monitor、client-ui-widget-manager |
| `react` | balance、client-ui-token-crit、client-ui-session-monitor、client-ui-widget-manager |

---

## 5. 构建产物

`pnpm build`（`node scripts/build.mjs`）用 esbuild 构建，产物全部进 `lib/`（gitignore，不提交）：

| 包 | Host 产物 | 浏览器产物 | 包装方式 |
|---|---|---|---|
| `@dsh-plugins/balance` | `lib/index.js`（ESM，外部化） | `lib/client.js` | ModuleLoader CJS + 内联 CSS（`--loader:.css=local-css`）；`lib/types/**` 由 `pnpm build` 内嵌的 tsc 步骤从 src 重新生成（js + d.ts + map）；`lib/typert.*` 为 typert codegen 产物，**已提交进 git**（仓库内无法重新生成，见 AGENTS.md），`pnpm build` 不重建 |
| `@dsh-plugins/client-ui-token-crit` | `lib/index.js`（空 apply 壳） | `lib/client.js` | ModuleLoader CJS + 内联 CSS |
| `@dsh-plugins/client-ui-session-monitor` | `lib/index.js`（Host 半：`turn/end` 原因跟踪 + 状态路由） | `lib/client.js` | ModuleLoader CJS + 内联 CSS |
| `@dsh-plugins/client-ui-widget-manager` | `lib/index.js`（ESM，空 apply 壳） | `lib/client.js` | ModuleLoader CJS + 内联 CSS |
| `@dsh-plugins/dsh-widgets-plugin` | —（仅 `cordis.patch.yml`） | — | — |

外部化清单：`@deepseek-ai/*`、`@dsh-plugins/*`、`zod`、`react`、`react/*`。

> `pnpm build` 末尾会做 **exports 完整性校验**：每个 `exports` 目标文件（default + types 条件）
> 必须存在，缺失即构建失败（CI 亦如此）——防止「tarball 缺文件但 CI 绿」的静默损坏。

---

## 6. 插槽注册汇总

| 插槽 | id | order | 注册方（包） | 组件 |
|---|---|---|---|---|
| `shell.overlay` | `balance` | 100 | balance | `BalanceWidget` |
| `shell.overlay` | `token-crit` | 50 | client-ui-token-crit | `TokenCritWidget` |
| `shell.overlay` | `session-monitor` | 90 | client-ui-session-monitor | `SessionMonitorWidget` |
| `shell.overlay` | `balance` / `token-crit` / `session-monitor` | priority -1（影子） | client-ui-widget-manager | `ShadowWidget`（禁用时隐藏挂件） |
| `settings.section` | `widgets` | 10 | client-ui-widget-manager | `WidgetManagerSettings`（声明子槽 `widgets.config`） |
| `widgets.config` | `balance` | 0 | balance | `BalanceSettings`（管理页「配置」弹窗内容） |
| `widgets.config` | `session-monitor` | 0 | client-ui-session-monitor | `SessionSettings`（管理页「配置」弹窗内容） |
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
  （typert codegen，build.mjs 不重建；仓库内无生成工具，需从上游生成后提交，
  见 AGENTS.md 第 3 节）
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
| 包版本 | 0.1.0（5 包一致） |
| 语言约定 | 根文档中文；包 README 双语对 + `README.i18n.yaml` hash 凭据 |
| CI | install → build → pack → git diff 干净（ci.yml）；`v*` tag 发布（publish.yml） |

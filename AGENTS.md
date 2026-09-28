# AGENTS.md

面向 AI 编码代理（Claude Code / Codex / Cursor 等）与人类协作者的仓库指南。
请先读本文件，再动手修改。

## 项目是什么

`dsh-widgets-plugin` 是一个 **DeepSeek Harness 小组件（widgets）monorepo**：
制作可独立发布、可安装到任意 Harness 实例的插件。浏览器端以 `shell.overlay`
浮动挂件或 Web 设置页呈现。当前五个小组件 + 两个支撑包：

| 小组件 | 包 |
|---|---|
| 余额看板 | `@dsh-plugins/balance` |
| Token 暴击挂件 | `@dsh-plugins/client-ui-token-crit` |
| 会话监控看板 | `@dsh-plugins/client-ui-session-monitor` |
| 卡片容器 | `@dsh-plugins/client-ui-card-container` |
| 彩虹流光 | `@dsh-plugins/client-ui-rainbow-flow` |

支撑包：`@dsh-plugins/client-ui-widget-manager`（小组件管理设置页）、
`@dsh-plugins/dsh-widgets-plugin`（可安装 bundle，一层挂载全部插件）。

## 各包主要功能

| 包 | 角色 | 主要功能（插槽 / 关键行为） |
|---|---|---|
| `@dsh-plugins/balance` | **单包单插件**（Host 缝隙 + 厂商 + Web 看板） | Host：`BalanceRuntime` 自注册 `ctx.balance`，应答 `balance/query` / `balance/list` Remote；5 个厂商 Provider + 设置驱动用户绑定 + `/_dsh/balance/settings` Web 路由。客户端：`await ctx.remote.$mount(TYPERT_REMOTE)` 后注册 `shell.overlay` 看板挂件（id `balance`，order 100）+ `widgets.config` 供应商配置面板 |
| `@dsh-plugins/client-ui-token-crit` | 纯 UI（浏览器端） | `shell.overlay` 挂件（id `token-crit`，order 50）+ `widgets.card` token 用量统计卡；数据走标准 `useSessions` 的 `tokenUsage` 投影（无 Host RPC、无轮询） |
| `@dsh-plugins/client-ui-session-monitor` | **双半插件行** | Host：9 条 `/_dsh/session-monitor/*` 路由（`turn/end` 结束原因、执行中工具 `tools`、累计轮次 `rounds`、桌面快照 `buildDesktopSnapshot`、共享设置、`/jump` 跳转队列 + `/jump/poll` 长轮询、inbox 通知存储、独立挂件页 HTML）。客户端：`shell.overlay`（order 90）+ `widgets.config`，用 `useSessions` 投影列表 + `running` 边沿检测「完成一轮」提醒 + 点击跳转会话 |
| `@dsh-plugins/client-ui-card-container` | 纯 UI（浏览器端） | `shell.overlay`（id `card-container`，order 20）+ `widgets.config` 配置面板；声明 `widgets.card` 子槽把其他挂件停靠进卡片网格（影子条目隐藏浮窗），**不注册任何内置卡片** |
| `@dsh-plugins/client-ui-rainbow-flow` | 纯 UI（浏览器端） | `conversation.input.left`（`rainbow-flow-glow` 呼吸光晕 order 99 + `rainbow-flow-toggle` 开关 order 100）、`conversation.input.right`（`rainbow-flow-send` 按钮美化 order 150）、`widgets.config` 配置面板；另用 `MutationObserver` 给会话命令卡按类别上色（`toolAccent`） |
| `@dsh-plugins/client-ui-widget-manager` | 设置页（纯 UI） | `settings.section`（id `widgets`，order 10）列出小组件、支持添加/关闭；声明 `widgets.config` 子槽，为带配置的挂件提供「配置」弹窗 |
| `@dsh-plugins/dsh-widgets-plugin` | bundle | `cordis.patch.yml` 一次插入 6 个插件行（balance / ui-token-crit / ui-session-monitor / ui-card-container / ui-rainbow-flow / ui-widget-manager） |

> 完整组件登记册（组件明细、插槽注册、构建产物、依赖关系、维护清单）见
> [COMPONENTS.md](COMPONENTS.md)。开发新小组件并接入管理面板（含配置弹窗）见
> [WIDGET-DEVELOPMENT.md](WIDGET-DEVELOPMENT.md)。

## 工作区结构

```
packages/
  dsh-balance/                合并后的余额插件（单插件行）：Host 缝隙（ctx.balance +
                             balance/query、balance/list Remote）+ 厂商 Provider +
                             设置/Web 路由 + 浏览器看板挂件 + 供应商配置面板
  dsh-client-ui-token-crit/   Token 暴击挂件（纯 UI，浏览器端）
  dsh-client-ui-session-monitor/ 会话监控看板（双半：Host 半 turn/end 原因 + 9 条
                             路由；浏览器端 useSessions 投影列表、running 边沿
                             检测「完成一轮」提醒、点击跳转会话）
  dsh-client-ui-card-container/ 卡片容器（纯 UI，浏览器端：声明 widgets.card 子槽、
                             停靠影子条目隐藏浮窗，挂件自己注册紧凑卡片）
  dsh-client-ui-rainbow-flow/ 彩虹流光（纯 UI，浏览器端：conversation.input.left
                             + .right + widgets.config，呼吸光晕随 token 速率）
  dsh-client-ui-widget-manager/ 小组件管理设置页（声明 widgets.config 子槽）
bundles/
  dsh-widgets-plugin/        可安装 bundle：cordis.patch.yml 插入 6 个插件
scripts/
  build.mjs                   用 esbuild 构建 Host 产物、用 Vite library mode 构建
                             浏览器 client bundle（官方 deepseek-harness 同款工具链）
                             + tsc 重生成 balance 类型面，全部进各包 lib/
.github/workflows/             ci.yml（PR/推送校验）+ publish.yml（v* tag 发布 npm）
```

每个包的 `package.json` 有 `exports`（`./client` 指浏览器 bundle）、`dsh.client`
声明（`inject` + `platform: "web"`）、`files: ["lib"]`、`repository`（指向本仓库 +
`directory` 子路径，发布元数据用）。

## 常用命令

```sh
pnpm install                 # 安装（workspace 依赖用 workspace:*）
pnpm build                   # 构建全部包产物到 lib/（node scripts/build.mjs）
pnpm typecheck               # 类型检查（tsc --noEmit，根 tsconfig.json，CI 也会跑）
pnpm -r pack                 # 打包校验（可加 --dry-run）
pnpm run publish:all         # pnpm -r publish --no-git-checks
```

pnpm 版本由 root `package.json` 的 `packageManager` 固定（当前 `pnpm@11.7.0`），
`pnpm/action-setup` 会按它装对应版本，无需手工升级。Node 引擎约束见 root `engines`
（`^22.19.0 || >=24.0.0`）。没有测试套件：CI 的校验是「install → typecheck → build →
pack → git diff 干净」。

类型检查要点：esbuild 只转译不查类型（运行时时序/引用顺序问题它拦不住），改
`src/**` 后本地先跑 `pnpm typecheck` 再提交；`keyof` 用在字符串字面量联合上得到
的是 `keyof string` 而不是联合成员（widget-manager 曾踩过这个坑）。

## 关键约定（改代码前必读）

### 1. 语言与文档

- 仓库面向中文用户，根 README 用中文。
- **COMPONENTS.md** 是组件登记册：新增/修改组件必须同步更新其中的总览、插槽注册
  与构建产物表，发布前按该文档第 7 节过一遍维护清单。
- 每个包的 README 是**双语对**：`README.md`（英文）+ `README.zh.md`（中文），头部
  互相链接；双语对必须**内容同步**（改一侧必须同步另一侧）。
- 每个双语对配 `README.i18n.yaml`，记录两侧的 **git blob hash**（一致性凭据）。
  改完 README 后重新计算并更新：
  ```sh
  git hash-object packages/<pkg>/README.md
  git hash-object packages/<pkg>/README.zh.md
  ```

### 2. 作用域与版本

- 所有可发布包用 `@dsh-plugins/*` 作用域（改写自 harness 的 `@deepseek-ai/*`）。
- 包间依赖用 `workspace:*`（**禁止** `link:`——发布时不会改写，会产出坏链接）。
- 所有包带 `"publishConfig": { "access": "public" }`（scoped 包默认 private）。
- 版本号各包保持一致（当前 0.1.0），升级时同步升。

### 3. 构建产物与 git

- `lib/`、`node_modules/`、`.pnpm-store/`、`*.tgz` 都 gitignore，**不提交**。
- 改 `src/**` 后运行 `pnpm build` 让 `lib/` 跟上（CI 会跑 build 并断言 git 干净）。
- 行尾由 `.gitattributes` 规范（文本 LF，ps1 CRLF）。
- **`@dsh-plugins/balance` 的 `lib/types/**`** 由 `pnpm build` 内嵌 tsc 从 src 重生成，
  与源码永远一致。
- **`@dsh-plugins/balance` 的 `lib/typert.*`** 是 typert codegen 产物，`pnpm build`
  不重建；这 4+1 个文件已 `git add -f` 提交进 git。0.1.7 迁移时已按
  `@deepseek-ai/dsh-typert-generator` 的新 codec 形状（`create()` 惰性工厂）机械改写，
  文件头留了 NOTE。**改 Remote 线协议时应改用该生成器重新生成**，而不是继续手工编辑
  （生成器已发布到 npm，接入需要 `tsconfig.host.json` / `tsconfig.client.json` 两个 face
  聚合配置，见「关键现状与坑」）。
- `pnpm build` 末尾做 **exports 完整性校验**：每个 `exports` 目标文件必须存在，
  缺失即构建失败——防「tarball 缺文件但 CI 绿」的静默损坏。

### 4. 新增小组件

按 token-crit 的模板复制最小结构（完整开发指南见 `WIDGET-DEVELOPMENT.md`）：

- `src/index.ts`：Host 空 apply（纯 UI 插件）或 seam 逻辑。
- `src/client/index.ts`：浏览器端 `apply` + `inject`，用 `ctx.slots.inject('shell.overlay', …)`
  注册挂件（`shell.overlay` 槽的类型合并来自 `@deepseek-ai/dsh-client-ui-layout`，
  `ctx.slots` 来自 `@deepseek-ai/dsh-client-ui-renderer`——`dsh-client-runtime` 退役后
  改由它提供）。
- `package.json` 加 `dsh.client`、`exports["./client"]`、`files: ["lib"]`、
  `publishConfig.access: public`。
- 在 `scripts/build.mjs` 的 `CLIENT_PACKAGES` 加一行（Vite library mode 产出
  `lib/client.js`，照抄现有段落）。
- 若随 bundle 分发：加进 `bundles/dsh-widgets-plugin/` 依赖与 `cordis.patch.yml`。
- 补双语 README + `README.i18n.yaml`。

### 5. 余额插件是单包结构

`@dsh-plugins/balance` 是**一个包、一个插件行**：
- Host 半（`src/index.ts`）`apply()` 依次「构造 `BalanceRuntime`（自注册
  `ctx.balance`）→ 注册厂商 Provider → 按 `Config.bindings`（volatile 字段）注册用户绑定，
  并在 `loader/volatile-update` 时重注册 → 挂 `/_dsh/balance/settings` Web 路由」。
  用户绑定不再是单独的 settings 分区：**插件自己的 `Config` 条目就是设置命名空间**
  （见「0.1.5 → 0.1.7 的 API 迁移」）。
- 浏览器半（`src/client/index.ts`）先 `await ctx.remote.$mount(TYPERT_REMOTE)` 再注册
  看板挂件与 `widgets.config`。`remote.balance` **不进 inject 列表**——cordis 声明式
  inject 沿 fiber 父链解析，`$mount` 的贡献在旁支 fiber，声明会卡死插件；挂载后经
  `ctx.get('remote.balance')` 按 store 直读。
- 已**废弃对 deepseek-harness 的同步**（`sync.mjs` 已删）：余额源码手工维护。
- 包内跨模块一律相对 import；`@dsh-plugins/balance/types` 等子路径保留给外部类型消费者。
- 小组件管理页目录（`dsh-client-ui-widget-manager/src/client/widgets.ts`）把余额看板
  `packageName` 标为 `@dsh-plugins/balance`——新增/重命名包时同步更新。

### 6. 包管理（与官方 deepseek-harness 架构对齐）

镜像官方仓库（deepseek-ai/deepseek-harness）的做法：

- root `package.json`：`packageManager` 固定 pnpm 版本（`pnpm@11.7.0`）、
  `engines.node`、`workspaces`（`packages/*` + `bundles/*`，与 `pnpm-workspace.yaml`
  一致）。
- `pnpm-workspace.yaml`：`linkWorkspacePackages: true`、`peerDependencyRules.allowedVersions`
  （typescript `>=5 <7`）、`allowBuilds`（pnpm 10.26+ 同款键，默认拒绝、只放行必要
  构建脚本）、`patchedDependencies` + `patches/`。`minimumReleaseAgeExclude` 由
  `pnpm install` 自动写入（预发布依赖白名单，见「关键现状」）。
- 每个可发布包带 `repository`（`git+https://github.com/zhangsaizz/dsh-widgets-plugin.git`
  + `directory` 子路径）。
- 版本号全仓同步（当前 0.1.0，非 rc 预发布风格）。

## 发布流程

1. 本地 `pnpm build` → `pnpm -r pack`（检查 tarball 内容）。
2. 提交代码，推送并打 tag `v*`（如 `v0.1.0`）。
3. GitHub Actions `publish.yml` 自动 `pnpm -r publish --access public`，
   需仓库配置 `NPM_TOKEN` secret。

## 关键现状与坑

- **官方 API 基线**：`@deepseek-ai/*` 依赖为 `^0.1.7-rc.2`（npm `latest` / `next`
  dist-tag 的当前指向；root devDeps `dsh-host-webserver` / `dsh-settings` 为精确
  `0.1.7-rc.2`，`@deepseek-ai/schemastery` 为 `^3.18.4`，`@deepseek-ai/cordis` 为
  `^4.0.4`）。改依赖时注意：pnpm 11.7 的 `autoInstallPeers` 对预发布 peer 会推导出非预发布
  范围 `>=0.1.7 <0.2.0-0`，导致 `ERR_PNPM_NO_MATCHING_VERSION`（如 `dsh-sandbox`）。
  **修复不是加 overrides**，而是让 `pnpm install` 把 fresh rc 版本自动写回
  `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（0.1.5 → 0.1.7 升级时该列表已整体
  改成 `0.1.7-rc.2`）。（`alpha` dist-tag 另有更高的 `0.1.7-alpha.*` 预发布，未采纳：
  种子模块表与 API 面可能变动，见下一条。）
  **升版只改 specifier 会留下「半新」依赖图**：`pnpm install` 会复用 lockfile 里仍满足
  新范围的旧解析，于是直接依赖跳到新 rc、而 `autoInstallPeers` 补进来的传递依赖
  （`dsh-agent` / `dsh-tools` / `dsh-fs` / `dsh-scope` …）留在旧 rc，新 rc 那批 peer 要求
  `^0.1.7-rc.2` 就全部落空（`pnpm peers check` 会列一长串 unmet peer）。修法是删掉
  `pnpm-lock.yaml` 与 `node_modules/` 重新解析一次（store 已预热时只要几秒），之后
  `pnpm peers check` 应是 `No peer dependency issues found`。`@deepseek-ai/cordis` 也必须
  跟着抬到 `^4.0.4`——0.1.7-rc.2 的包 peer 全部要求 `~4.0.4`。
- **`dsh-client-runtime` 已退役**：`@deepseek-ai/dsh-client-runtime` 最后发布的版本是
  `0.1.1-rc.2`，`0.1.5-rc.1` 起不再存在、也不再是浏览器模块；它原来的能力面已拆分——
  `ctx.slots`（SlotRegistry）的 Context 合并改由 `@deepseek-ai/dsh-client-ui-renderer`
  提供，`defineStore` / `createSnapshotStore` 等 store API 在
  `@deepseek-ai/dsh-client-store`，`ISessions` / `SessionListState` / `SessionSummary`
  在 `@deepseek-ai/dsh-api-session-controller/client`，`SessionId` 在
  `@deepseek-ai/dsh-session/types`，客户端 `ClientContext` 直接用
  `@deepseek-ai/cordis` 的 `Context`（`import type { Context as ClientContext }`）。
  客户端 `dsh.client.inject` 列表因此不再出现 `dsh-client-runtime`，改为引用上述承接
  包（消费会话数据的包另注入 `dsh-client-ui-session` / `dsh-api-session-controller`，
  彩虹流光另注入 `dsh-client-ui-chat`）。
- **0.1.5 → 0.1.7 的 API 迁移**（本仓库已完成的改造，改这些面时按新写法）：
  - **设置模型换了主人**。0.1.5 的 `ctx.settings` 是 `SettingsProvider`，插件用
    `settings.register(ns, schema)` 注册自己的分区；0.1.7 换成 `SettingsForms`，**每个
    settings 命名空间就是一条 profile 插件条目的 `Config`**，`register` 被删除。写法：
    Config 里把可编辑字段标 `.volatile()`（整段可编辑就 `.default({}).volatile()`，因为
    volatile 字段解析成 `Volatile` 引用、`.get()` 才拿值），配置面用
    `settings.describe()` / `update()` / `replace()` / `mutate()` 读写，Loader 把提交**原地**
    写进运行中的 fiber（不重挂载）并发出 `loader/volatile-update`，插件在 `ctx.on('loader/volatile-update', …)`
    里重读 `.get()` 重做注册（`dsh-llm-deepseek` 同款写法）。**命名空间是 profile 条目
    的「原始 id」`entry.options.id`，不是被父级前缀化的 `Entry.id`**（本仓库 bundle 挂载
    后 `Entry.id` 是 `@dsh-plugins/dsh-widgets-plugin/balance`，而命名空间仍是 `balance`）。
    写 volatile 分区要用 `update`（merge）而不是 `replace`（后者会把别的 volatile 字段
    重置回 base）。另：`Config` 的推导类型在声明生成时会指向 cosmokit 内部（TS2742），
    所以各包**手写 `Config` 接口**（`import type { Volatile } from '@deepseek-ai/cordis'`）
    并把 `@deepseek-ai/cosmokit` 声明成依赖，让 tsc 能用具名引用。
  - **会话「当前选中」不再是 `SessionListState.current`**：选择权离开 Controller，改为读
    列表行的 `mainView` 引用计数——
    `Object.values(state.byId).find((row) => (row.retainedBy.mainView ?? 0) > 0)?.id`
    （各包本地 `session-selection.ts` 的 `currentSessionId()`；语义同 harness 自己的
    DocumentTitle / workspace `mainSessionId`）。
  - **跳转会话 `ctx.sessions.open(id)` 已删除**，改为 Workspace UI 服务的
    `ctx.uiWorkspace.openSession(target)`（`@deepseek-ai/dsh-client-ui-workspace/client`，
    需进 peer 依赖与 `dsh.client.inject`）。
  - **每会话后台任务 `SessionListState.jobsBySession` 已删除**，改为 `ctx.jobs`
    （`@deepseek-ai/dsh-api-job-controller/client`）：`ctx.jobs.state` 是只含「有观察者」
    会话的 roster 可观察源，`ctx.jobs.watchRows(id)` 按会话引用计数开一条 `job.list`
    流（返回释放函数）。本仓库在 `session-monitor/src/client/jobs-bridge.ts` 里封装成
    `useWatchedJobRows(select)` + 纯策略 `jobWatchTargets()`：**只观察 running、已持有
    在跑任务、以及当前会话**——0.1.5 的全局镜像是 O(1)，而 0.1.7 每个会话一条流，全列表
    观察会为每个会话常驻一条流。用 `ctx.inject(['jobs'], …)` 安装（`dsh.client.inject`
    只排预取、不保证 apply 顺序）。
  - **`useSessionPendingInteraction` 已删除**，统一为 `useSessionStatus`：一张
    `Map<SessionId, { running, pendingInteraction, completionUnread }>`。等待用户的提醒
    从 `status.pendingInteraction?.kind` 取（`session-monitor` 两处已改）。
  - **primitives 图标改名**：`IconXxxOutline14/16`、`IconSparkle16` → 统一
    `IconXxxOutlineRegular` / `IconSparkleRegular`（旧后缀只是默认尺寸，新版把尺寸交给
    `size` prop、`Regular`/`Medium` 是描边粗细）。
  - **typert 线协议 codec 改形状**：0.1.5 生成物是 `{ mode:'strict', typeSymbol, schema }`，
    0.1.7 要求 `{ mode:'strict', typeSymbol, create: () => <zod schema> }`（惰性工厂），
    `dsh-typert-registry` 会以 `strict codec has no create() factory` 直接拒绝旧形状。
    `packages/dsh-balance/lib/typert.host.js` / `typert.remote-client.js` 已按
    `@deepseek-ai/dsh-typert-generator@0.1.7-rc.2` 的输出形状机械改写（文件头有 NOTE），
    **改 Remote 线协议时应改用该生成器重生成**（它已在 npm 上发布，接入需要
    `tsconfig.host.json` / `tsconfig.client.json` 两个 face 聚合配置）。
  - 0.1.7 的种子模块表与 0.1.5 相同（仍是 `react` / `react/jsx-runtime` / `react-dom` /
    `react-dom/client` / `@deepseek-ai/cordis` / `dsh-client-store` /
    `dsh-client-ui-slots` / `dsh-client-ui-primitives` / `dsh-client-ui-dockkit`）；
    6 个客户端 bundle 的 `require()` 实测仍全部落在这张表内，ModuleLoader 的
    `window.__ModuleLoader__.load({ id, factory })` 装载契约也未变。
- **本机 dsh 必须 ≥ 0.1.7**：浏览器端 bundle 的 `require()` 只认两种来源——壳的**种子
  模块表**（staticModules，写在 `dsh-web-frontend` 里）和引导图里的插件行。0.1.7 的种子表是
  `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `@deepseek-ai/cordis`
  / `@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-slots`
  / `@deepseek-ai/dsh-client-ui-primitives` / `@deepseek-ai/dsh-client-ui-dockkit`；
  0.1.1 的种子表**没有 `dsh-client-store`**，于是 balance 客户端 bundle 的第一行
  `require("@deepseek-ai/dsh-client-store")` 直接抛
  `client-modules: require(...) missed the module table`（GUI 卡片显示
  「Failed to load plugins / failed to import loader entry … (@dsh-plugins/balance)」）。
  6 个 bundle 运行时的外部 require 只有 `react` / `react/jsx-runtime` /
  `dsh-client-store` / `dsh-client-ui-slots` / `dsh-client-ui-primitives`，全部在上述种子表
  内，所以**无需** `dsh.client.external` 声明。升级方式：`npm install -g
  @deepseek-ai/dsh@0.1.7-rc.2`（该前缀通常在 `C:\Program Files\nodejs\node_global`，
  需管理员 shell），或免管理员用 `npx -y @deepseek-ai/dsh@0.1.7-rc.2 web --port 8080`。
  自检：`dsh --version` ≥ 0.1.7；`dsh <profile> --dump-config` 里应能看到 6 条
  `@dsh-plugins/*` 行；浏览器 `GET /plugins/@dsh-plugins/balance/client.js` 应返回 200
  而不是 404（0.1.7 的聚合形式是 `plugins/??<pkg>/client.js&rev=…`）。
  注意 0.1.5 把 `healProfilesModuleFallback` 从 `prepareProfile` 移进了同步不执行的
  `composeProfile`（`--dump-config` 不会 heal），所以 `$DSH_HOME/profiles/node_modules`
  的链接只有在真正 `dsh web` 启动时才重指到启动它的那份安装。
  另外 `dsh` 的 profile 名同时就是 app 名：`dsh --profile web` 与 `dsh web` 等价，**不能**
  既给位置参数又给 `--profile`（会报 "select a profile only once"）；自建 profile 要用
  `dsh plugin --profile <name> add …` 装包，再用 `dsh <name> --port …` 启动。
- **本地调试安装**：有两条路径。
  1. **官方 Plugins 面板**（0.1.7 起）：侧边栏 Plugins 页可安装/启停/更新插件包，并在每一条
     插件行上提供配置入口（`plugins.row.config`，key `<bundle 包名>#<行 id>`，见
     `client-ui-plugin-manager`）。它写的就是 profile 的依赖与 bundles 两层。
  2. **CLI**：`dsh plugin --profile <name> add F:/dsh-balance-plugin/bundles/dsh-widgets-plugin`
     （junction 直连仓库，不拷贝）。该命令除了写 profile 的 `dependencies`，还会按「安装状态」
     把 bundle 追加回 `dsh.profile.bundles`。**注意：依赖已存在时它会跳过 bundles 追加**
     （实测 `Already up to date` 后 bundles 列表不变），此时必须手工把
     `@dsh-plugins/dsh-widgets-plugin` 加进 `dsh.profile.bundles`——两者缺一都不挂载：
     profile 只有 `dsh-base` / `dsh-web-app` 时插件行根本不在 loader 里，
     `/plugins/@dsh-plugins/...` 全 404；判断依据是 `dsh <profile> --dump-config` 里没有
     `# == @dsh-plugins/dsh-widgets-plugin` 这一段。
  3. **bundle 栈改动需要重启**：新增/删除 bundle 层属于启动时组合，`patchReload: live` 只热
     加载 `cordis.patch.yml`（patch 里对不存在行的配置会被忽略，不会报错）。加完 bundle 先
     `dsh <profile> --dump-config` 确认组合，再重启 `dsh web`；重启后 `/api/*` 需 401（栅栏）而
     `/_dsh/*` 未知路径 404，可用 `/_dsh/session-monitor/status` 是否 200 判断宿主半是否挂上。
  4. **浏览器半改动会自动热替换**（0.1.7 起）：`dsh-client-hmr` 对**每一行**（不限官方包）
   做 ≤500ms 的 stat 轮询，`pnpm build` 重写 `lib/client.js` 后正在运行的 `dsh web` 会推
   `rebuilt` 帧，浏览器自动替换该插件——**不必手动刷新页面**（代价是插件内 React 状态丢失：
   展开态、拖拽位置、当前分组回到默认；失败不回滚，插件列表可重试）。**Host 半改动仍需
   重启 `dsh web`**（`dsh-hmr` 默认 `root: []`，且 `ignored` 含 `**/node_modules`，junction
   安装的插件源码不在监听范围内）。
- **会话监控桌面壳**：`desktop/dsh-session-desktop/` 是 **Tauri 2（Rust）应用，不是
  npm 发布包、不在 pnpm workspace 内**（仅用 npm 装 `@tauri-apps/cli`）。桌面
  （WebView2）与网页（浏览器）不共享 localStorage/BroadcastChannel，所以配置与跳转都
  走 Host 服务端中转（`/_dsh/session-monitor/settings` + `/jump`）。

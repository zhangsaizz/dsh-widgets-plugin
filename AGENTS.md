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
| `@dsh-plugins/client-ui-session-monitor` | **双半插件行** | Host：9 条 `/_dsh/session-monitor/*` 路由（`turn/end` 结束原因、执行中工具 `tools`、累计轮次 `rounds`、桌面快照 `buildDesktopSnapshot`（含行级 `archived`、读取时隐去归档会话的 inbox 记录）、共享设置、`/jump` 跳转队列 + `/jump/poll` 长轮询、inbox 通知存储、独立挂件页 HTML）。客户端：`shell.overlay`（order 90）+ `widgets.config`，用 `useSessions` 投影列表（过滤已归档会话，经 `ctx.workspaces` 桥接）+ `running` 边沿检测「完成一轮」提醒 + 点击跳转会话 |
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
desktop/
  dsh-session-desktop/       自建 Tauri 2 会话悬浮窗（可选，不属于官方桌面端，
                             不在 pnpm workspace 内；见「DSH 桌面端（Electron）」）
bundles/
  dsh-widgets-plugin/        可安装 bundle：cordis.patch.yml 插入 6 个插件
scripts/
  build.mjs                   用 esbuild 构建 Host 产物、用 Vite library mode 构建
                             浏览器 client bundle（官方 deepseek-harness 同款工具链）
                             + tsc 重生成 balance 类型面，全部进各包 lib/
  install-profile.mjs         一键把 bundle + 6 个插件包 link: 装进某个 profile
                             （`pnpm install:profile <profile>`；参数写成路径时直接报错，
                             防「装成仓库根」）
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
pnpm install:profile web     # 一键装进 profile（bundle + 6 个插件包，scripts/install-profile.mjs）
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

**前置：发布账号必须拥有 `@dsh-plugins` scope**。该 scope 下的 7 个包都还没发布（`npm view`
404），但名字是否已被他人占用无法只读确认——发布前先确认可用：名字空着时，登录同名账号，
或在 npm 建同名 org（公开包免费，把发布账号加进去）；**若已被他人占用就只能换 scope**，那要
同步改 7 个包名、`cordis.patch.yml`、widget-manager 的目录名与全部文档。scope 不属于发布账号
时 `publish` 会 403（npm 的既定行为，本机无凭据未实测）。另外 **7 个包必须一起发**（bundle 的
依赖是精确版本 `0.1.0`，只发 bundle 安装端 404）。

1. 本地 `pnpm build` → `pnpm -r pack`（检查 tarball 内容）。
2. 提交代码，推送并打 tag `v*`（如 `v0.1.0`）。
3. GitHub Actions `publish.yml` 自动 `pnpm -r publish --access public`，
   需仓库配置 `NPM_TOKEN` secret（Automation token，需 publish 权限）。
4. 发布后自检：`npm view @dsh-plugins/dsh-widgets-plugin version`，再
   `dsh plugin --profile <name> add @dsh-plugins/dsh-widgets-plugin`。

## 关键现状与坑

- **官方 API 基线**：`@deepseek-ai/*` 依赖为 `^0.2.0-rc.2`（npm **`next`** dist-tag 的当前
  指向；root devDeps `dsh-host-webserver` / `dsh-settings` 为精确 `0.2.0-rc.2`，
  `@deepseek-ai/schemastery` 为 `^3.18.4`，`@deepseek-ai/cordis` 为 `^4.0.4`，
  `@deepseek-ai/cordis-plugin-loader` 为 `^1.0.5`）。**不要用 `latest`**：库包的 `latest`
  长期停在 `0.0.1-rc.1` 一类陈旧版本，`latest` 只有主包 `@deepseek-ai/dsh` 是对的；
  逐个 `npm view <pkg> dist-tags` 确认，或一律精确钉 `0.2.0-rc.2`。
  改依赖时注意：pnpm 11.7 的 `autoInstallPeers` 对预发布 peer 会推导出非预发布
  范围 `>=0.2.0 <0.3.0-0`，导致 `ERR_PNPM_NO_MATCHING_VERSION`（如 `dsh-sandbox`）。
  **修复不是加 overrides**，而是让 `pnpm install` 把 fresh rc 版本自动写回
  `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（0.1.7 → 0.2.0 升级后该列表已整体
  改成 `0.2.0-rc.2`，并由 `pnpm install` 追加新进图的 17 个包）。
  **升版只改 specifier 会留下「半新」依赖图**：`pnpm install` 会复用 lockfile 里仍满足
  新范围的旧解析，于是直接依赖跳到新 rc、而 `autoInstallPeers` 补进来的传递依赖
  （`dsh-agent` / `dsh-tools` / `dsh-fs` / `dsh-scope` …）留在旧 rc，新 rc 那批 peer 要求
  `^0.2.0-rc.2` 就全部落空（`pnpm peers check` 会列一长串 unmet peer）。修法是删掉
  `pnpm-lock.yaml` 与 `node_modules/` 重新解析一次（store 已预热时只要十几秒），之后
  `pnpm peers check` 应是 `No peer dependency issues found`。`@deepseek-ai/cordis` 保持
  `^4.0.4`（0.1.7 与 0.2.0 的 vendor 树逐字节相同）。
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
- **0.1.7 → 0.2.0 的 API 迁移**（本仓库已完成的改造，**当前基线**）：
  逐包 `git diff dsh-v0.1.7-rc.2 dsh-v0.2.0-rc.2` 核对后的结论是「**Host 侧与线协议零改动**」，
  迁移主要落在依赖 specifier 与少量**客户端 DOM/插槽行为**上。
  - **Host / wire 面逐字节未变**，无需改代码：`dsh-settings`（`SettingsForms` 的
    `describe` / `update` / `replace` / `mutate` / `configure`、命名空间 = `entry.options.id`）、
    `cordis-plugin-loader`（`loader/volatile-update` 的 payload 仍是「变更路径数组」）、
    `dsh-host-webserver`（仍是 `ctx.webServer.register({kind:'exact',path,handler})`，
    handler 自持响应生命周期，无导出 helper）、`dsh-credentials`（`credentialRef`）、
    `dsh-invariants`（`InvariantInstaller`）、`dsh-session-projection`
    （`ProjectionDefinition` + `stateVersion` 必填）、
    `dsh-typert-protocol` / `-registry` / `-generator`（strict codec 仍要求
    `create: () => schema` 惰性工厂，**生成器输出形状未变**，所以
    `packages/dsh-balance/lib/typert.*` 无需重生成）。
  - **客户端壳的种子模块表未变**（0.2.0 的 `staticModules` 与 0.1.7 同一张表），
    `window.__ModuleLoader__.load({ id, factory })` 装载契约与
    `plugins/??<pkg>/client.js&rev=…` 聚合形式也未变；6 个 bundle 的外部 `require()`
    仍只有 `react` / `react/jsx-runtime` / `dsh-client-store` /
    `dsh-client-ui-slots` / `dsh-client-ui-primitives`。
  - **变了、且与本仓库相关的客户端面**（改这些面时按 0.2.0 写法）：
    - `TextShimmer` 重写：props 由 `{children: string; active: boolean}` 变为
      `{children: ReactNode; active?: boolean}`，根属性由 `data-text-shimmer` 改为
      `data-shimmer`，且 `active` 时会额外渲染一棵 `aria-hidden`/`inert` 的**装饰副本**
      （其文本节点带 `data-shimmer-text`）。彩虹流光的上色/扫字 CSS 因此按
      `[class*='_title'|'_summary'|'_leading'|'_fileLink']` 后缀选择、并用
      `background-repeat: repeat` 抵消壳自己的 `no-repeat`（见 `ToolAccent.css` 注释）。
    - 命令卡/工具行/思考行的 DOM 结构微调：`DisclosureRow` 不再接受
      `rowClassName` / `chevronClassName`（行/箭头类名收进组件内部），标题与内容被包进同一个
      `TextShimmer`；`TurnProcessNodeView` 的时长改为「标签 + `_durationNumber` 片段」。
      折叠父行仍是 `[data-chat-group-key]` 座位与 `[data-turn-process]` 整轮控制行。
    - 工作详情模式默认值由 `standard` 变成 **`detailed`**（`DEFAULT_TRANSCRIPT_VIEW_MODE`），
      web 端默认只折叠**已结束**的轮次；`compact`/`standard` 仍需展开分组才看到命令行。
    - `ui-workspace` 的 `forkSession` 返回 `Promise<SessionId>`，且行标题
      `displayTitle` 语义改为「持久标题，没有则为空」（不再回退 basename / session id）。
      本仓库的会话列表用的是 `SessionSummary.displayTitle`（Controller 侧**仍有**回退），
      所以 `|| row.id` 的写法继续有效。
    - `ui-chat` 的 locale key 有删除/改名（`duration.seconds|minutes|hours` →
      `duration.secondUnit|minuteUnit|hourUnit`、`message.turnProcess.deepDivingFor` →
      `chat.deepDivingFor`）；本仓库只用自建 NS（`balance`/`session-monitor`/
      `rainbow-flow`/`card-container`），不受影响。
    - `ui-plugin-manager` 的 `plugins.row.config` 契约与 `PluginConfigViewProps`
      逐字节未变（余额的「配置」入口照旧）；新增的只是 `refreshStatus` 等**管理器内部**
      状态字段与一个 `shell.overlay` 常驻提示位。
    - agent-loop 在失败步骤上现在会补发 `tool/result`（`TOOL_NOT_STARTED` /
      `TOOL_OUTCOME_UNKNOWN`）；会话监控的 `openTools` 折叠按 `callId` 关闭，
      `turn-end-projection` 是纯 fold（非 `turn/end` 事件原样返回），都已兼容。
      **坑：`tool/result` 的事件数据里没有 `callId`**——它带的是结果消息
      （`data.message`，call id 在 `data.message.source.callId`，镜像成
      `toolCallId`）。按 `data.callId` 取会一条都匹配不上（2026-10-09 回放本机
      155 个会话：27692 条 tool/result 0 命中），
      于是「正在执行 X」在工具返回后一直挂着、`ask_user_question`/`exit_plan_mode`
      的 inbox 记录也要等到回合结束才消解；会话监控的 `closedCallId()` 现在优先读
      结果消息（`turn/end` 分支也改成先清 in-flight、再读原因字段，清理不会被
      事件字段读取的抛错跳过）。另：`/status` 与 `/sessions` 每次读取都用 `ctx.agents`
      自愈一次——in-flight 记录只有 `tool/result` 与 `turn/end` 两个退场边，`turn/end`
      落地失败时该会话已回到 idle，记录会被当场剔除，异常结束的回合不会留下永远
      挂着的「正在执行 X」与未决 question 记录。
  - **实测验收（0.2.0-rc.2，隔离 `DSH_HOME` + 自建 profile）**：6 行全部激活，
    浏览器控制台零 error / 零 uncaught；overlay 里能查到
    `[data-widget-id="balance" | "token-crit" | "session-monitor"]`，`<html>` 上有
    彩虹流光的 `data-rf-sweep="on"`；`/_dsh/balance/settings`、
    `/_dsh/session-monitor/{status,sessions,settings,notifications,widget}` 全部 200；
    经 `/_dsh/balance/settings` POST 写 volatile `bindings` 后 revision 0→1、
    凭据被脱敏、`--dump-config` 里能看到已提交进运行 fiber 的值，陈旧 revision 被
    正确拒为 `SETTINGS_CONFLICT`。
- **本机 dsh 必须 ≥ 0.2.0-rc.2**：浏览器端 bundle 的 `require()` 只认两种来源——壳的**种子
  模块表**（staticModules，写在 `dsh-web-frontend` 里）和引导图里的插件行。0.1.7 与
  0.2.0 的种子表**是同一张**：`react` / `react/jsx-runtime` / `react-dom` /
  `react-dom/client` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-store`
  / `@deepseek-ai/dsh-client-ui-slots` / `@deepseek-ai/dsh-client-ui-primitives`
  / `@deepseek-ai/dsh-client-ui-dockkit`；
  0.1.1 的种子表**没有 `dsh-client-store`**，于是 balance 客户端 bundle 的第一行
  `require("@deepseek-ai/dsh-client-store")` 直接抛
  `client-modules: require(...) missed the module table`（GUI 卡片显示
  「Failed to load plugins / failed to import loader entry … (@dsh-plugins/balance)」）。
  6 个 bundle 运行时的外部 require 只有 `react` / `react/jsx-runtime` /
  `dsh-client-store` / `dsh-client-ui-slots` / `dsh-client-ui-primitives`，全部在上述种子表
  内，所以**无需** `dsh.client.external` 声明。升级方式：`npm install -g
  @deepseek-ai/dsh@0.2.0-rc.2`（该前缀通常在 `C:\Program Files\nodejs\node_global`，
  需管理员 shell），或免管理员用 `npx -y @deepseek-ai/dsh@0.2.0-rc.2 <profile> --port 9021`
  （**别用 7993–8606 一段的端口**：Windows 的 Hyper-V 预留段会让 `webServer` 以
  `EACCES` 启动失败，实测 8099 必失败）。
  自检：`dsh --version` ≥ 0.2.0-rc.2；`dsh <profile> --dump-config` 里应能看到 6 条
  `@dsh-plugins/*` 行；`GET /` 会先返回 401 `dsh web authentication required`，控制台会
  打印带 `?token=…` 的完整 URL（**用它再取一次**才是应用页）；取到后
  `plugins/??<pkg>/client.js&rev=…`（聚合形式 0.1.7 起未变）应返回 200 而不是 404，
  随后可用 `/_dsh/session-monitor/status` 是否 200 判断宿主半是否挂上。
  注意 0.1.5 把 `healProfilesModuleFallback` 从 `prepareProfile` 移进了同步不执行的
  `composeProfile`（`--dump-config` 不会 heal），所以 `$DSH_HOME/profiles/node_modules`
  的链接只有在真正 `dsh web` 启动时才重指到启动它的那份安装。
  另外 `dsh` 的 profile 名同时就是 app 名：`dsh --profile web` 与 `dsh web` 等价，**不能**
  既给位置参数又给 `--profile`（会报 "select a profile only once"）；自建 profile 要用
  `dsh plugin --profile <name> add …` 装包，再用 `dsh <name> --port …` 启动。
- **本地调试安装**：1–2 是安装路径，3–5 是装完后的行为约定。
  1. **官方 Plugins 面板**（0.1.7 起）：侧边栏 Plugins 页可安装/启停/更新插件包，并在每一条
     插件行上提供配置入口（`plugins.row.config`，key `<bundle 包名>#<行 id>`，见
     `client-ui-plugin-manager`）。它写的就是 profile 的依赖与 bundles 两层。
  2. **CLI**：`pnpm install:profile <name>`（`scripts/install-profile.mjs`）等价于手打 7 条
     `dsh plugin --profile <name> add <本仓库路径>`——bundle 目录 + 6 个 `packages/*` 插件包。
     **可安装的是 `bundles/dsh-widgets-plugin`，不是仓库根**：根包包名 `dsh-widgets-plugin`、
     没有 `dsh.bundle`，装它只会打印 `dsh: warning: dsh-widgets-plugin declares no dsh.bundle
     — installed as a plain dependency, not a profile layer` 并静默不挂载；脚本对「把路径当
     profile 名」的写法直接报错。（目录安装是 junction 直连仓库，不拷贝。）
     该命令除了写 profile 的 `dependencies`，还会按「安装状态」
     把 bundle 追加回 `dsh.profile.bundles`。**注意：依赖已存在时它会跳过 bundles 追加**
     （实测 `Already up to date` 后 bundles 列表不变），此时必须手工把
     `@dsh-plugins/dsh-widgets-plugin` 加进 `dsh.profile.bundles`——两者缺一都不挂载：
     profile 只有 `dsh-base` / `dsh-web-app` 时插件行根本不在 loader 里，
     `/plugins/@dsh-plugins/...` 全 404；判断依据是 `dsh <profile> --dump-config` 里没有
     `# == @dsh-plugins/dsh-widgets-plugin` 这一段。
     **tarball 不是离线交付格式**：`pnpm -r pack` 会把 bundle 的 `workspace:*` 改成精确版本
     （tgz 内实测 `"@dsh-plugins/balance": "0.1.0"`），安装端 pnpm 仍去 registry 取那 6 个包
     ——「先装 6 个 tgz 再装 bundle」「7 个 tgz 一次 add」「profile 里写
     `pnpm.overrides → file:*.tgz`」实测全部 `ERR_PNPM_FETCH_404`；给别人只能走 npm 发布。
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
  5. **`lib/` 是 gitignore 的：拉取 src 更新后要完整跑一遍 `pnpm build`，client 阶段别中断**。
   浏览器半加载的就是本地产出的 `lib/client.js`；若上次构建只写完 host `lib/index.js` +
   `lib/types` 而 client 阶段失败/中断，GUI 会停在 `Failed to load plugins` +
   `<包名>: pending (waiting for service: <服务>)`——旧 bundle 声明了当前壳已不提供的客户端
   服务（0.1.5 → 0.1.7 迁移后实测 `settingsScope`：0.1.7 的客户端壳没有这个服务，cordis
   于是把该行留在 pending）。排查：`lib/client.js` 的 mtime 早于 `src/client/index.ts`；
   修复：`pnpm build` 后刷新页面（引导期就没激活的条目不会被 `rebuilt` 帧自动重试）。
- **自建 Tauri 会话悬浮窗（可选，不属于官方桌面端）**：`desktop/dsh-session-desktop/` 是
  Tauri 2（Rust）应用，不在 pnpm workspace 内。与官方 Electron 桌面端的分工、以及
  `dsh-smon://` 深链与 `/jump` 队列只服务于该壳这一点，见「DSH 桌面端（Electron）」与
  [COMPONENTS.md](COMPONENTS.md) §3.8。

---

## DSH 桌面端（Electron）

官方桌面端是「完整 dsh Web 应用外的一层 Electron 壳」：同一份 Web 前端、同一套插件模型与
`dsh.client` 行，所以**不是另一个插件目标**——bundle 与六个插件行与 Web 完全一致，差别只在
安装位置与三条运行时事实（文档来源、传输、窗口 chrome）。

### 目标环境

- 安装目录（下称 `<桌面端安装目录>`，各机器不同，历史文档里的示例是
  `F:\DeepSeek-Harness-Desktop`）：`resources/app.asar/dsh` 内是随包发布的 dsh
  运行时与私有 Host，**自带 dsh CLI 与 pnpm**（`resources/runtime/cli/bin/dsh.cmd`、
  `resources/runtime/pnpm`），与 npm 全局安装互不影响。
- profile 固定为 `$DSH_HOME/profiles/desktop`，由 Electron 独占；默认端口 **19387**
  （Web 版 3080），可用 `webserver.config.port` patch 覆盖。
- 应用文档来源是 `dsh-app://app/`：`/`、`/index.html`、`/assets/*`、`/favicon.svg`、
  `/manifest.webmanifest` 由壳从打包前端提供，**其余路径（含 `/_dsh/*`、`/plugins/*`）转发给已认证
  的 Host**；转发时删除 `host`/`origin`/`cookie`/`sec-fetch-site` 并注入 Host cookie，
  `/plugins/*` 响应被强制 `no-store`。因此插件 Host 路由的 `Origin` 门禁看到「无 Origin」
  （同源/非浏览器）而放行，客户端半的相对路径 `fetch('/_dsh/…')` 在桌面端与网页端同样有效。
- 壳拒绝全部 `window.open`（http(s) 交给系统浏览器）、阻止跨来源导航，渲染进程没有文件系统、
  原生 IPC 或任意 pnpm 参数；窗口关闭默认隐藏到托盘而不是退出。
- **不给插件任何通知/角标/唤醒 API**：`window.dshDesktop` 只有 `browser` / `keyboard` /
  `shortcuts` / `deviceInfo` / `updates`，壳的 `flashFrame`、Dock 提醒只服务于更新授权。
  插件要在后台提醒只能用 DOM `Notification`（渲染进程权限默认放行——`setPermissionCheckHandler`
  对非 media 一律 true；是否最终显示成 Windows toast 取决于壳的 AUMID/开始菜单快捷方式，
  属壳侧行为）或 `shell.overlay` 内的前台浮层。会话监控的 `isUserAway()` 用
  `visibilityState === 'hidden' || !document.hasFocus()`，窗口隐藏到托盘时 `hasFocus()`
  为 false，后台提醒照常触发。

### 安装到 desktop profile

CLI **不能 boot** 桌面 profile（`--dump-config` 也会报
`profile "desktop" is managed exclusively by the Electron application`），但可以装包；应用内
「插件」页写的是同一份 profile。

```sh
# 应用完全退出后（先启动过一次以初始化 profile），在仓库根执行：
pnpm install:profile desktop --cli "<桌面端安装目录>/resources/runtime/cli/bin/dsh.cmd"
# 等价手打：<那份 dsh.cmd> plugin --profile desktop add <本仓库路径>/bundles/dsh-widgets-plugin
# 本机安装目录不在 F:，而是 "D:\DeepSeek Harness"，随包 CLI 即
# "D:/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd"。
```

**`link:` 安装不会安装 bundle 的依赖**。bundle 的 6 个 `@dsh-plugins/*` 依赖声明为
`workspace:*`，profile 内的 pnpm 解析不了，于是插件包只能从
`bundles/dsh-widgets-plugin/node_modules/@dsh-plugins/*`（本仓库 workspace 软链）解析到
`packages/*` 的**真实路径**——这些路径不在任何 linked root 之下，runtime resolution 的 peer
拦截不参与，插件会加载自己 `node_modules` 里的第二份 `@deepseek-ai/*`（重复实例）。修法与
Web profile 相同：**把 6 个包也逐个 `link:` 进 profile**，使每个包成为一个 linked root，
peer 由运行时提供：

```sh
for p in dsh-balance dsh-client-ui-token-crit dsh-client-ui-session-monitor \
         dsh-client-ui-card-container dsh-client-ui-rainbow-flow dsh-client-ui-widget-manager; do
  "…/dsh.cmd" plugin --profile desktop add "<本仓库路径>/packages/$p"
done
```

（`pnpm install:profile desktop --cli "…/dsh.cmd"` 已把 bundle 与这 6 条一次做完。）

从 npm 装发布版（`add @dsh-plugins/dsh-widgets-plugin`）**不需要**这一步：pnpm 把 6 个包作为
普通依赖装进 profile，它们的 `@deepseek-ai/*` peer 由运行时的 profile 解析提供（同一份实例），
仓库路径那份不会被读到。`link:` 的 6 个包会各打印一条
`dsh: warning: <name> declares no dsh.bundle — installed as a plain dependency, not a profile layer`
（预期，它们不是 bundle 层）。

bundle 栈改动属于启动时组合，**必须重启桌面端**；改完可用隔离 profile 预检——桌面端自带
运行时也能 boot 普通 profile。下面是最小配方（自建 web profile），更贴近真实组合的
「复制 desktop profile」变体见「实测验收」第 1 条，两者择一即可：

```sh
$env:DSH_HOME="$env:TEMP\dsh-preflight"; "…/dsh.cmd" widgettest --from-default-profile web --dump-config
"…/dsh.cmd" plugin --profile widgettest add <同上 7 个包>
"…/dsh.cmd" widgettest --port 19390        # 避开 7993–8606 与 19387
```

预检判据（`--dump-config` 里有 `# == @dsh-plugins/dsh-widgets-plugin` 段；启动后
`/_dsh/session-monitor/status`、`/_dsh/balance/settings` 与
`plugins/??<pkg>/client.js&rev=…` 均 200，启动日志无插件激活错误）。客户端半改动由
`dsh-client-hmr` 热替换（桌面端同样挂载该行），Host 半仍需重启。

### 桌面端专属适配（本仓库已做）

- **浮窗顶栏避让**：桌面端在文档里画自己的窗口 chrome，并在 `<html>` 上公布它占用的带
  `--dsh-frame-top-clearance`（macOS 48px = 红绿灯 + 窗口控件；Windows 40px = 标题条，同时
  是 `-webkit-app-region: drag` 的整条拖动带）。四个浮窗（balance / token-crit /
  session-monitor / card-container）各带一份 `src/client/overlay-inset.ts`，把停靠与拖动钳制
  的上边界取 `max(自身边距, 公布的带 + 20)`；Web 无此变量，行为不变。**不复用壳的
  `--dsh-frame-overlay-top`**：它全屏降到 20px，而 Windows 标题条的「应用/编辑」菜单与
  macOS 折叠侧栏的窗口控件是全屏也仍在的 `position: fixed` 元素。新增浮窗按
  `WIDGET-DEVELOPMENT.md` §2.6 照做。
- **配置面板按环境过滤**：配置弹窗与 Plugins 行的配置页只渲染**当前环境能生效**的选项。
  判定集中在每包一份的 `src/client/environment.ts`：`detectEnvironment()` 返回 `web` /
  `official-desktop` / `tauri`（官方 Electron 壳在 `dsh-app://app/` 下暴露 `window.dshDesktop`，
  自建 Tauri 壳暴露 `window.__TAURI__`；两份拷贝由 `scripts/build.mjs` 断言逐字节一致）。
  - **会话监控**：Tauri 挂件专属的三项——「桌面端会话监控」（`dsh-smon://` 拉起）、桌面 inbox 的
    「处理后自动已读」与「打开时自动全部已读」——只在 **web** 环境渲染：该挂件只与网页版部署
    （127.0.0.1:3080）通信，官方桌面端里**整段「桌面」区只留说明文案**（窗口即看板，后台提醒交给
    既有的「浏览器通知」开关）。`Notification` / WebAudio 缺失时，对应的「浏览器通知」「提示音」
    行整行省略，不留一个永远打不开的开关。
  - **小组件管理页**：安装指引按壳切换文案——Web 用 web profile + 重启 `dsh web`；官方桌面端用
    固定的 desktop profile（或应用内「插件」页安装）+ 完全退出重开。
  新增挂件按 `WIDGET-DEVELOPMENT.md` §2.7 照做。
- **会话监控跳转**：跳转仍走 `ctx.uiWorkspace.openSession`（客户端服务，桌面端可用）；
  `window.focus()` 无法把隐藏的 Electron 窗口提到前台，这是壳的限制。
- 线协议、`dsh.client` 行、seed 模块表与 Web 端完全一致，**Host/wire 面无需改动**。

### 实测验收

**已做（离线可复现，2026-09-30，桌面端 0.2.0-rc.2）**

1. **真实 bundle 栈预检**：把 `profiles/desktop` 原样复制成隔离 home 里的
   `profiles/desktoptest`（保留 `dsh-base` / `dsh-web-app` /
   `dsh-experimental-agent-team-profile` / `dsh-experimental-schedule-bundle` +
   本 bundle 五层与 7 条 `link:`），用随包 CLI 在 `$env:TEMP` 的隔离 `DSH_HOME` 启动
   （`dsh desktoptest --port 19391 --no-open`）。结果：`--dump-config` 里 6 条
   `@dsh-plugins/*` 行齐全；`/_dsh/session-monitor/{status,sessions,notifications}` 与
   `/_dsh/balance/settings` 全 200；六个 `plugins/??@dsh-plugins/*/client.js&rev=…`
   全 200（289KB/124KB/88KB/83KB/81KB/33KB）；启动日志无激活错误。
2. **Origin 门禁**：`/_dsh/session-monitor/status` 在**无 Origin**（桌面端转发后的形态，
   壳会删除该头）与 `Origin=本机 host`（网页端）下均 200，`Origin=https://evil.example.com`
   为 403——桌面端传输与既有安全门禁同时成立。
3. **顶栏避让 A/B（真实 Chromium，Playwright）**：对上面的实例注入桌面端公布的那一个
   变量 `<html style="--dsh-frame-top-clearance: 40px">`（**只注入这个变量，不要伪造
   `data-platform`/`data-windows-titlebar`**——那是壳自己的桌面判别位，伪造后
   `dsh-client-shortcuts` 之类的一等官方插件会去找不存在的 `window.dshDesktop`，客户端条目
   成批停在 pending；那次预检报的是 `web boot: 28 entries did not activate`，而当时的
   client roster 有约 75 条）：

   | 浮窗 | 网页（无该变量） | 桌面带 40px |
   |---|---|---|
   | balance 拖到左上角停靠 | top **16** | top **60** |
   | session-monitor 拖到顶边钳制 | top **6** | top **60** |
   | token-crit 拖到顶边钳制 | top **6** | top **60** |
   | card-container（无 `data-widget-id`，按「卡片容器」标题定位）拖到顶边钳制 | top **6** | top **60** |

   四种浮窗、两种模式共 8 次运行控制台均零 error / 零 pageerror；overlay 均挂载
   （`[data-widget-id]` = token-crit / session-monitor / balance，卡片容器另按标题定位）、
   彩虹流光 `data-rf-sweep="on"`。

   探针期间踩到的两个坑（复现验收时会用到）：该实例无凭据，首屏会弹**「预览版说明」→
   API Key 引导**的 `Modal`（遮罩 `aria-hidden` 但 `pointer-events: auto`），必须先点
   「稍后配置」把它关掉，否则任何浮窗都点不到；token-crit 的透明锚点覆盖整个右下角
   （`z-index: 9999`），拖动 balance 前要先把其他 `[data-widget-id]` 隐藏。
4. **真实 Electron 窗口（2026-10-05，本机运行中的应用，只读探针）**：重启后插件已加载。
   `/plugins/events` SSE 的客户端图里 6 条 `@dsh-plugins/*` 全在，六个
   `plugins/??@dsh-plugins/*/client.js` 全 200（与预检同尺寸）；
   `/_dsh/session-monitor/status` 返回本会话真实的 `tools` 折叠、`/notifications` 有 inbox
   记录、`/_dsh/balance/settings` 200；`GET /_dsh/session-monitor/jump` 的 `webAlive=true`
   持续为真——渲染进程里的客户端半确实在跑，且其相对路径 `fetch('/_dsh/…')` 经
   `dsh-app://app/` 转发到达已认证 Host。
   另记一个未定论项：`%APPDATA%\@deepseek-ai\dsh-desktop\logs` 里有两条
   `crash-*-host.log`（2026-09-30 04:32、2026-10-05 18:54），都是 `phase: running`、Host 以
   `0x40010004` 退出；两份报告的 Host stderr 尾部只有标准的 `fs.Stats` 弃用告警、渲染进程零
   error 级输出，profile 里也没有恢复流程留下的 `.bak-*`（即没走「禁用第三方 bundle」）。证据
   不支持「插件激活失败」这一解释，但成因未定论——再遇到 Host 退出请把该 log 一并提供。

**仍需人眼确认（真实 Electron 窗口，浏览器探针不能替代）**：窗口 chrome 与浮窗的实际叠放
（是否被原生窗口按钮遮挡；可在 DevTools 里跑
`[...document.querySelectorAll('[data-widget-id]')].map((el) => [el.dataset.widgetId, el.getBoundingClientRect().top])`
看四个浮窗的 top 是否 ≥ 60）、`dsh-client-hmr` 对**本插件**的热替换（要 touch 一次
`lib/client.js` 才触发，会重置挂件内 React 状态），以及 Windows 上 DOM `Notification` 是否
真的渲染成系统 toast（壳侧 AUMID）。


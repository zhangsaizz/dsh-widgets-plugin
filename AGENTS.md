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
  不重建；仓库内无 codegen 工具，这 4+1 个文件已 `git add -f` 提交进 git。改 Remote
  线协议需从上游重新生成后提交，**不要手工编辑**。
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
  `ctx.balance`）→ 注册厂商与静态 bindings → 监听 `balance` 设置分区 → 挂
  `/_dsh/balance/settings` Web 路由」。
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

- **官方 API 基线**：`@deepseek-ai/*` 依赖为 `^0.1.5-rc.1`（root devDeps
  `dsh-host-webserver` / `dsh-settings` 同为 `^0.1.5-rc.1`，`@deepseek-ai/schemastery`
  为 `^3.18.2`）。改依赖时注意：pnpm 11.7 的 `autoInstallPeers` 对预发布 peer 会推导出
  非预发布范围 `>=0.1.5 <0.2.0-0`，导致 `ERR_PNPM_NO_MATCHING_VERSION`
  （如 `dsh-sandbox`）。**修复不是加 overrides**，而是让 `pnpm install` 把 fresh rc.1
  版本自动写回 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`。
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
- **本地调试安装**：`dsh plugin --profile <name> add F:/dsh-balance-plugin/bundles/
  dsh-widgets-plugin`（junction 直连仓库，不拷贝）。改代码后 `pnpm build` 更新 `lib/`；
  浏览器半改动刷新页面即生效，**Host 半改动需重启 `dsh web`**。
- **会话监控桌面壳**：`desktop/dsh-session-desktop/` 是 **Tauri 2（Rust）应用，不是
  npm 发布包、不在 pnpm workspace 内**（仅用 npm 装 `@tauri-apps/cli`）。桌面
  （WebView2）与网页（浏览器）不共享 localStorage/BroadcastChannel，所以配置与跳转都
  走 Host 服务端中转（`/_dsh/session-monitor/settings` + `/jump`）。

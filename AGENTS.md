# AGENTS.md

面向 AI 编码代理（Claude Code / Codex / Cursor 等）与人类协作者的仓库指南。
请先读本文件，再动手修改。

## 项目是什么

`dsh-widgets-plugin` 是一个 **DeepSeek Harness 小组件（widgets）monorepo**：
制作可独立发布、可安装到任意 Harness 实例的插件。浏览器端以 `shell.overlay`
浮动挂件或 Web 设置页呈现。当前五个小组件：

| 小组件 | 包 |
|---|---|
| 余额看板 | `@dsh-plugins/balance` |
| Token 暴击挂件 | `@dsh-plugins/client-ui-token-crit` |
| 会话监控看板 | `@dsh-plugins/client-ui-session-monitor` |
| 卡片容器 | `@dsh-plugins/client-ui-card-container` |
| 彩虹流光 | `@dsh-plugins/client-ui-rainbow-flow` |

其余包是支撑：`@dsh-plugins/client-ui-widget-manager`（小组件管理设置页）、
`@dsh-plugins/dsh-widgets-plugin`（可安装 bundle，一层挂载全部插件）。
余额链路已合并为**单包单插件**（`@dsh-plugins/balance` = 能力缝隙 + 厂商 Provider +
Web 看板），不再拆包。

## 工作区结构

```
packages/
  dsh-balance/                合并后的余额插件：Host 缝隙（ctx.balance + balance/query、
                             balance/list Remote）+ 厂商 Provider + 设置/Web 路由 +
                             浏览器看板挂件 + 供应商配置面板（单插件行）
  dsh-client-ui-token-crit/   Web token 暴击挂件（纯 UI，浏览器端）
  dsh-client-ui-session-monitor/ 会话监控看板（双半：Host 半 turn/end 原因 + 状态
                             路由；浏览器端 useSessions 投影列表、running 边沿
                             检测「完成一轮」提醒、点击跳转会话）
  dsh-client-ui-card-container/ 卡片容器（纯 UI，浏览器端：声明 widgets.card 子槽、
                             停靠影子条目隐藏浮窗、自带紧凑卡片视图）
  dsh-client-ui-rainbow-flow/ 彩虹流光（纯 UI，浏览器端：conversation.input.left
                             注册输入框彩虹流光 + 开关，速度随 token 速率）
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
`pnpm/action-setup` 会按它装对应版本，无需手工升级；本机若用 corepack 管理也会
读同一字段。Node 引擎约束见 root `engines`（`^22.19.0 || >=24.0.0`）。

没有测试套件：CI 的校验是「install → typecheck → build → pack → git diff 干净」。
类型检查要点：esbuild 只转译不查类型（如运行时时序/引用顺序问题它拦不住），
改 `src/**` 后本地先跑 `pnpm typecheck` 再提交；`keyof` 用在字符串字面量联合上
得到的是 `keyof string` 而不是联合成员（widget-manager 曾踩过这个坑）。

## 关键约定（改代码前必读）

### 1. 语言与文档

- 仓库面向中文用户，根 README 用中文。
- 仓库级「组件管理列表」见根目录 `COMPONENTS.md`：新增/修改组件时必须同步更新其中
  的总览、插槽注册与构建产物表，发布前按该文档第 7 节过一遍维护清单。
- 每个包的 README 是**双语对**：`README.md`（英文）+ `README.zh.md`（中文），
  头部互相链接（`English | [中文](README.zh.md)`）。
- 双语对必须**内容同步**：改一侧必须同步另一侧。
- 每个双语对配 `README.i18n.yaml`，记录两侧的 **git blob hash**（一致性凭据）。
  改完 README 后必须重新计算并更新：
  ```sh
  git hash-object packages/<pkg>/README.md
  git hash-object packages/<pkg>/README.zh.md
  ```
  然后把新 hash 写进对应的 `README.i18n.yaml`。

### 2. 作用域与版本

- 所有可发布包都用 `@dsh-plugins/*` 作用域（独立仓库改写自 harness 的
  `@deepseek-ai/*`）。
- 包间依赖用 `workspace:*`（**禁止** `link:` 相对路径——发布时不会改写，会产出坏链接）。
- 所有包带 `"publishConfig": { "access": "public" }`（scoped 包默认 private，会发布失败）。
- 版本号各包保持一致（当前 0.1.0），升级时同步升。

### 3. 构建产物与 git

- `lib/`、`node_modules/`、`.pnpm-store/`、`*.tgz` 都在 `.gitignore` 里，**不提交**
  （唯一例外：`@dsh-plugins/balance` 的 `lib/typert.*`，见下）。
- 改 `src/**` 后运行 `pnpm build` 让 `lib/` 产物跟上（发布需要最新产物；
  CI 会跑 build 并断言 git 干净，所以不要把产物差异提交进仓库）。
- 行尾由 `.gitattributes` 规范（文本 LF，ps1 CRLF）。
- **`@dsh-plugins/balance` 的 `lib/types/**` 由 `pnpm build` 内嵌的 tsc 步骤从 src
  重新生成**（`tsconfig.build.json`，js + d.ts + map，`.ts` 相对引用改写为 `.js`），
  与源码永远一致，无需手工维护。
- **`@dsh-plugins/balance` 的 `lib/typert.*` 是 typert codegen 产物**，`pnpm build`
  不重建（build.mjs 顶部有注释）；**仓库内没有 codegen 工具，无法重新生成，因此这
  4+1 个文件已用 `git add -f` 提交进 git**（.gitignore 有对应豁免段）。改 Remote 线
  协议时需要从上游/typert codegen 重新生成后提交，不要手工编辑。
- `pnpm build` 末尾会做 **exports 完整性校验**：每个 `exports` 目标文件必须存在，
  缺失即构建失败——防止「tarball 缺文件但 CI 绿」的静默损坏（曾因此踩坑）。

### 4. 新增小组件

按 token-crit 的模板复制最小结构（完整开发指南与面板管理接入见
`WIDGET-DEVELOPMENT.md`）：

- `src/index.ts`：Host 空 apply（纯 UI 插件）或 seam 逻辑。
- `src/client/index.ts`：浏览器端 `apply` + `inject`，用 `ctx.slots.inject('shell.overlay', ...)`
  注册挂件（需要 `@deepseek-ai/dsh-client-ui-layout` 的类型合并）。
- `package.json` 加 `dsh.client`（inject 依赖 + `platform: "web"`）、`exports["./client"]`、
  `files: ["lib"]`、`publishConfig.access: public`。
- 在 `scripts/build.mjs` 加一段 client bundle 构建（Vite lib mode 产出 CJS +
  提取 CSS，再包 ModuleLoader 包装 + 内联 CSS 注入，照抄现有段落）。
- 若随 bundle 分发，加进 `bundles/dsh-widgets-plugin/` 的依赖与 `cordis.patch.yml`。
- 补双语 README + `README.i18n.yaml`。

### 5. 余额插件是单包结构

- `@dsh-plugins/balance` 是**一个包、一个插件行**：Host 半在 `src/index.ts` 的
  `apply()` 里依次「构造 `BalanceRuntime`（自注册 `ctx.balance`）→ 注册厂商与静态
  bindings → 监听 `balance` 设置分区 → 挂 `/_dsh/balance/settings` Web 路由」；
  浏览器半在 `src/client/index.ts` 里先 `await ctx.remote.$mount(TYPERT_REMOTE)`
  再注册看板挂件与 `widgets.config` 配置面板（`remote.balance` 由本插件自己提供，
  **不进 inject 列表**——cordis 的声明式 inject 沿 fiber 父链解析，`$mount` 的贡献在
  旁支 fiber，声明会卡死插件；挂载后经 `ctx.get('remote.balance')` 按 store 直读）。
- 已**废弃对 deepseek-harness 的同步**（sync.mjs 已删除）：上游结构已重构，余额源码
  从此手工维护。上游 3 个包若再有改动，需要人工搬移并做「三合一」适配。
- 包内跨模块一律相对 import；`@dsh-plugins/balance/types` 等子路径保留给外部类型消费者。
- 小组件管理页的目录（`dsh-client-ui-widget-manager/src/client/widgets.ts`）把余额看板
  的 `packageName` 标为 `@dsh-plugins/balance`——新增/重命名包时同步更新。

### 6. 包管理（与官方 deepseek-harness 架构对齐）

包管理配置镜像官方仓库（deepseek-ai/deepseek-harness）的做法：

- root `package.json`：`packageManager` 固定 pnpm 版本（`pnpm@11.7.0`）、
  `engines.node`（`^22.19.0 || >=24.0.0`）、`workspaces` 列出 `packages/*` 与
  `bundles/*`（与 `pnpm-workspace.yaml` 的 `packages` 保持一致）。
- `pnpm-workspace.yaml`：`linkWorkspacePackages: true`、`overrides`（目前为空，
  保留官方 `link:vendor/...` 用法注释）、`peerDependencyRules.allowedVersions`
  （typescript `>=5 <7`）、`allowBuilds`（**pnpm 10.26+ 已支持**，官方 pnpm 11
  同款键，替代旧的 `onlyBuiltDependencies`；默认拒绝、只放行必要的构建脚本）、
  `patchedDependencies` + `patches/` 目录（当前为空占位）。
- 每个可发布包的 `package.json` 带 `repository`（`git+https://github.com/
  zhangsaizz/dsh-widgets-plugin.git` + `directory` 子路径），与官方每个包都声明
  `repository.directory` 的约定一致。
- 版本号与官方一样全仓同步（当前 0.1.0，非 rc 预发布风格——本仓库维持稳定版语义）。

## 发布流程

1. 本地 `pnpm build` → `pnpm -r pack`（检查 tarball 内容）。
2. 提交代码，推送并打 tag `v*`（如 `v0.1.0`）。
3. GitHub Actions `publish.yml` 自动 `pnpm -r publish --access public`，
   需仓库配置 `NPM_TOKEN` secret。

## 本次会话的近期改动（了解现状用）

- **跟进官方 API 至 v0.1.1-rc.2**：全部 `@deepseek-ai/*` 依赖范围升级到
  `^0.1.1-rc.2`（root devDeps `dsh-host-webserver` 精确到 `0.1.1-rc.2`），
  `pnpm-lock.yaml` 重解析到 rc.2；`pnpm typecheck` / `pnpm build` / `pnpm -r pack`
  全绿。核对过官方 rc.7→rc.2 发布包：本仓库依赖面（`dsh-client-ui-slots` /
  `dsh-client-runtime` / `dsh-api-remotes` / `dsh-settings` / `dsh-session` /
  `dsh-typert-protocol` / `dsh-host-webserver` 等）的 `lib/*.d.ts` 无破坏性变更，
  故无需改源码（typecheck/build 通过）。
  **安装陷阱**：pnpm 11.7 的 `autoInstallPeers`（lockfile `settings` 里为 true）
  自动安装 Host 侧 sandbox 兄弟包的 peer 时，对预发布 peer 范围会推导出非预发布
  `>=0.1.1 <0.2.0-0`，无法命中已发布的 `0.1.1-rc.2`，首次 `pnpm install` 报
  `ERR_PNPM_NO_MATCHING_VERSION`（对 `@deepseek-ai/dsh-sandbox` /
  `dsh-sandbox-policy`）。**修复不是加 overrides**，而是让 pnpm 的 supply-chain
  策略把这两个 fresh rc.2 版本自动写回 `pnpm-workspace.yaml` 的
  `minimumReleaseAgeExclude`（`pnpm install` 跑一次即自动补录 11 个 rc.2 白名单，
  `dsh-sandbox` / `dsh-sandbox-policy` / `dsh-client-ui-conversation` /
  `dsh-shell` 等在列）；之后 `--frozen-lockfile` 通过。`pnpm-workspace.yaml` 的
  `patchedDependencies: {}` 占位被 pnpm 重写时抹掉，已人工补回。
  upstream monorepo 结构保持 `packages/<domain>/<pkg>` 不变，npm 包名扁平不变。

- **跟进官方 API 至 v0.1.0-rc.7**：全部 `@deepseek-ai/*` 依赖范围升级到
  `^0.1.0-rc.7`（root devDeps `dsh-host-webserver` 精确到 `0.1.0-rc.7`），
  `pnpm-lock.yaml` 重解析到 rc.7；`pnpm typecheck` / `pnpm build` / `pnpm -r pack`
  全绿。核对过官方 rc.6→rc.7 发布包：本仓库依赖面（`dsh-client-ui-slots` /
  `dsh-client-runtime` / `dsh-api-remotes` / `dsh-settings` / `dsh-session` /
  `dsh-typert-protocol` / `dsh-host-webserver` 等）的 `lib/*.d.ts` 无破坏性变更
  （仅 client bundle 内 CSS 键序、dsh-tools 图片转发等无关改动），故无需改源码。
  官方 rc.7 新增的「插件注册设置卡片」（`packages/client/ui-plugin-config`）尚未
  发布到 npm（registry 404），暂无法消费，仅记录。上游 monorepo 结构已按
  `packages/<domain>/<pkg>` 重构（client / host / core / session / api / settings
  等域，见 rc.7 tag 的 `packages/` 树），npm 包名保持扁平不变。
  `pnpm-workspace.yaml` 新增 `minimumReleaseAgeExclude`（pnpm 11.7 supply-chain
  策略自动写入的 36 个 rc.7 版本白名单，保留）。
- **浏览器 bundle 改用 Vite 构建（官方同款工具链）**：`scripts/build.mjs` 的
  client bundle 段落从 esbuild 换成 **Vite library mode**（`vite` JS API，CJS
  输出 + CSS Modules 提取，再包 ModuleLoader 包装 + 内联 CSS 注入）；Host 半仍用
  esbuild。root devDeps 增加 `vite@^6.0.0`。各包 `lib/client.js` 产物结构不变
  （`@deepseek-ai/*`/`@dsh-plugins/*`/`react` 外部化经 `require` 解析、zod 内联、
  CSS 内联注入）。
- **包管理与官方 deepseek-harness 架构对齐**：root `package.json` 增加
  `packageManager`（现 `pnpm@11.7.0`）、`engines.node`、`workspaces`；
  `pnpm-workspace.yaml` 采用官方字段（`linkWorkspacePackages`、`overrides`、
  `peerDependencyRules`、`allowBuilds`、`patchedDependencies`）；新增
  `patches/` 目录；5 个可发布包补 `repository` 字段。版本维持 0.1.0。
- bundle 依赖从 `link:` 改为 `workspace:*`，junction 重新指向正确路径。
- 删除重复脚本 `build-client.mjs`；`build.mjs` 的 esbuild 改用 **JS API（buildSync）**，
  不再 shell 调用 `bin/esbuild`——非 Windows 上 esbuild 的 postinstall 会把
  `bin/esbuild` 硬链接替换成原生二进制，`node bin/esbuild` 在 Linux CI 上会直接
  SyntaxError（CI 踩过这个坑，见下方「修复 CI」条目）。
- 根 README 重写为「小组件集合」定位；各包 README 补齐双语「使用方式」。
- 已 `git init` 并完成首次提交与文档提交（身份为 GitHub <noreply@github.com>，
  仅本地仓库配置）。
- **余额三包合一**：`balance` + `balance-vendors` + `client-ui-balance` 合并为
  `@dsh-plugins/balance` 单包单插件行；删除 `scripts/sync.mjs`（废弃 harness 同步）；
  bundle 的 `cordis.patch.yml` 从 5 行减为 3 行；widget-manager 目录的余额
  `packageName` 改为 `@dsh-plugins/balance`。
- **新增会话监控看板** `@dsh-plugins/client-ui-session-monitor`（**双半插件行**：
  Host 半监听 `session/event` 的 `turn/end` 记结束原因，`/_dsh/session-monitor/status`
  路由（webServer 可选）；浏览器半 `shell.overlay` id `session-monitor` order 90 +
  `widgets.config` 配置弹窗）：
  投影标准 `useSessions` 列表，diff `running` true→false 边沿判定「完成一轮」，
  弹 toast 提醒（自动消失 / 需确认两种模式，可选音效；**toast 按状态配色**：完成 /
  待处理 / 子代理 / 出错 / 中止 / 阻塞 / token 上限 / 中断，3s 轮询取 Host reason，
  Host 缺席退回基础 kind），行点击经
  `ctx.sessions.open` 跳转会话；**子代理会话默认过滤**（`showSubagents` 开关默认
  关：列表不显示、计数与通知均不含子代理），但主代理行显示「子×N」徽标（聚合
   `origin==='subagent' && running && parentId` 的实时子代理执行数）；可收起为胶囊
   （tap 展开）、拖右下角缩放（0.6×–1.6×）；**时间范围过滤**（`timeWindowMin` 默认
   60、0=全部，运行中会话始终显示；"最近活跃"取 `max(updatedAt, lastActive)`，
   `dsh.smon.lastActive` 持久化运行边沿时间戳）；**浏览器通知**（`browserNotify`
   开关，`Notification` API，勾选时请求授权，同会话 tag 替换、onclick 跳转）；
   bundle 增至 4 个插件行，
  widget-manager 目录已登记。已本地安装到 `~/.dsh/profiles/web`（junction 直连
  仓库包，client bundle 按请求读盘，改代码 build 后刷新页面即生效；**Host 半改动
  需要重启 web 服务**）。
- **安装 bundle 更名**：`@dsh-plugins/balance-bundle`（`bundles/dsh-balance-bundle`）
  更名为 `@dsh-plugins/dsh-widgets-plugin`（`bundles/dsh-widgets-plugin`）；目录用
  `git mv` 迁移、锁文件 importer 同步改名、全部文档引用与双语 README 已更新。
- **修复 CI（Linux）构建失败**：`build.mjs` 的 Host 半构建从
  `node <esbuild/bin/esbuild>` 改为 esbuild **JS API（buildSync）**——esbuild 的
  postinstall 在非 Windows 平台会把 `bin/esbuild` 硬链接替换为原生 ELF 二进制，
  `node` 执行报 `SyntaxError: Invalid or unexpected token`（CI 的 `pnpm build`
  步骤因此失败，Windows 本机不受影响）；JS API 自行解析
  `@esbuild/<platform>` 平台包，全平台行为一致。
- **新增卡片容器** `@dsh-plugins/client-ui-card-container`（**纯 UI 插件行**，
  `shell.overlay` id `card-container` order 20 + `widgets.config` 配置弹窗）：
  声明 `widgets.card` 子槽（list，条目 id = 挂件 id）渲染停靠卡片；托盘列出当前
  启用的挂件（`entriesOfSlot` 投影 + 内置名称映射 `widgetName`），chip 拖入网格
  或点击即**停靠**——控制器向 `shell.overlay` 注册同 id、priority -2（避开
  widget-manager 的 -1）的影子条目隐藏浮窗（机制与管理页停用一致），网格
  `renderSlot('widgets.card', {}, { only, fallback })` 渲染紧凑卡片；点 × 移出
  恢复浮窗；卡片可拖拽排序；网格 gap 12px、列数自适应/2/3/4（设置持久化）；停靠
  顺序（`dsh-plugins.card-container.docked`）、位置（`.pos`）、设置（`.settings`）
  写 localStorage，配置变更经 window CustomEvent 通知；容器自身被隐藏时释放全部
  停靠影子（浮窗恢复浮动），重新启用按持久化顺序恢复。**自带内置卡片视图**
  （`widgets.card` priority 10，挂件自己的卡片 priority 0 优先）：token-crit /
  session-monitor 紧凑统计卡（数据走标准 `useSessions`）、balance 通用卡。
  **卡片接入已规范化为标准适配器契约**：导出 `WidgetCardProps`
  （= `PropsRuntime<'widgets.card'>`，全局座 useSessions/useWorkspaces，可叠加
  PropsLocale）+ **槽级注入面 `CardSlotInject`**（useContainer hook +
  dock/undock 动词），注册模式写入 WIDGET-DEVELOPMENT.md §2.5 与双语 README
  （`ctx.slots.inject('widgets.card', …)`、条目 id = shell.overlay id、priority
  默认 0、type-only peer 依赖、容器缺席自动跳过）——任何挂件可选接入，不接入
  显示占位卡；**卡片支持规格**（`WidgetCardComponent.spec` 静态属性：
  small 1 列 / medium 2 列 / large 整行，容器读获胜条目组件规格排版，内置卡
  token-crit=small、session-monitor=medium、balance=large）；**显示名 label 化**
  （托盘/卡片头优先读挂件在 shell.overlay 注册的 label thunk，balance /
  session-monitor / token-crit 均已补 label）；**浮窗快捷停靠**（浮窗头部
  「⤢」按钮 dispatch `dsh.card-container.dock` window 事件，detail=挂件 id，
  容器监听并停靠，解耦 no-op）；**管理页停靠态**（widget-manager 识别
  registrant `card-container` 的停靠影子为「已停靠」独立状态，行动作变
  「移出容器」——dispatch `dsh.card-container.undock` 事件，容器监听并恢复
  浮窗；停靠≠停用，不再显示「已停用」/「添加」；停靠态仍可配置）；**完善**：
  卡片**实时换位**（pointer 拖拽拎起 ghost 跟随 + 其余卡片实时让位，
  indexFromPointer 按网格矩形映射，拖出网格 24px 松手=移出，tap 不启动拖拽）、
  **多分组**（groups/active 持久化，旧单 docked 列表自动迁移，顶部分组标签 +
  ⋯ 管理菜单新建/重命名/删除，一个挂件一次只能停靠一个分组）、键盘可达（卡片
  Tab 聚焦，Enter/空格移出、方向键排序）、触屏 hover:none chrome 常显、空态
  引导、ghost 宽度按 spec。已登记
  widget-manager 目录；bundle 增至 5 个插件行。纯客户端改动，build 后刷新页面即生效。
- **新增会话监控桌面悬浮窗**（会话监控挂件的 Windows 桌面版）：
  - **Host 半扩展**（`@dsh-plugins/client-ui-session-monitor`）：
    - `/_dsh/session-monitor/sessions`：桌面快照 JSON 路由（`src/desktop-snapshot.ts`
      `buildDesktopSnapshot`，从 `ctx.sessions.list()` + 事件日志折叠 running /
      title / pending(approval) / subagents 等，**零新增 peer 依赖**；路由带 try/catch
      失败回 500 + 错误栈）；`ctx.inject(['webServer', 'sessions'])`（cordis 的
      inject 子上下文只暴露注入列表里的服务，不注入 `sessions` 会抛
      "cannot get property without inject"——踩过）。
    - `/_dsh/session-monitor/widget`：**自包含挂件页** `src/widget-page.html`
      （无框架无外部资源，2s 轮询 sessions + 3s 轮询 status，边沿检测「完成一轮」
      toast、置顶/隐藏/设置弹窗，`__TAURI__` 缺席退化为普通浏览器页），经
      build.mjs 的 esbuild **`text` loader** 内联进 Host bundle（`.html` loader
      只对 session-monitor 包生效；`src/css-modules.d.ts` 补了 `*.html` 声明）。
    - 三条路由（status/sessions/widget）均带宽松 CORS（`Access-Control-Allow-Origin:
      *`——桌面壳 `tauri://localhost` 启动探测页需跨源探测）。
  - **桌面壳**（`desktop/dsh-session-desktop/`，**Tauri 2，Rust 应用，不是 npm 发布
    包、不在 pnpm workspace 内**；仅用 npm 装 `@tauri-apps/cli`，本目录自带
    `package-lock.json`）：无边框/透明/置顶/无任务栏 320×560 小窗；启动先加载
    `src-tauri/assets/start.html` 重试页探测 127.0.0.1:3080 就绪后跳转挂件页；
    `withGlobalTauri` + `capabilities/default.json`（`remote.urls: ["http://127.0.0.1:*"]`）
    放行挂件页的拖拽/置顶/隐藏。**桌面与网页跨上下文（WebView2 vs 浏览器）不共享
    localStorage/BroadcastChannel**（各是独立存储分区），所以配置与跳转都走
    **Host 服务端中转**：
    - **设置共享**（`/_dsh/session-monitor/settings`，`src/desktop-settings.ts`
      注册 `session-monitor` settings 命名空间，schema 镜像客户端
      `MonitorSettings` 全 10 字段，持久化到 harness settings 文档）：桌面挂件
      直读直写；网页客户端半做镜像——本地 save（`dsh.smon.settings-changed`
      事件）debounce POST 上服，启动+5s 轮询 GET，有差异才写 localStorage +
      重发事件，网页挂件/配置面板代码零改动（仍读 localStorage）。桌面面板
      "以下选项与网页版共享"：完成提醒/通知方式/自动消失秒/提示音/只显示运行中/
      子代理/时间范围；刷新间隔是桌面独有（`dsh.smon.desktop.settings` 缓存）。
    - **点击跳转 = 服务端 jump 队列 + 浏览器回退**：点行 POST
      `/_dsh/session-monitor/jump` `{sessionId}`（单槽、30s TTL），客户端半 1s
      轮询 GET，见未消费的跳转就 `ctx.sessions.open` + `window.focus()` + POST
      `{consume:true}`——**已开着的 Harness 标签页直接切过去，不新开窗口**；桌面
      端 400ms×8 轮询，`consumed` 才罢手，否则回退 `open_in_browser` 命令
      （`opener` crate）打开浏览器，URL 带 `?dsh-open=<id>` 开机深链（客户端半
      启动时读到就重试选中该会话）。命令 ACL：**Tauri 2 自定义 app 命令在本地
      origin（`tauri://localhost`）默认放行，但从远程 origin
      （`http://127.0.0.1:3080`）调用必须过 ACL**（实测
      `Command open_in_browser not allowed by ACL`）：在 `build.rs` 用
      `tauri_build::AppManifest::new().commands(&["open_in_browser"])` 自动生成
      `allow-open-in-browser` 权限（产物写进 `src-tauri/permissions/autogenerated/`，
      已 gitignore），capability 里以**无前缀**标识符 `"allow-open-in-browser"` 引用
      （app ACL 权限不带 `key:` 前缀，带前缀会报 "Permission not found"）；**Tauri 2
      应用级没有 `Builder::on_navigation`**（那是 `plugin::Builder` 的 API，踩过坑），
      所以用命令而非导航拦截；托盘（tray-icon feature）左键/菜单唤回隐藏窗口 + 退出。
    构建：`npx tauri build --no-bundle`（cargo release + tauri-build 嵌入图标，
    首编拉取数百个 crates 10–30 分钟）；图标从 `icon-source.png` 用
    `npx tauri icon` 生成。运行前提：本机 `dsh web`（默认 127.0.0.1:3080）+ 插件
    Host 半已挂载。
- **会话监控桌面挂件重构为「待处理通知列表」**（inbox 为主视图 + 会话 Tab 副视图）：
  - **Host 权威通知存储**（`src/desktop-notifications.ts`，`NotificationStore`）：
    事件折叠为通知记录（turn/end 原因→kind、approval 审计、question/plan-review
    **host 工具调用检测**（`ask_user_question` / `exit_plan_mode` 的 `tool/call` →
    `tool/result`，纯桌面可见；网页 relay 降级为幂等备份）、子代理最后回合结束、
    P2 标题/新会话），幂等键 `(sessionId, kind, round)`、上限 200、已读/已解决 7 天
    归档、持久化到 `session-monitor-inbox` settings 分区（1s debounce + 停顿时 flush）；
    新增路由 `GET /notifications`（全量快照 + unread）、`POST /notifications/ack`
    （ids/sessionId/all）、`POST /events`（relay）。
  - **挂件页双 Tab**（`src/widget-page.html`）：「待处理」通知列表（未读徽标、
    P0/P1/P2 级别开关、处理→跳转+ackOnJump 自动已读/忽略/全部已读、已读与
    「已处理」折叠区、空态）+「会话」原列表；共享设置新增 `ackOnJump` /
    `autoAckOnOpen`（网页配置面板同步）。
  - **网页版未读徽标**：挂件头部 + 收起胶囊 5s 轮询 `/notifications` 显示未读数，
    点击跳最新未读会话；已读状态经 Host 与桌面共享。
  - **托盘未读数**（桌面壳）：挂件页每次未读变化经新命令 `set_tray_unread` 上报，
    Rust 侧更新托盘 tooltip 与菜单状态行（`build.rs` commands 列表与 capability
    同步加 `allow-set-tray-unread`）。
  - 设计稿/原型/冒烟测试在包内 `docs/`（`notification-inbox-design.md`、
    `inbox-prototype.html`、`store-smoke-test.cjs`——后者用 esbuild 打包
    `desktop-notifications.ts` 后跑 8 组断言）。
  - **修复桌面「会话」列表闪烁 / 隐藏数与网页不一致（两层根因）**：
    - 过滤语义：桌面时间窗口只豁免 `running`，子代理在跑但本身不在回合的父会话
      日志静默期被窗口藏掉、完成又冒出来；隐藏数把 blank/子代理/busy-only 全算
      进去。已对齐网页语义（busy 豁免窗口与 busy-only、隐藏数只统计窗口隐藏、
      轮询失败保留上一次列表、列表重建保留滚动位置）。
    - **冷会话探测不稳定（实测根因）**：`mergeColdSessions` 复用分支带探测 TTL，
      冷行在缓存过期到下次枚举之间（最长 ~8s）从快照消失；首次全量探测 72 个冷
      会话要读各自完整事件日志，实测路由延迟尖峰 **12s**，超过挂件页 4s fetch
      超时 → 轮询中止 → 整表清空。修复：冷行**一旦缓存永久复用**（冷会话不变化，
      重新附着后即被 attachedIds 排除并逐出缓存）；探测限预算（每枚举 ≤8 个 /
      ≤1.5s，未探测的后续周期补齐）；fetch 超时 4s → 10s。
    - **冷会话 blank 与网页对齐（隐藏数 ±1 根因）**：实测 `session.list`（网页权威
      列表，经 `/api/session.list` 直接调用）对 >1KiB 的冷工件**保守降级为
      blank:false**（上游 bounded-cold-blank-verification：缓存 blank:true 不可信、
      大工件不探测、保持可见），而桌面读全量日志正确判 blank:true——一个 3.9 天前
      从未跑过 turn 的遗留空会话使两端隐藏数差 1（网页 51 vs 桌面 50）。修复：
      `probeColdSession` 复刻网关阈值规则——缓存 blank:false 信任；否则**只有工件
      ≤1KiB（`locate()` + stat）才采信日志验证**，大工件/无路径/读取失败一律
      blank:false。mock 测试覆盖 5 种情形（大/小/缓存 false/无路径/有 turn）。

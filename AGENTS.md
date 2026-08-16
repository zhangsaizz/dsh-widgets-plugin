# AGENTS.md

面向 AI 编码代理（Claude Code / Codex / Cursor 等）与人类协作者的仓库指南。
请先读本文件，再动手修改。

## 项目是什么

`dsh-widgets-plugin` 是一个 **DeepSeek Harness 小组件（widgets）monorepo**：
制作可独立发布、可安装到任意 Harness 实例的插件。浏览器端以 `shell.overlay`
浮动挂件或 Web 设置页呈现。当前三个小组件：

| 小组件 | 包 |
|---|---|
| 余额看板 | `@dsh-plugins/balance` |
| Token 暴击挂件 | `@dsh-plugins/client-ui-token-crit` |
| 会话监控看板 | `@dsh-plugins/client-ui-session-monitor` |

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
  dsh-client-ui-widget-manager/ 小组件管理设置页（声明 widgets.config 子槽）
bundles/
  dsh-widgets-plugin/        可安装 bundle：cordis.patch.yml 插入 4 个插件
scripts/
  build.mjs                   用 esbuild 构建全部 Host + 浏览器产物到各包 lib/
.github/workflows/             ci.yml（PR/推送校验）+ publish.yml（v* tag 发布 npm）
```

每个包的 `package.json` 有 `exports`（`./client` 指浏览器 bundle）、`dsh.client`
声明（`inject` + `platform: "web"`）、`files: ["lib"]`。

## 常用命令

```sh
pnpm install                 # 安装（workspace 依赖用 workspace:*）
pnpm build                   # 构建全部包产物到 lib/（node scripts/build.mjs）
pnpm -r pack                 # 打包校验（可加 --dry-run）
pnpm run publish:all         # pnpm -r publish --no-git-checks
```

没有测试套件：CI 的校验是「install → build → pack → git diff 干净」。

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

- `lib/`、`node_modules/`、`.pnpm-store/`、`*.tgz` 都在 `.gitignore` 里，**不提交**。
- 改 `src/**` 后运行 `pnpm build` 让 `lib/` 产物跟上（发布需要最新产物；
  CI 会跑 build 并断言 git 干净，所以不要把产物差异提交进仓库）。
- 行尾由 `.gitattributes` 规范（文本 LF，ps1 CRLF）。
- **`@dsh-plugins/balance` 的 `lib/typert.*` 是 typert codegen 产物**，`pnpm build`
  不重建（build.mjs 顶部有注释）；它们随 `files: ["lib"]` 发布，改 Remote 线协议时
  需要重新生成，不要手工编辑。

### 4. 新增小组件

按 token-crit 的模板复制最小结构（完整开发指南与面板管理接入见
`WIDGET-DEVELOPMENT.md`）：

- `src/index.ts`：Host 空 apply（纯 UI 插件）或 seam 逻辑。
- `src/client/index.ts`：浏览器端 `apply` + `inject`，用 `ctx.slots.inject('shell.overlay', ...)`
  注册挂件（需要 `@deepseek-ai/dsh-client-ui-layout` 的类型合并）。
- `package.json` 加 `dsh.client`（inject 依赖 + `platform: "web"`）、`exports["./client"]`、
  `files: ["lib"]`、`publishConfig.access: public`。
- 在 `scripts/build.mjs` 加一段 client bundle 构建（ModuleLoader CJS 包装 +
  内联 CSS 注入，照抄现有段落）。
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

## 发布流程

1. 本地 `pnpm build` → `pnpm -r pack`（检查 tarball 内容）。
2. 提交代码，推送并打 tag `v*`（如 `v0.1.0`）。
3. GitHub Actions `publish.yml` 自动 `pnpm -r publish --access public`，
   需仓库配置 `NPM_TOKEN` secret。

## 本次会话的近期改动（了解现状用）

- 修复了 `allowBuilds` 占位符（pnpm 10 用 `onlyBuiltDependencies`）。
- bundle 依赖从 `link:` 改为 `workspace:*`，junction 重新指向正确路径。
- 删除重复脚本 `build-client.mjs`；`build.mjs` 的 esbuild 查找已跨平台
  （`require.resolve('esbuild/bin/esbuild')`，不再硬编码 win32）。
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

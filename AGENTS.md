# AGENTS.md

面向 AI 编码代理（Claude Code / Codex / Cursor 等）与人类协作者的仓库指南。
请先读本文件，再动手修改。

## 项目是什么

`dsh-balance-plugin` 是一个 **DeepSeek Harness 小组件（widgets）monorepo**：
制作可独立发布、可安装到任意 Harness 实例的插件。浏览器端以 `shell.overlay`
浮动挂件或 Web 设置页呈现。当前两个小组件：

| 小组件 | 包 |
|---|---|
| 余额看板 | `@dsh-plugins/client-ui-balance` |
| Token 暴击挂件 | `@dsh-plugins/client-ui-token-crit` |

其余包是支撑：`@dsh-plugins/balance`（Host 能力缝隙）、`@dsh-plugins/balance-vendors`
（厂商 Provider）、`@dsh-plugins/balance-bundle`（可安装 bundle，一层挂载全部插件）。

## 工作区结构

```
packages/
  dsh-balance/                 Host seam：ctx.balance + balance/query、balance/list Remote
  dsh-balance-vendors/         厂商 Provider（deepseek/moonshot/openrouter/siliconflow/new-api）
  dsh-client-ui-balance/       Web 余额看板 + 「余额供应商」设置页（浏览器端）
  dsh-client-ui-token-crit/    Web token 暴击挂件（纯 UI，浏览器端）
bundles/
  dsh-balance-bundle/          可安装 bundle：cordis.patch.yml 插入 4 个插件
scripts/
  build.mjs                    用 esbuild 构建全部 Host + 浏览器产物到各包 lib/
  sync.mjs                     从 deepseek-harness 同步 3 个 balance 包源码（不含 token-crit）
.github/workflows/             ci.yml（PR/推送校验）+ publish.yml（v* tag 发布 npm）
```

每个包的 `package.json` 有 `exports`（`./client` 指浏览器 bundle）、`dsh.client`
声明（`inject` + `platform: "web"`）、`files: ["lib"]`。

## 常用命令

```sh
pnpm install                 # 安装（workspace 依赖用 workspace:*）
pnpm build                   # 构建全部包产物到 lib/（node scripts/build.mjs）
pnpm sync                    # 从 harness 同步源码（HARNESS_DIR 可覆盖路径）
pnpm -r pack                 # 打包校验（可加 --dry-run）
pnpm run publish:all         # pnpm -r publish --no-git-checks
```

没有测试套件：CI 的校验是「install → build → pack → git diff 干净」。

## 关键约定（改代码前必读）

### 1. 语言与文档

- 仓库面向中文用户，根 README 用中文。
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
- 版本号 5 个包保持一致（当前 0.1.0），升级时同步升。

### 3. 构建产物与 git

- `lib/`、`node_modules/`、`.pnpm-store/`、`*.tgz` 都在 `.gitignore` 里，**不提交**。
- 改 `src/**` 后运行 `pnpm build` 让 `lib/` 产物跟上（发布需要最新产物；
  CI 会跑 build 并断言 git 干净，所以不要把产物差异提交进仓库）。
- 行尾由 `.gitattributes` 规范（文本 LF，ps1 CRLF）。

### 4. 新增小组件

按 token-crit 的模板复制最小结构：

- `src/index.ts`：Host 空 apply（纯 UI 插件）或 seam 逻辑。
- `src/client/index.ts`：浏览器端 `apply` + `inject`，用 `ctx.slots.inject('shell.overlay', ...)`
  注册挂件（需要 `@deepseek-ai/dsh-client-ui-layout` 的类型合并）。
- `package.json` 加 `dsh.client`（inject 依赖 + `platform: "web"`）、`exports["./client"]`、
  `files: ["lib"]`、`publishConfig.access: public`。
- 在 `scripts/build.mjs` 加一段 client bundle 构建（ModuleLoader CJS 包装 +
  内联 CSS 注入，照抄现有段落）。
- 若随 bundle 分发，加进 `bundles/dsh-balance-bundle/` 的依赖与 `cordis.patch.yml`。
- 补双语 README + `README.i18n.yaml`。

### 5. 同步自 harness（sync.mjs）

- 只同步 **3 个 balance 包**（`dsh-balance`、`dsh-balance-vendors`、
  `dsh-client-ui-balance`）；token-crit 是独立维护的，不在同步列表。
- 同步会复制 `src` + `lib` 并把 `@deepseek-ai/dsh-balance*` 改写为 `@dsh-plugins/*`。
- 同步后重跑 `pnpm build` 与 `pnpm -r publish`。

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

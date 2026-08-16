# @dsh-plugins/dsh-widgets-plugin

[English](README.md) | 中文

DeepSeek Harness 小组件集合的可安装**组合包**（bundle）：一个 `cordis.patch.yml`
插入层一次挂载全部小组件插件——余额看板（`@dsh-plugins/balance`）、Token 暴击挂件
（`@dsh-plugins/client-ui-token-crit`）、会话监控看板
（`@dsh-plugins/client-ui-session-monitor`）与小组件管理设置页
（`@dsh-plugins/client-ui-widget-manager`）。

## 安装（发布版，推荐）

发布到 npm 后，用官方 `dsh plugin` 命令装进目标 profile——命令在 profile 目录内
转发给 pnpm，自动安装依赖并把本 bundle 追加进 `dsh.profile.bundles`：

```sh
dsh plugin --profile <name> add @dsh-plugins/dsh-widgets-plugin
```

验证与启动：

```sh
dsh --profile <name> --dump-config   # 应出现 "# == @dsh-plugins/dsh-widgets-plugin" 层
dsh --profile <name>
```

发布物自带各插件的构建产物（`lib/`），安装端无需构建授权。

## 安装（本地开发，link 直连）

从本仓库直接安装 bundle 目录，pnpm 以 `link:` 依赖链接（junction 直连，不拷贝）：

```sh
dsh plugin --profile <name> add <本仓库路径>/bundles/dsh-widgets-plugin
```

首次使用会初始化 profile（`@deepseek-ai/dsh-base` 作为第一个 bundle）。改代码后先在
仓库根 `pnpm build` 更新 `lib/` 产物，再重启 `dsh web`（Host 半改动）或刷新页面
（浏览器半改动）。

> **不支持 `github:` 直接安装**：git 安装拉取的是源码、不跑任何构建，且 bundle 的
> `workspace:*` 依赖在 workspace 之外无法解析。分发请走 npm 发布或
> `pnpm pack` 交付 tarball。

## 结构

- `cordis.patch.yml` — 一个插入层：`balance` → `ui-token-crit` →
  `ui-session-monitor` → `ui-widget-manager` 四行，按包名引用插件
  （`dependencies` 提供）。
- `package.json` — `dsh.bundle.patch` 指向该 patch；`files` 只含
  `cordis.patch.yml`。

## 手动挂载

也可以不用 bundle，直接在 profile 的 `cordis.patch.yml`（或 `--patch` overlay）里手动
插入插件行——见根 README「安装（手动）」与各子包 README。

## 许可

MIT。

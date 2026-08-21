# @dsh-plugins/client-ui-widget-manager

[English](README.md) | 中文

Web 设置页插件：在 Web 设置里新增「小组件管理」页，列出本项目的小组件（挂件），
并可在运行时对每个挂件执行**添加（启用）**或**关闭（禁用）**。

## 预览

![小组件管理设置页：小组件列表与「添加 / 关闭 / 配置」操作](../../docs/previews/widget-manager-settings.png)

## 特性

- **小组件列表**：页面实时投影 `shell.overlay` 的注册台账，结合内置目录展示每个
  挂件的状态——已启用 / 已关闭 / 未安装（含包名与说明）。
- **安装指引**：目录里存在但未挂载的小组件，行上显示**安装指引**按钮（不再是
  禁用的操作按钮）。点击弹出该挂件的具体安装步骤：`dsh plugin --profile <name>
  add <package>` 安装命令、`cordis.yml` / `cordis.patch.yml` 挂载行（使用 bundle
  的行 id），以及重启提示。挂件一旦真正挂载，指引弹窗自动关闭。
- **添加（启用）**：解除对挂件的隐藏，挂件立即回到页面上。
- **关闭（禁用）**：在 `shell.overlay` 中以更低优先级（-1）注册同 id 的影子条目，
  让影子赢得该列表单元（ui-slots 影子机制）从而隐藏挂件——**不卸载插件、不改动
  挂件自身代码**，关闭可随时撤销。
- **配置弹窗**：带配置的小组件（如余额看板的「余额供应商」绑定管理）在行上显示
  **配置**按钮，点击后单独弹出配置窗口——配置内容由挂件自己的包注册进本页声明的
  `widgets.config` 子槽（键为挂件 id），不再占用 Web 设置的菜单页。挂件被关闭时
  配置按钮随之隐藏。
- **状态持久化**：禁用列表写入浏览器 `localStorage`，刷新后保持；挂件晚于管理页
  挂载时，订阅机制会在其条目出现的瞬间自动补上影子。
- **动态台账**：除内置目录外，任何已注册但不在目录里的挂件也会以通用行展示。

## 结构

```
src/index.ts                  # Host 空 apply（纯 UI 插件）
src/client/index.ts           # 浏览器 apply + inject（注册 settings.section）
src/client/controller.ts      # 运行时开关：影子注册 / 台账投影 / localStorage
src/client/widgets.ts         # 项目挂件静态目录
src/client/locales.ts         # 字典 NS `widgets`（zh / en）
src/client/WidgetManagerSettings.tsx
src/client/WidgetManagerSettings.module.css
lib/index.js                  # Host 构建产物（静态）
lib/client.js                 # 浏览器构建产物（ModuleLoader CJS bundle）
```

## 构建

根目录 `scripts/build.mjs` 用 esbuild 构建；本包的「Widget-manager」段产出
`lib/index.js`（Host stub）与 `lib/client.js`（ModuleLoader CJS + 内联 CSS）：

```bash
pnpm install
pnpm build   # 等价于 node scripts/build.mjs
```

## 挂载

纯客户端 surface 插件：把它（连同其 `dsh.client` 声明的依赖）加入部署的 web
插件表 / host `cordis.yml` 后，浏览器端通过 `exports["./client"]` 加载
`lib/client.js`，Web 设置里即出现「小组件管理」页。推荐直接安装 `@dsh-plugins/dsh-widgets-plugin`（发布后
`dsh plugin --profile <name> add @dsh-plugins/dsh-widgets-plugin`），一次挂载本页与
全部小组件；本地开发可直接 `link:` 本仓库 bundle（见根 README「安装」）。

## 使用

1. 打开 Web 设置 → 「小组件管理」。
2. 每个小组件显示当前状态：**已启用**（挂件在页面上）、**已关闭**（被本页隐藏）、
   **未安装**（对应包未挂载——提供**安装指引**按钮查看安装步骤）；可配置的挂件
   标注「可单独配置」并显示**配置**按钮。
3. 点 **配置** 打开该挂件自己的配置弹窗（如余额看板的供应商绑定管理）；点 **关闭**
   把挂件从页面上移除（配置按钮随之隐藏），点 **添加** 把它重新挂回页面。未安装的
   挂件点 **安装指引** 打开安装步骤弹窗（装包命令、组成挂载行、重启提示）。
4. 状态保存在本机浏览器，刷新页面后保持；管理页本身随插件 fiber 卸载而级联清理。

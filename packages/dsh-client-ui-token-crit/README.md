# @dsh-plugins/client-ui-token-crit

浮动的 token 用量「暴击伤害」计量挂件（web 端插件）。纯 UI 插件：在
`shell.overlay` 里注册一个可拖动、可缩放、可折叠的透明挂件，实时显示当前
会话累计 token 用量，并在用量增长时触发网游风格的暴击动效。

## 特性

- **实时累计用量**：通过标准 `useSessions` prop 读取 `tokenUsage` 会话投影
  （输入 + 缓存读 + 缓存写 + 输出），无需 Host RPC、无需轮询（投影推送帧
  是响应式的）。
- **暴击动效**：增长时震屏 + 爆闪 + 飘出「输入 / 输出」分流的 `+N` 伤害数字、
  粒子迸溅、连击计数，大额触发红色 `暴击!` / `CRIT!`、屏幕边缘泛光、可选音效。
- **常驻粒子**：透明背景下缓缓上浮的火烬粒子（数量、颜色可调）。
- **可配置**：⚙ 设置面板实时调节语言（中/英）、数字格式/字号、标签、连击、
  粒子、暴击阈值/比例、音效、边缘泛光；位置与缩放写入 `localStorage`。

## 结构

```
src/index.ts                  # Host 空 apply（纯 UI 插件）
src/client/index.ts           # 浏览器 apply + inject
src/client/TokenCritWidget.tsx
src/client/TokenCritWidget.module.css
lib/index.js                  # Host 构建产物（静态）
lib/client.js                 # 浏览器构建产物（ModuleLoader CJS bundle）
```

## 构建

根目录 `scripts/build.mjs` 用 esbuild 构建；本包在其中的
「Token-crit client bundle」段产出 `lib/client.js`：

```bash
pnpm install
pnpm build   # equivalent to `node scripts/build.mjs` from the repo root
```

## 挂载

这是一个纯客户端 surface 插件：把它（连同其 `dsh.client` 声明的依赖）加入
部署的 web 插件表 / host `cordis.yml` 后，浏览器端通过
`exports["./client"]` 加载 `lib/client.js` 并在 `shell.overlay` 中渲染挂件。

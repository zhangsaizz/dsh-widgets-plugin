# @dsh-plugins/client-ui-token-crit

[English](README.md) | 中文

浮动的 token 用量「暴击伤害」计量挂件（web 端插件）。纯 UI 插件：在
`shell.overlay` 里注册一个可拖动、可缩放、可折叠的透明挂件，实时显示当前
会话累计 token 用量，并在用量增长时触发网游风格的暴击动效。

## 预览

![Token 暴击挂件预览：实时用量计数与暴击动效](../../docs/previews/token-crit-widget.png)

## 特性

- **实时累计用量**：通过标准 `useSessions` prop 读取 `tokenUsage` 会话投影
  （输入 + 缓存读 + 缓存写 + 输出），无需 Host RPC、无需轮询（投影推送帧
  是响应式的）。
- **暴击动效**：增长时震屏 + 爆闪 + 飘出「输入 / 输出」分流的 `+N` 伤害数字、
  粒子迸溅、连击计数，大额触发霓虹品红 `暴击!` / `CRIT!`、屏幕边缘泛光、可选音效。
- **赛博朋克 HUD 风格**：数字为青↔品红霓虹渐变 + 色差（RGB 分离）辉光、HUD
  角标；暴击配色统一为青/品红（输入=青色、输出=品红、暴击=热粉）。数字与标签带
  有「故障霓虹灯管」式闪烁（随机亮度骤降，由动画循环驱动，不受徽章重挂载影响），
  闪烁时还会穿插随机字符乱码（保留逗号，数字仍可辨认）。
- **常驻粒子**：透明背景下缓缓上浮的火烬粒子（数量、颜色可调）。
- **浅色背景适配**：自动检测宿主主题（回退到系统配色偏好），在浅色界面下切换到
  更深饱和的霓虹配色 + 常规合成，保证可读；设置面板可手动选「自动 / 深色 / 浅色」。
- **可配置**：⚙ 设置面板实时调节语言（中/英）、数字格式/字号、标签、连击、
  粒子、暴击阈值/比例、音效、边缘泛光、霓虹闪烁/乱码故障强度（关/低/中/高）；
  全部设置（含位置、缩放与面板各选项）写入 `localStorage`。
  面板里的 ⚡「测试特效」按钮可随时重播完整暴击动效（伤害数字、粒子、连击、
  边缘泛光、音效），不会改变真实计数。

## 结构

```
src/index.ts                  # Host 空 apply（纯 UI 插件）
src/client/index.ts           # 浏览器 apply + inject
src/client/TokenCritWidget.tsx
src/client/TokenCritFx.ts     # Canvas 特效层（粒子 / 飘字 / 连击）
src/client/TokenCritWidget.module.css
lib/index.js                  # Host 构建产物（静态）
lib/client.js                 # 浏览器构建产物（ModuleLoader CJS bundle）
```

## 构建

根目录 `scripts/build.mjs` 用 esbuild 构建；本包在其中的
「Token-crit client bundle」段产出 `lib/client.js`：

```bash
pnpm install
pnpm build   # 等价于 node scripts/build.mjs
```

## 挂载

这是一个纯客户端 surface 插件：把它（连同其 `dsh.client` 声明的依赖）加入
部署的 web 插件表 / host `cordis.yml` 后，浏览器端通过
`exports["./client"]` 加载 `lib/client.js` 并在 `shell.overlay` 中渲染挂件。
推荐直接安装 `@dsh-plugins/dsh-widgets-plugin`，它会一次挂载本挂件与余额看板。

## 使用

挂载后无需配置——打开任意会话即可看到挂件：

1. **查看用量**——打开会话，透明挂件实时显示会话累计 token 用量（输入 / 缓存读 /
   缓存写 / 输出），用量增长时触发暴击动效与 `+N` 伤害数字。
2. **调整形态**——拖头部移动、拖角缩放、点收起按钮缩成胶囊。
3. **打开设置**——点挂件上的 ⚙ 实时调节语言（中/英）、数字格式/字号、标签、连击、
   粒子数量与颜色、暴击阈值/比例、音效、边缘泛光；所有设置（面板选项、位置与缩放）
   自动写入 `localStorage`，刷新页面后保持。点 ⚡「测试特效」可预览完整暴击效果，
   不影响真实计数。
4. **隐藏**——设置面板可隐藏挂件；之后通过宿主的 web 插件表重新启用。

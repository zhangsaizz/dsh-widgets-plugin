# @dsh-plugins/client-ui-rainbow-flow

[English](README.md) | 中文

纯 UI 的 web 端插件：会话运行时，输入框四周环绕流动的彩虹流光（挖空描边环 +
柔光光晕），旋转速度随每秒输出 token 数动态变化；输入框工具行里还有一个
开/关开关。

## 预览

![彩虹流光预览：输入框四周的描边环与光晕](../../docs/previews/rainbow-flow.png)

## 特性

- **彩虹环绕输入框**：当前会话运行中时，输入框卡片四周出现流动的彩虹描边环
  （2px）+ 模糊光晕（6px）。两层都是 mask 挖空的描边——**内部完全透明**，
  绝不遮挡输入内容；效果随运行状态出现/消失，并自动跟随卡片高度（绝对定位
  层挂在卡片内部，无需测量）。
- **速度跟随 token 速率**：每 500ms 采样一次流式 `partial` 内容，估算每秒
  输出 token 数（约 2 字符/token，EMA 平滑）；旋转周期在 3.2s（慢）↔
  0.45s（快）之间映射——模型输出越快彩虹转得越快，思考/调用工具的间隙平滑
  回落到慢速漂移。**快慢之间有平滑过渡**：rAF 循环里角速度以指数缓动逼近
  采样目标并连续积分旋转角（不再直接改 `animation-duration`），加减速平滑、
  彩虹相位不跳变。只有清晰的描边环在转——模糊光晕保持静态（环境光，只渲染
  一次，免去每帧 blur 重算）。
- **开/关开关**：输入框工具行左端（`conversation.input.left` 席位）一个彩虹
  小圆点按钮；关闭时圆点变灰，右上角状态点在会话运行中变绿。开关状态持久化
  到 `localStorage`（`dsh.rnglow.enabled`，默认开）。
- **优雅降级**：不支持 `mask-composite` 的浏览器自动回退为多色 `box-shadow`
  外发光——同样不遮挡输入；`prefers-reduced-motion` 下停止旋转动画。

## 结构

```
src/index.ts                      # Host 空 apply（纯 UI 插件）
src/client/index.ts               # 浏览器 apply + inject（两个 input.left 条目）
src/client/RainbowFlow.tsx        # 开关 + 光环组件，共享开关 store
src/client/rate.ts                # 纯运动模型（token 速率 → 转速、指数缓动）
src/client/RainbowFlow.module.css # 挖空描边/光晕/开关样式
docs/speed-smoke-test.cjs         # 运动模型冒烟测试（esbuild 打包真实源码）
lib/index.js                      # Host 构建产物（静态）
lib/client.js                     # 浏览器构建产物（ModuleLoader CJS + 内联 CSS）
```

## 构建

根目录 `scripts/build.mjs` 用 Vite library mode（官方 deepseek-harness 的
Web 工具链）把本包浏览器半构建进 `lib/client.js`：

```bash
pnpm install
pnpm build   # 等价于 node scripts/build.mjs
```

## 挂载

这是一个纯客户端 surface 插件：把它（连同其 `dsh.client` 声明的依赖）加入
部署的 web 插件表 / host `cordis.yml` 后，浏览器端通过
`exports["./client"]` 加载 `lib/client.js`，注册进 `conversation.input.left`
——每个会话的输入框都会出现。本地开发可直接 `link:` 本仓库 bundle（见根
README「安装」）。

## 使用

挂载后无需配置：

1. **看它流动**——打开任意会话发一条消息；模型运行时，输入框四周出现彩虹
   描边环 + 光晕，输出 token 越快彩虹转得越快。
2. **开关**——点工具行左端的彩虹小圆点即可关闭/开启效果（刷新后保持）；圆点
   右上角状态点在会话运行中变绿。
3. **减少动态效果**——`prefers-reduced-motion` 下彩虹停止旋转（静态彩虹），
   效果仍可见。

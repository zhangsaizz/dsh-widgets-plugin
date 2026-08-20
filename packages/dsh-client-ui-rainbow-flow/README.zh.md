# @dsh-plugins/client-ui-rainbow-flow

[English](README.md) | 中文

纯 UI 的 web 端插件：会话运行时，输入框变成透明液态玻璃面板，几缕像云一样蓬松的
彩虹光缕沿无边框的边缘缓缓飘动，飘速随每秒输出 token 数动态变化；输入框工具行
里有一个开/关开关，小组件管理页提供**配置面板**（云缕数/透明度/速度/冷色调），
并对输入框的主操作**发送/停止按钮**做**液态玻璃**图标美化 + 动态效果。

## 预览

![彩虹流光预览：输入框四周的描边环与光晕](../../docs/previews/rainbow-flow.png)

## 特性

- **整个输入框是透明液态玻璃**：彩虹流开关开启时，输入框卡片本身变成**通透的
  磨砂玻璃面板**——产品自带实心深色背景被替换为**柔和白色玻璃渐变**，并借卡片
  `::before` **轻磨砂层（blur 14px）** 让卡片背后的内容（页面、浮动挂件、聊天区）
  **清晰透出**——通透而非蒙雾墙。在深色主题下，白色玻璃让卡片比背景稍亮一档
  （玻璃识别度保留）同时保持通透；在亮色主题下玻璃自动加深为高对比面板、按钮
  图标翻转为深色保证可读——玻璃材质是**主题感知**的（`--rf-glass-*` token，
  暗/亮两套调色板）。输入框就是一块液态玻璃，**没有可见的环带或边框**——唯一
  的边缘装饰就是流动的彩虹光带本身。（磨砂层放在卡片的 `::before` 伪元素上
  而不是卡片本身——因为卡片级 `backdrop-filter` 会成为内部 fixed 定位 Tooltip
  气泡的 containing block、把气泡打出屏幕；`::before` 与那些内容是兄弟关系，
  弹层不受影响。）关闭开关即恢复原厂不透明卡片，完全不动产品外观。效果自动
  跟随卡片高度（绝对定位层挂在卡片内部，无需测量）。
- **速度跟随 token 速率**：每 500ms 采样一次流式 `partial` 内容，估算每秒
  输出 token 数（约 2 字符/token，EMA 平滑）；流动周期在 5s（慢）↔ 1s（快）
  之间映射——比旧版更从容，静止时悠悠漂移、峰值也不狂转。模型输出越快彩虹
  流得越快，思考/调用工具的间隙平滑回落到慢速漂移。**快慢之间有平滑过渡**：
  rAF 循环里流速以指数缓动逼近采样目标并连续推进粒子相位（不再直接改
  `animation-duration`），加减速平滑、粒子不跳位。模糊光晕保持静态（环境光，
  只渲染一次，免去每帧 blur 重算）。
- **一缕缕云边缘（像云流动）**：彩虹边缘是**几缕蓬松柔软的云状光团沿卡片边缘
  缓缓飘动**——6 缕云，每缕都是厚实圆润的光团（底层宽而淡的辉光 + 上层柔和
  核心，sin 包络让每缕中间亮、两端渐隐），缕与缕之间留有空隙，读起来是几缕
  独立的云在飘而不是一条连续线；色相在每缕内部轻柔渐变交融（`particles.ts`：
  纯几何 + 运动模型，可测试）。token 速率驱动云的飘速。
- **心情感知色调**：模型在思考或调用工具（没有新输出）时，云缕**偏冷**
  （+120° 色相偏移，偏蓝紫）；开始输出时回温到完整彩虹。色相偏移平滑缓动，
  让调色板跟着模型的节奏滑动——一眼就能看出是"工作中"还是"输出中"。
- **减少动态**：`prefers-reduced-motion` 下云缕渲染为**单帧静态**（可见但不
  流动），而不是完全消失。
- **可配置**：小组件管理页把彩虹流光当成普通挂件——**启用/停用**开关与工具栏
  圆点**双向同步**（window 事件桥），「配置」弹窗（`widgets.config`）可调
  **云缕数量**（4/6/8/10）、**整体透明度**（40/70/100%）、**速度灵敏度**
  （0.5×/1×/1.5×）和**思考冷色调开关**——持久化到 `localStorage`
  （`dsh.rnglow.settings`），已挂载的效果实时生效。
- **省电**：输入框滚出视口时动画循环自动暂停（`IntersectionObserver`）；色板
  一次性预计算，每帧零字符串拼接。
- **开/关开关**：输入框工具行左端（`conversation.input.left` 席位）一个
  **液态玻璃质感**的彩虹小圆点按钮（半透明渐变 + blur + 顶部高光）；关闭时圆点
  变灰，右上角状态点在会话运行中变绿。开关状态持久化到 `localStorage`
  （`dsh.rnglow.enabled`，默认开）。
- **发送/停止按钮液态玻璃美化**：输入框主操作按钮（空闲=发送箭头、运行中=停止
  方块）是产品自带 chrome、不是插槽，无法替换——因此用一个 `conversation.input.right`
  条目把按钮的有效状态镜像到输入卡上（`data-rf-send`），再由一份纯全局样式表
  `SendButton.css` 从外部给按钮化妆：**半透明玻璃面板**（白色渐变 + backdrop
  blur + 顶部高光）里透出柔和彩虹，空闲有草稿时**呼吸光晕**，运行中则**彩虹
  旋转 + 扩散雷达脉冲环**。与开关共用同一开关状态（关 = 完全保持原样），禁用态
  （空草稿）不生效，`prefers-reduced-motion` 下动画冻结。选择器锚定稳定的
  `[data-composer-card]` 属性 + `_primary` CSS-module 后缀（哈希前缀随 harness
  构建变化、本地名不变），harness 升级后仍生效。
- **优雅降级**：不支持 `mask-composite` 的浏览器隐藏挖空的光晕层（不挖空会变成
  实心面板盖住输入），自动回退为多色 `box-shadow` 外发光；不支持 `backdrop-filter`
  的浏览器仍保留半透明白色玻璃（磨砂模糊是增强）；粒子 canvas 不依赖 mask 保持
  可见；同样不遮挡输入；`prefers-reduced-motion` 下云缕渲染为单帧静态。

## 结构

```
src/index.ts                      # Host 空 apply（纯 UI 插件）
src/client/index.ts               # 浏览器 apply + inject（四个条目，含配置面板）
src/client/RainbowFlow.tsx        # 开关 + 光环（canvas 云缕）+ 发送/停止探针
src/client/SettingsPanel.tsx      # 小组件管理页配置面板（widgets.config）
src/client/SettingsPanel.module.css # 配置面板样式
src/client/settings.ts            # 设置 store（云缕/透明度/速度/冷色调，localStorage）
src/client/locales.ts             # `rainbow-flow` 字典命名空间（zh / en）
src/client/particles.ts           # 纯云缕几何/运动模型（圆角矩形边缘路径）
src/client/rate.ts                # 纯运动模型（token 速率 → 流速、指数缓动）
src/client/RainbowFlow.module.css # 玻璃面板/光晕/开关/探针样式
src/client/SendButton.css         # 发送/停止按钮美化全局样式（纯 CSS）
docs/speed-smoke-test.cjs         # 运动模型冒烟测试（esbuild 打包真实源码）
docs/particles-smoke-test.cjs     # 云缕几何/运动冒烟测试
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
与 `conversation.input.right`——每个会话的输入框都会出现。本地开发可直接
`link:` 本仓库 bundle（见根 README「安装」）。

## 使用

挂载后无需配置：

1. **看它流动**——打开任意会话发一条消息；模型运行时，输入框变成透明玻璃面板，
   几缕像云一样蓬松的彩虹光缕沿边缘缓缓飘动，输出 token 越快云飘得越快。
2. **开关**——点工具行左端的玻璃质感彩虹小圆点即可关闭/开启效果（刷新后保持）；
   圆点右上角状态点在会话运行中变绿。
3. **发送按钮**——输入草稿后，主发送按钮变成液态玻璃面板 + 呼吸光晕，彩虹从
   玻璃里透出；会话运行中变成彩虹旋转的停止按钮 + 扩散脉冲环。关闭开关即恢复
   原厂外观。
4. **减少动态效果**——`prefers-reduced-motion` 下云缕渲染为单帧静态（可见但不
   流动）；发送/停止按钮的动画同样冻结。

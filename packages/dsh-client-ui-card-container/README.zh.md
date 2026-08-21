# @dsh-plugins/client-ui-card-container

一个浮动**卡片容器**小组件：把其他 `shell.overlay` 小组件停靠进一个整齐、等间距的
卡片网格，让看板不再挤在屏幕角落抢位置。

[English](README.md) | 中文

## 它能做什么

- 注册一个浮动容器面板进 `shell.overlay`（id `card-container`），在**小组件管理**
  页里启用即可。
- **多分组**：容器持有多个命名分组（各自独立的停靠集合）。顶部分组标签切换，
  「⋯」管理按钮可新建 / 重命名（内联输入）/ 删除分组。默认分组名显示为本地化的
  「默认」。一个小组件同一时刻只能停靠在一个分组；把卡片拖到另一个分组标签上松手即
  **跨组移动**。
- **托盘**列出当前已启用的小组件（余额、Token 暴击、会话监控等）。把托盘里的
  chip 拖进网格（或点击）即可**停靠**到当前分组；空态提供「一键停靠全部」。
- 停靠后浮窗被隐藏（影子条目赢下它的 overlay 单元——与小组件管理页停用挂件的机制
  相同），网格内渲染该小组件的紧凑**卡片视图**。点 × **移出容器**（或把卡片拖出
  网格）即可恢复浮窗。
- 卡片**实时换位排序**：拖动卡片会「拎起」成幽灵卡片跟随鼠标，其余卡片实时让位；
  在网格内松手落定顺序，**拖出网格松手 = 移出容器**。
- 键盘可达：Tab 聚焦卡片后，Enter/空格移出、方向键排序。
- 网格使用一致的间距（12px），列数自适应或固定（可配置），卡片永远整齐对齐。
- 容器面板 / 停靠卡片 / 收起胶囊 / 分组菜单为**液态玻璃**材质（与彩虹流光输入框
  同一配方：半透明白玻璃渐变 + 轻磨砂背景模糊 + 1px 边缘反光 + 柔和投影，主题感知
  亮/暗两套玻璃调色板）。
- 分组、停靠顺序、面板位置在刷新后保留。
- 触屏（无 hover）设备：chrome 始终完整显示，容器不会「找不到」。
- 容器自身被停用时（被管理页隐藏），停靠的影子全部释放，小组件恢复浮动；重新启用
  容器会按持久化的分组恢复停靠。

## 卡片视图（接入规范）

容器把 `widgets.card` 子槽定义为**标准、可选**的适配器契约：各小组件自己的包可以
选择是否在容器网格里提供紧凑卡片视图——注册进该槽（条目 id = 小组件的
`shell.overlay` id，默认 priority 0）即可，容器通过
`renderSlot('widgets.card', {}, { only: id, fallback })` 渲染停靠挂件的卡片。
**接入是纯可选的**：不注册的挂件被停靠时显示通用占位卡。

```ts
// 在你的挂件包 client apply 里（type-only 导入；peerDependencies 加
// "@dsh-plugins/client-ui-card-container"）：
import type { WidgetCardProps, WidgetCardComponent } from '@dsh-plugins/client-ui-card-container/client'
import type {} from '@dsh-plugins/client-ui-card-container/client'

export function MyWidgetCard({ useSessions, undock }: WidgetCardProps) { /* … */ }
// 可选：声明卡片占 2 列（'small' = 1 列，默认；'medium' = 2 列；'large' = 整行）
(MyWidgetCard as WidgetCardComponent).spec = 'medium'

ctx.slots.inject('widgets.card', () => ctx.slots.register({
  name: 'widgets.card',
  id: 'my-widget',       // ★ 必须等于 shell.overlay 的 id
  order: 0, priority: 0, // 默认 0：优先于容器内置兜底（10）
  // locale: 'my-widget', // 需要 t 时声明
}, MyWidgetCard))
```

`WidgetCardProps` = `PropsRuntime<'widgets.card'>`（框架全局座 `useSessions` /
`useWorkspaces`）加槽级注入面 `CardSlotInject`——`useContainer` hook（容器实时
停靠/可用快照）加 `dock` / `undock` 动词，卡片可以响应容器状态（如恢复浮窗）。
卡片声明 locale 时叠加 `PropsLocale<'你的NS'>`。可选的静态 `spec`
（`WidgetCardComponent`）决定卡片在网格里占多大。完整契约见
`WIDGET-DEVELOPMENT.md` 第 2.5 节。

**浮窗快捷停靠**：浮动挂件可以 dispatch 容器的停靠请求 window 事件
（`detail` = 自己的 `shell.overlay` id）把自己停靠进容器——与容器解耦，容器未
挂载时是 no-op：
`window.dispatchEvent(new CustomEvent('dsh.card-container.dock', { detail: 'my-widget' }))`。

本包**不**自带任何内置卡片视图——容器是通用的。每个提供紧凑卡片的挂件都在各自
包里以 priority 0 注册进 `widgets.card`（token-crit、session-monitor、balance
均已接入；见 `WIDGET-DEVELOPMENT.md` §2.5）。未注册卡片的停靠挂件在网格里回落到
通用占位卡。

## 使用方法

在**小组件管理**设置页的「卡片容器」行点**添加**。面板默认出现在左上角（拖动头部
可移动）。把托盘 chip 拖进网格停靠、拖动卡片排序、点 × 移出，用**配置**修改列数或
重置布局。

## 开发说明

- 纯 UI 客户端插件：`src/index.ts` 是空 Host apply；浏览器半在 `src/client/`。
- 状态：分组（`dsh-plugins.card-container.groups`）、当前分组
  （`dsh-plugins.card-container.active`）、面板位置（`dsh-plugins.card-container.pos`）
  与设置（`dsh-plugins.card-container.settings`）持久化在 localStorage（旧版单
  `docked` 列表自动迁移进默认分组）；配置变更经 window `CustomEvent`
  （`dsh.card-container.settings-changed`）通知。
- 控制器（`src/client/controller.ts`）管理停靠影子（priority -2，registrant
  `card-container`）、分组增删改/切换，以及针对 overlay 台账的自我修复对账。

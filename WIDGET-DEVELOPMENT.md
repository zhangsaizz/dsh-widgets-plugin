# 小组件开发与面板管理接入指南

本文面向要为本仓库新增小组件（widget）的开发者：先讲如何三步做出一个可发布的小组件，
再讲它如何**自动接入「小组件管理」面板**（`@dsh-plugins/client-ui-widget-manager`）——
出现在列表、可添加/关闭、带独立配置弹窗。仓库级约定（作用域、版本、构建、双语文档）
见 [AGENTS.md](AGENTS.md)，组件登记见 [COMPONENTS.md](COMPONENTS.md)。

---

## 1. 三步开发一个小组件

以新增 `@dsh-plugins/client-ui-clock`（示例时钟挂件，id `clock`）为例。

### 1.1 最小包结构

```
packages/dsh-client-ui-clock/
  package.json                  # 见 1.3
  src/index.ts                  # Host 空 apply（surface 占位）
  src/css-modules.d.ts          # declare module '*.module.css'
  src/client/
    index.ts                    # 浏览器 apply + inject（注册 shell.overlay）
    ClockWidget.tsx             # 挂件本体（React 组件）
    ClockWidget.module.css
    locales.ts                  # 挂件自己的字典（NS `clock`，zh/en）
```

`src/index.ts`（Host 半，纯 UI 插件就是空 apply）：

```ts
/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
```

`src/client/index.ts`（浏览器半，核心是向 `shell.overlay` 注册一个条目）：

```ts
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: 拉入 shell.overlay 槽的类型合并（ui-layout 声明）。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: 拉入 `ctx.slots`（SlotRegistry）的 Context 类型合并（ui-renderer 声明）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: 拉入 locale 插件的 ctx.locale 类型合并。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ClockWidget } from './ClockWidget.tsx'
import { en, zh } from './locales.ts'
import type { ClockKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    clock: ClockKey
  }
}

const NS = 'clock'

/** 本插件需要的服务：slot 注册表 + locale 面。 */
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'clock: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'clock',        // ★ 唯一且稳定：面板按这个 id 管理/持久化
    order: 80,          // 浮层列表中的排序（balance=100、session-monitor=90、token-crit=50）
    locale: NS,         // 声明后组件 props 会拿到 t seat
    inject: () => ({ refresh: () => {} }),   // 可选：注入业务面（hooks/动作）
  }, ClockWidget))
}
```

> `ctx.slots.inject('shell.overlay', …)`：槽被声明后才会注册条目，插件加载顺序无关；
> 组件 props 由四份合并而来（`PropsRuntime` + `PropsStore` + `InjectFace` + `PropsLocale`），
> 组件只声明自己用到的份额即可（照抄 `client-ui-token-crit` 的写法）。

### 1.2 挂件组件

```tsx
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ClockWidget.module.css'

export type ClockWidgetProps = PropsRuntime<'shell.overlay'> & PropsLocale<'clock'>

export function ClockWidget({ t }: ClockWidgetProps) {
  // 挂件本体：position: fixed 浮层（参考 BalanceWidget / TokenCritWidget 的形态）
  return <div className={css.widget}>{t('title')}</div>
}
```

`locales.ts` 声明字典键并给出 zh/en 文案（照抄 `dsh-balance/src/client/locales.ts` 的结构）。

### 1.3 package.json 要点

```jsonc
{
  "name": "@dsh-plugins/client-ui-clock",
  "version": "0.1.0",                       // 与其余包保持一致（当前 0.1.0）
  "license": "MIT",
  "publishConfig": { "access": "public" },  // scoped 包必须 public，否则发布失败
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },  // 浏览器 bundle 入口
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {                              // 浏览器插件声明：加载顺序 + 平台
      "inject": [
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-locale"
      ],
      "platform": "web"
    }
  },
  "files": ["lib"],
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-client-ui-renderer": "^0.2.0-rc.2",
    "@deepseek-ai/dsh-client-ui-layout": "^0.2.0-rc.2",
    "@deepseek-ai/dsh-client-ui-slots": "^0.2.0-rc.2",
    "@deepseek-ai/dsh-client-locale": "^0.2.0-rc.2",
    "react": "^18.2.0"
  }
}
```

### 1.4 构建与分发

在 `scripts/build.mjs` 照抄现有 client bundle 段（Vite library mode），产出
`lib/client.js`（ModuleLoader CJS + 内联 CSS）：

```js
// 在 CLIENT_PACKAGES 数组加一行：
//   { pkg: 'packages/dsh-client-ui-clock', id: '@dsh-plugins/client-ui-clock' }
// buildClientBundle() 会用 Vite library mode 构建：CJS 输出 + CSS Modules 提取，
// 再包 ModuleLoader factory + 内联 CSS 注入（照抄现有段落，无需手写 esbuild 参数）。
```

> client bundle 必须用 `isClientExternal`（`EXTERNAL_CLIENT`，不含 `zod`）：浏览器
> ModuleLoader 的模块表里没有 `zod` 工厂，typert 生成的线协议代码会 import 它，所以
> 要内联（build.mjs 顶部注释有完整说明）；Host bundle 才用 `EXTERNAL`。

若随 bundle 分发：在 `bundles/dsh-widgets-plugin/package.json` 的 dependencies 加
`"@dsh-plugins/client-ui-clock": "workspace:*"`，并在 `cordis.patch.yml` 加一行：

```yaml
    - id: ui-clock
      name: '@dsh-plugins/client-ui-clock'
```

### 1.5 文档与登记

- 双语 README 对（`README.md` + `README.zh.md`，头部互链）+ `README.i18n.yaml`
  （改完用 `git hash-object` 重算两侧 hash 写入）。
- 在 `COMPONENTS.md` 的总览/包清单/明细/构建产物/插槽汇总补登记。
- `pnpm build` 让 `lib/` 跟上；CI 会断言 build 后 git 干净。

---

## 2. 接入「小组件管理」面板

面板（`@dsh-plugins/client-ui-widget-manager`，Web 设置 → 小组件管理）**实时投影
`shell.overlay` 台账**，所以：

### 2.1 自动出现（零配置）

只要挂件注册进 `shell.overlay`，面板列表就会出现它，并显示实时状态：

| 状态 | 含义 |
|---|---|
| 已启用 | 挂件条目是 `shell.overlay` 该 id 单元的胜者（正在渲染） |
| 已关闭 | 被面板以影子条目（`priority: -1`）隐藏 |
| 未安装 | 插件未挂载（台账里没有该 id） |

面板**自动**支持「添加（启用）/ 关闭（禁用）」，挂件代码无需感知：
- **关闭** = 面板注册同 `id`、`priority: -1` 的影子条目，list 槽单元渲染最低优先级
  胜者，挂件条目仍在台账但不渲染；**不卸载插件、不改挂件代码**。
- **添加** = 面板 dispose 影子条目，挂件恢复渲染。
- 影子随面板插件 fiber 卸载级联清理；关闭状态持久化在浏览器
  `localStorage`（`dsh-plugins.widget-manager.disabled`），刷新后保持。

### 2.2 必须登记目录（登记后才被列出与管理）

**登记是必须的**：面板只投影目录里的 id（`controller.ts` 的 `WIDGET_CATALOG` /
`isOwnWidgetId`）。只注册 `shell.overlay` 而不登记的挂件在管理页**完全不出现**——既看不到
也无法启用/停用。之所以不再列出「目录外的台账条目」：`shell.overlay` 是共享槽，harness 自己
也往里注册浮层（快捷键速查、会话重命名/归档对话框、工作区提示、额度提醒等），而影子机制
对任何 list id 都生效，列出它们既会把官方浮层误标成挂件，也会让一次误点隐藏官方 UI。

登记方式：在面板包的 `src/client/widgets.ts` 目录里加一条，并在 `locales.ts`（NS `widgets`）
补两个键（行 id 用挂件的 `shell.overlay` id；`installRowId` 用于 bundle 挂载行 id 与 overlay id
不一致的情况）：

```ts
// packages/dsh-client-ui-widget-manager/src/client/widgets.ts
export const WIDGET_CATALOG: readonly WidgetDescriptor[] = [
  // ... 现有条目 ...
  {
    id: 'clock',
    packageName: '@dsh-plugins/client-ui-clock',
    nameKey: 'clockName',
    descriptionKey: 'clockDescription',
  },
]
```

### 2.3 启用/关闭的注意事项

- **id 必须唯一且稳定**：关闭状态按 `shell.overlay` 的 id 持久化；改名会让旧的
  关闭状态失效（挂件重新出现，属正常行为）。
- 关闭只隐藏渲染，不销毁状态：挂件若持有轮询/定时器，继续运行是预期行为
  （想省资源可自行监听面板服务，但目前没有公开接口，保持简单即可）。
- 若在别处按 `ctx.slots.entries('shell.overlay')` 枚举挂件，注意被关闭挂件的条目
  依然在台账里（只是不是胜者）。

### 2.4 配置弹窗：注册进 `widgets.config` 槽

面板在它的设置页注册中声明了子槽 `widgets.config`（list，条目 `id` = 挂件 id）。
**带配置的挂件**把自己的配置面板注册进去，面板即自动在行上显示「配置」按钮，
点击后在**独立弹窗**里渲染（`renderSlot('widgets.config', {}, { only: 挂件id })`）；
挂件被关闭时配置按钮自动隐藏。

```ts
// client-ui-clock/src/client/index.ts（apply 内追加）
// Type-only: 拉入 widgets.config 槽的类型合并（面板包声明）。
import type {} from '@dsh-plugins/client-ui-widget-manager/client'

// 配置面板：仅当面板声明该槽时注册（管理器缺席时静默跳过）
ctx.slots.inject('widgets.config', () => ctx.slots.register({
  name: 'widgets.config',
  id: 'clock',                     // ★ 与 shell.overlay 的 id 一致
  order: 0,
  // 配置组件若用 PropsLocale 取 t，这里声明 locale: NS；
  // 若像 BalanceSettings 那样经 inject 收 t，则不声明 locale：
  inject: () => ({ t: ctx.locale.bind(NS) }),
}, ClockSettings))
```

配套改动：

- **类型依赖**：`import type {} from '@dsh-plugins/client-ui-widget-manager/client'`
  是 type-only（esbuild/Vite 会剥离，无运行时 require），但在 `package.json` 的
  `peerDependencies` 加 `"@dsh-plugins/client-ui-widget-manager": "workspace:*"`。
- **配置组件自包含**：弹窗里只注入它自己的面（如 `t` / hooks / 动作），数据读写
  自己负责（BalanceSettings 就是自己 fetch `/_dsh/balance/settings`）。
- **缺席回退**：管理器未安装时 `widgets.config` 不被声明，`ctx.slots.inject`
  的回调永不执行——配置面板自然不注册，不会报错。若你的挂件被单独安装
  （无管理器）时配置必须可用，需要保留另一条配置入口并文档说明。

### 2.5 可选：接入卡片容器（`widgets.card` 适配器规范）

卡片容器（`@dsh-plugins/client-ui-card-container`）会声明 `widgets.card` 子槽
（list，root scope）：**每个挂件可以自由选择**是否在容器网格里提供自己的紧凑
卡片视图。不接入的挂件被停靠进容器时，容器会显示通用占位卡片——所以接入是
**纯增量、可选**的。标准契约：

- **槽**：`widgets.card`，条目 `id` **必须等于**挂件在 `shell.overlay` 的 id
  （容器用 `renderSlot('widgets.card', {}, { only: 挂件id })` 渲染停靠卡片）。
- **组件 props**：使用容器包导出的标准类型 `WidgetCardProps`
  （= `PropsRuntime<'widgets.card'>`，含框架全局座 `useSessions` /
  `useWorkspaces`）；需要字典时叠加 `PropsLocale<'你的NS'>` 并在注册里声明
  `locale`（与 `widgets.config` 同一套模式）。每个卡片还会收到槽级注入面
  `CardSlotInject`：`useContainer` hook（容器实时停靠/可用快照）加
  `dock` / `undock` 动词——卡片可以响应容器状态，比如「打开浮窗」按钮调
  `undock(id)`。
- **显示名**：托盘 chip 与卡片头优先读挂件在 `shell.overlay` 注册的 `label`
  （thunk，跟随当前语言）——挂件自己命名自己；未声明才回退到内置名称表 /
  raw id。
- **优先级**：注册用**默认 priority 0**——容器本身不注册任何内置卡片，挂件注册的
  卡片就是该 id 单元的胜者（也是唯一一张）；不注册就显示通用占位卡。
- **卡片规格（可选）**：卡片可以声明自己在网格里占多大——给组件设置静态
  `spec` 属性（`'small'` = 1 列，默认；`'medium'` = 2 列；`'large'` = 整行），
  容器读获胜条目的组件规格自动排版。用容器包导出的 `WidgetCardComponent` 类型
  标记：`(MyWidgetCard as WidgetCardComponent).spec = 'medium'`。不声明就是
  `'small'`。
- **数据**：卡片可以只用全局 `useSessions`（token-crit / session-monitor 各自
  注册的卡就是这么读数据的，零 Host RPC）；需要业务数据就自己接（如 balance 的
  remote），与浮窗互不干扰。

```ts
// 你的挂件包：src/client/index.ts（apply 内追加）
import type { WidgetCardProps, WidgetCardComponent } from '@dsh-plugins/client-ui-card-container/client'
import type {} from '@dsh-plugins/client-ui-card-container/client'   // 拉入 widgets.card SlotMap 合并

export function MyWidgetCard({ useSessions, undock }: WidgetCardProps) {
  const sessions = useSessions(s => s)
  // …紧凑展示…；需要恢复浮窗时调 undock('<id>')
}
// 可选：声明卡片占 2 列（不声明则 1 列）
(MyWidgetCard as WidgetCardComponent).spec = 'medium'

ctx.slots.inject('widgets.card', () => ctx.slots.register({
  name: 'widgets.card',
  id: 'clock',                       // ★ = shell.overlay 的 id
  order: 0,
  priority: 0,                       // 默认 0：容器不注册内置卡，本卡即该 id 单元的卡片
  // locale: 'clock',                // 需要 t 时声明
}, MyWidgetCard))
```

**浮窗快捷停靠（可选）**：给浮动面板加一个「放入容器」按钮，dispatch
`window` 事件 `dsh.card-container.dock`（detail = 挂件 id）即可——容器监听并停靠到
**当前激活分组**，容器收不下挂件时为 no-op（见下一条）。事件契约与容器包解耦，无需
import 容器包：

```ts
// 浮窗组件里（如头部工具按钮 onClick）
window.dispatchEvent(new CustomEvent('dsh.card-container.dock', { detail: 'clock' }))
```

**按钮必须按容器可用性隐藏（必做）**：上面那个请求在容器**收不下**挂件时是静默
no-op，有两种情况——容器插件没装/没挂载，或容器在**小组件管理页被「关闭」**（关闭 =
注册一条 priority -1 的影子条目赢下容器自己的 overlay 单元，容器仍然挂载、只是不
渲染）。一个点了没反应的按钮比没有按钮更糟，所以「放入容器」按钮只在容器**真正可用**
时渲染。判定不要自己另写一套：把容器包的 `src/client/container-dock.ts` 整份拷进你的
包（`balance` / `token-crit` / `session-monitor` 各有一份，`scripts/build.mjs` 断言从
`CARD_CONTAINER_ID` 起逐字节一致），在 apply 里建一个实例并放进注册的 inject
`hooks`，组件里用合成的 `useCardContainer` 选择器 hook 取值：

```ts
// apply 内（一次）：实例的台账订阅随本 fiber 销毁
import { CardContainerAvailability } from './container-dock.ts'

const cardContainer = new CardContainerAvailability(ctx)
ctx.slots.inject('shell.overlay', () => ctx.slots.register({
  name: 'shell.overlay', id: 'clock', order: 0,
  inject: (): ClockInject => ({ hooks: { cardContainer } }),
}, ClockWidget))
```

对应的组件侧（`InjectFace` 把 `hooks` 成员合成为 `useCardContainer`）：

```ts
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CardContainerAvailability } from './container-dock.ts'

interface ClockInject { hooks: { cardContainer: CardContainerAvailability } }
type ClockWidgetProps = PropsRuntime<'shell.overlay'> & InjectFace<ClockInject>

export function ClockWidget(props: ClockWidgetProps) {
  // hook 必须无条件调用（不要放进 if / 分支）
  const cardContainerReady = props.useCardContainer((available) => available)
  // JSX：{cardContainerReady && <button onClick={dock}>⤢</button>}
}
```

探针读的是 overlay 台账里 `card-container` 单元的胜者
（`entriesOfSlot('shell.overlay')`）——与容器控制器自己判断「我被关闭了、释放全部
停靠影子」用的是同一个投影，所以按钮和容器永远不会互相矛盾；管理页上实时开关也无需
刷新即可跟随。**注意**：拷贝文件时只有模块 docblock 的 `@module` 行可以不同。

**容器侧交互（挂件无需感知）**：
- **多分组**：容器顶部分组标签切换；一个挂件同一时刻只能停靠在一个分组。
  **把卡片拖到另一个分组标签上松手 = 跨组移动**。
- **实时换位**：拖动卡片 = 幽灵跟随 + 其余卡片实时让位，网格内松手落定。
- **拖出移出**：把卡片拖出网格松手 = 移出容器（恢复浮窗）。
- **键盘**：Tab 聚焦卡片后 Enter/空格移出、方向键排序。
- **触屏**：无 hover 设备 chrome 常显，容器始终可达。

配套改动：

- **类型依赖**：`import type {}` 是 type-only（esbuild/Vite 剥离），但在
  `package.json` 的 `peerDependencies` 加
  `"@dsh-plugins/client-ui-card-container": "workspace:*"`。
- **缺席回退**：容器未安装时 `widgets.card` 不被声明，`ctx.slots.inject` 回调
  永不执行——卡片不注册，无任何副作用。

### 2.6 浮窗必须避让桌面端窗口 chrome

官方桌面端（Electron）在同一个文档里画自己的窗口 chrome，并在 `<html>` 上公布它占用的
竖带 `--dsh-frame-top-clearance`：macOS 48px（红绿灯 + 折叠侧栏的窗口控件）、Windows 40px
（标题条，带「应用/编辑」菜单、侧栏控件与原生窗口按钮，同时整条都是
`-webkit-app-region: drag` 拖动带）。**默认 `top: 16px` 的浮窗会钻到这条带下面**；在
Windows 上更糟——点它等于拖窗口。

所以任何以 `position: fixed` 自行定位的挂件，把「顶边」的下界取
`max(自身边距, 公布的带 + 20)`，四处都要覆盖：角停靠的样式、拖动钳制、初始/持久化位置的
钳制、以及「吸附到角」的判定阈值。仓库里四个浮窗各带一份同样的实现，照抄即可：

```ts
// src/client/overlay-inset.ts（每包一份；包内相对 import，不跨包依赖）
/** Last resolved value, keyed by everything the inset depends on. */
let cachedKey = ''
let cachedInset = 0

export function overlayTopInset(fallback: number): number {
  const root = document.documentElement
  const key = `${root.dataset.platform ?? ''}|${root.hasAttribute('data-windows-titlebar')}|${fallback}`
  if (key === cachedKey) return cachedInset
  const clearance = Number.parseFloat(getComputedStyle(root).getPropertyValue('--dsh-frame-top-clearance'))
  cachedInset = Number.isFinite(clearance) ? Math.max(fallback, clearance + 20) : fallback
  cachedKey = key
  return cachedInset
}
```

> 四处调用点传入的 `fallback` 不同：**停靠位置**传自身边距（网页端停靠在 16/6px 处，
> 桌面端抬到带上），**拖动/持久化位置的钳制**与**吸附判定**传 `0`（网页端因此与改动前
> 完全一致，桌面端得到带高 + 20）。`scripts/build.mjs` 会断言四份拷贝从 `let cachedKey`
> 起逐字节相同，改一份必须同步其余三份。

要点：

- **必须缓存**：拖动是每 pointermove 一次 `getBoundingClientRect` + 钳制，再读一次
  computed style 会多一次强制样式刷新。缓存键用「平台标记 + Windows 标题条标记 + 边距」，
  这两条属性完全决定该变量的取值。
- **Web 无此变量**，`Number.parseFloat` 得 `NaN` → 原样返回自身边距，网页端行为不变。
- **不要改用壳的 `--dsh-frame-overlay-top`**：它全屏时降到 20px，而 Windows 的标题条菜单与
  macOS 折叠侧栏的窗口控件是全屏也仍在的 `position: fixed` 元素，20px 会把浮窗压在它们
  下面。
- 底部停靠不受影响；默认位置除卡片容器是左上（`DEFAULT_LEFT/DEFAULT_TOP = 16/96`）外，
  其余三个浮窗都在右下（`bottom`/`right`）。
- 浮窗内部自己的 `z-index` 再大也翻不过壳的浮层（`shell.overlay` 层是 `z-index: 20` 的
  层叠上下文，Modal 1000、平台页 1001、Windows 菜单 1100 都在其上）——不要试图对抗。
- 浮窗根节点不要声明拖动区（不要设 `data-window-drag`、不要写
  `-webkit-app-region: drag`）：拖动区的组合规则按 DOM 顺序取第一个声明者，内容容器从来
  不是拖动区。

### 2.7 配置项只显示当前环境能生效的那些

同一份配置面板会出现在三种宿主环境里，**不要渲染当前环境根本无法生效的开关**——
用户打开的是「能用的配置」，不是一个点了没反应的复选框：

| 环境 | 判定 | 该环境里能生效的典型东西 |
|---|---|---|
| `web` | 默认（既无 `__TAURI__` 也无 `dshDesktop`）：`dsh web` 的浏览器标签页；Tauri 挂件只连这个部署（127.0.0.1:3080） | 拉起/控制自建 Tauri 挂件的开关、桌面 inbox 的已读策略 |
| `official-desktop` | `window.dshDesktop`（官方 Electron 壳在 `dsh-app://app/` 下暴露） | 只有渲染进程里的东西；没有第二个进程可拉起 |
| `tauri` | `window.__TAURI__`（自建 Tauri 小窗的 WebView） | 挂件页自己的设置；浮窗/看板那套配置面板在此不渲染 |

判定用**每包一份**的 `src/client/environment.ts`（与 `overlay-inset.ts` 同一套「包独立
发布，不跨包依赖」的先例）：`detectEnvironment()` 给出上面的三值，另有 API 能力探针
`supportsSystemNotifications()` / `supportsAudioChime()`。面板里第一行就取好判定，
渲染时按它过滤：

```tsx
// src/client/SessionSettings.tsx（session-monitor 的实际写法）
import { detectEnvironment, supportsAudioChime, supportsSystemNotifications } from './environment.ts'

const environment = detectEnvironment()
const officialDesktop = environment === 'official-desktop'
/** 自建 Tauri 挂件只连网页版部署，它的三项设置只在 web 有意义。 */
const companionRows = environment === 'web'
const canNotify = supportsSystemNotifications()   // 缺失 → 整行不渲染
const canChime = supportsAudioChime()
…
{canChime && <Row label={t('soundLabel')}>…</Row>}
{(officialDesktop || companionRows) && (
  <Section title={t('sectionDesktop')}>
    {officialDesktop
      ? <div className={css.desktopHint}>{t('desktopNativeHint')}</div>
      : <>{/* 三项 Tauri 专属行 */}</>}
  </Section>
)}
```

规则：

- **该藏就藏，但别让用户猜**：整段配置在当前环境完全无意义时直接不渲染该段；只缺其中
  一两项、或需要解释替代方案时（官方桌面端就是这种情况），保留一句说明文案比整块消失
  更好。
- **能力探针缺失就省略整行**（连它旁边的权限提示行一起省略）：一个永远打不开的开关
  比没有这个选项更糟。权限「被拒」不算缺失（要保留授权引导）。
- **文案也可以按环境切换**：小组件管理页的安装指引按壳选 `installStep*NoteWeb` /
  `installStep*NoteDesktop`（profile 名与重启方式不同）。
- **拷贝必须逐字节一致**（只有模块 docblock 可不同），`scripts/build.mjs` 会扫描
  `packages/*/src/client/environment.ts` 并在漂移时让构建失败；少于两份拷贝时构建也会
  直接失败（否则这道防线会被静默拆掉）。新增第三个拷贝时无需改脚本，但**新增后要自己
  核对**它与其他拷贝从 `/** Which shell hosts this page. */` 起完全相同。
- **已知边界**：判定只看文档级桥，拿不到 host/profile 信号。用浏览器直接打开官方桌面端
  Host（`GET /` 401 后控制台打印的那条带 token 的 `127.0.0.1:19387` URL）会被判成 `web`，
  Tauri 专属行照常显示，而 companion 只连网页版部署（3080）——这是既有行为（客户端无法
  区分该 host 形态），记录即可，别为此去猜 host。

---

## 3. 完整示例：带配置面板与容器卡片的时钟挂件

假设包 `@dsh-plugins/client-ui-clock`、id `clock`，配置项为「是否显示秒针」：

```
packages/dsh-client-ui-clock/
  src/index.ts
  src/client/index.ts            # 注册 shell.overlay(clock) + widgets.config(clock)
  src/client/ClockWidget.tsx     # 浮层时钟
  src/client/ClockSettings.tsx   # 配置面板（勾选显示秒针）
  src/client/locales.ts          # NS clock：title/secondsLabel/...
  src/client/ClockWidget.module.css / ClockSettings.module.css
  src/css-modules.d.ts
```

```ts
// src/client/index.ts（合并 1.1 + 2.4 的要点）
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@dsh-plugins/client-ui-widget-manager/client'   // widgets.config 类型
import { ClockWidget } from './ClockWidget.tsx'
import { ClockSettings } from './ClockSettings.tsx'
import { en, zh } from './locales.ts'
import type { ClockKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { clock: ClockKey }
}

const NS = 'clock'
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'clock: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'clock', order: 80, locale: NS,
    inject: () => ({ refresh: () => {} }),
  }, ClockWidget))

  ctx.slots.inject('widgets.config', () => ctx.slots.register({
    name: 'widgets.config', id: 'clock', order: 0,
    inject: () => ({ t }),
  }, ClockSettings))
}
```

```tsx
// src/client/ClockSettings.tsx — 配置面板（弹窗内容，自包含）
export interface ClockSettingsInjected { t: TranslateNS<'clock'> }
export function ClockSettings({ t }: ClockSettingsInjected) {
  return (
    <form>
      <label>
        <input type="checkbox" defaultChecked onChange={(e) => {
          localStorage.setItem('dsh.clock.showSeconds', String(e.target.checked))
        }} />
        {t('secondsLabel')}
      </label>
    </form>
  )
}
```

```ts
// src/client/locales.ts（NS clock）
export type ClockKey = 'title' | 'secondsLabel'
export const zh: Record<ClockKey, string> = { title: '时钟', secondsLabel: '显示秒针' }
export const en: Record<ClockKey, string> = { title: 'Clock', secondsLabel: 'Show seconds' }
```

效果：面板列表出现「时钟（@dsh-plugins/client-ui-clock，已启用）」行，右侧有
**配置**与**关闭**按钮；点配置弹出时钟自己的设置弹窗；点关闭后挂件消失、配置按钮
随之隐藏；再点添加恢复。

---

## 4. 发布前检查清单

- [ ] `pnpm build` 通过，`lib/index.js`（Host stub）与 `lib/client.js`（ModuleLoader CJS + 内联 CSS）就位
- [ ] `package.json`：`dsh.client`、`exports["./client"]`、`files: ["lib"]`、
      `publishConfig.access: "public"`、版本与其他包一致、配置槽依赖已加 peer
- [ ] 注册 `shell.overlay`（id 唯一稳定）+ 需要时注册 `widgets.config`
- [ ] 若要在卡片容器里显示自己的紧凑卡片：按第 2.5 节注册 `widgets.card`
      （id = `shell.overlay` id、priority 默认 0），并在 peerDependencies 加
      `@dsh-plugins/client-ui-card-container`（type-only）
- [ ] **目录登记（必做）**：`widgets.ts` + `locales.ts` 键（未登记则管理页不列出）
      + `COMPONENTS.md` 各表更新
- [ ] 可选：`plugins.row.config` 接入官方 Plugins 页（key `<bundle 包名>#<行 id>`；
      peer 声明 `@deepseek-ai/dsh-client-ui-plugin-manager`，**不进 `dsh.client.inject`**）
- [ ] 双语 README + `README.i18n.yaml` hash 已更新
- [ ] bundle 分发：`cordis.patch.yml` 插入行 + bundle 依赖
- [ ] 若改动 `@dsh-plugins/balance` 的 Remote 线协议：重新生成 `lib/typert.*`（typert codegen）

## 5. 常见问题

- **面板里看不到我的挂件？** 插件没挂载，或没注册 `shell.overlay`（`ctx.slots.inject`
  会等槽声明，日志里查 `slots` 服务是否就绪）。
- **关闭后刷新又出现？** 检查 `shell.overlay` 的 `id` 是否改动过（关闭状态按 id 持久化）。
- **「配置」按钮不显示？** `widgets.config` 没有该 id 的条目（注册被跳过，通常是
  管理器未安装、或槽声明与注册时机/`id` 不一致）。
- **停靠进卡片容器后显示的是占位卡而不是我的卡片？** `widgets.card` 没有该 id 的
  条目——按第 2.5 节注册（注意 `id` 必须与 `shell.overlay` 一致；容器未安装时注册
  会被跳过，属正常行为）。诊断提示：渲染器只会为「没有胜出者」的 id 产出占位，且
  卡片组件抛错时它渲染的是 `div[data-slot-error]`（不是容器的 `cardMissing` 兜底卡），
  所以看到 `data-slot-error` 说明是注册 id 不匹配或卡片自身出错，而不是容器没兜底。
- **卡片尺寸不对（想占 2 列/整行）？** 给卡片组件设置静态 `spec` 属性
  （`'small'` / `'medium'` / `'large'`），见第 2.5 节「卡片规格」。
- **弹窗样式和主题不一致？** 用 `--dsw-alias-*` 语义令牌（面板弹窗：
  `--dsw-alias-bg-layer-2` + `--dsw-shadow-lv3` + `--dsw-alias-bg-mask-1`）。
- **改了余额插件的 Remote 线协议？** `lib/typert.*` 是 typert codegen 产物，`pnpm build`
  不重建，需要重新生成（不要手工编辑）。

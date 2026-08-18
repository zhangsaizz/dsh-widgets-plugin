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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 shell.overlay 槽的类型合并（ui-layout 声明）。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
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
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-locale"
      ],
      "platform": "web"
    }
  },
  "files": ["lib"],
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-ui-layout": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-locale": "^0.1.0-rc.7",
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

### 2.2 更好的展示：登记目录（可选但推荐）

不登记也能被管理（显示为通用行：原始 id + 包名）。要让列表显示友好名称/描述，
在面板包的 `src/client/widgets.ts` 目录里登记，并在 `locales.ts`（NS `widgets`）补两个键：

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
- **优先级**：注册用**默认 priority 0**——容器自带的内置兜底视图在 priority 10，
  挂件自己的卡片一注册就赢下该单元；不注册就显示占位卡。
- **卡片规格（可选）**：卡片可以声明自己在网格里占多大——给组件设置静态
  `spec` 属性（`'small'` = 1 列，默认；`'medium'` = 2 列；`'large'` = 整行），
  容器读获胜条目的组件规格自动排版。用容器包导出的 `WidgetCardComponent` 类型
  标记：`(MyWidgetCard as WidgetCardComponent).spec = 'medium'`。不声明就是
  `'small'`。
- **数据**：卡片可以只用全局 `useSessions`（token-crit / session-monitor 的
  内置卡就是这么读数据的，零 Host RPC）；需要业务数据就自己接（如 balance 的
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
  priority: 0,                       // 默认 0：优先于容器内置兜底（10）
  // locale: 'clock',                // 需要 t 时声明
}, MyWidgetCard))
```

**浮窗快捷停靠（可选）**：给浮动面板加一个「放入容器」按钮，dispatch
`window` 事件 `dsh.card-container.dock`（detail = 挂件 id）即可——容器监听并停靠到
**当前激活分组**，未挂载时为 no-op。事件契约与容器包解耦，无需 import 容器包：

```ts
// 浮窗组件里（如头部工具按钮 onClick）
window.dispatchEvent(new CustomEvent('dsh.card-container.dock', { detail: 'clock' }))
```

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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
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
- [ ] 目录登记（`widgets.ts` + `locales.ts` 键）+ `COMPONENTS.md` 各表更新
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
  会被跳过，属正常行为）。
- **卡片尺寸不对（想占 2 列/整行）？** 给卡片组件设置静态 `spec` 属性
  （`'small'` / `'medium'` / `'large'`），见第 2.5 节「卡片规格」。
- **弹窗样式和主题不一致？** 用 `--dsw-alias-*` 语义令牌（面板弹窗：
  `--dsw-alias-bg-layer-2` + `--dsw-shadow-lv3` + `--dsw-alias-bg-mask-1`）。
- **改了余额插件的 Remote 线协议？** `lib/typert.*` 是 typert codegen 产物，`pnpm build`
  不重建，需要重新生成（不要手工编辑）。

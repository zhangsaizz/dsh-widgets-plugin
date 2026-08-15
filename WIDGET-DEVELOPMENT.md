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
    order: 80,          // 浮层列表中的排序（balance=100、token-crit=50）
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

`locales.ts` 声明字典键并给出 zh/en 文案（照抄 `client-ui-balance/src/client/locales.ts` 的结构）。

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
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-client-ui-layout": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-client-locale": "^0.1.0-rc.5",
    "react": "^18.2.0"
  }
}
```

### 1.4 构建与分发

在 `scripts/build.mjs` 照抄「Token-crit client bundle」段，产出 `lib/client.js`
（ModuleLoader CJS + 内联 CSS）：

```js
{
  const pkg = 'packages/dsh-client-ui-clock'
  run(pkg, [
    'src/client/index.ts',
    '--bundle', '--format=cjs', '--platform=browser', '--target=es2022',
    '--jsx=automatic',
    '--loader:.css=local-css',
    ...EXTERNAL.flatMap((e) => ['--external:' + e]),
    '--outfile=lib/client.cjs', '--log-level=warning',
  ])
  // ...读 lib/client.css，包进 ModuleLoader factory（照抄现有段落）...
}
```

若随 bundle 分发：在 `bundles/dsh-balance-bundle/package.json` 的 dependencies 加
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
  是 type-only（esbuild 会剥离，无运行时 require），但在 `package.json` 的
  `peerDependencies` 加 `"@dsh-plugins/client-ui-widget-manager": "workspace:*"`。
- **配置组件自包含**：弹窗里只注入它自己的面（如 `t` / hooks / 动作），数据读写
  自己负责（BalanceSettings 就是自己 fetch `/_dsh/balance/settings`）。
- **缺席回退**：管理器未安装时 `widgets.config` 不被声明，`ctx.slots.inject`
  的回调永不执行——配置面板自然不注册，不会报错。若你的挂件被单独安装
  （无管理器）时配置必须可用，需要保留另一条配置入口并文档说明。

---

## 3. 完整示例：带配置面板的时钟挂件

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
- [ ] 目录登记（`widgets.ts` + `locales.ts` 键）+ `COMPONENTS.md` 各表更新
- [ ] 双语 README + `README.i18n.yaml` hash 已更新
- [ ] bundle 分发：`cordis.patch.yml` 插入行 + bundle 依赖
- [ ] 若改动同步自 harness 的包：标注「本地改动」，`pnpm sync` 后重新应用

## 5. 常见问题

- **面板里看不到我的挂件？** 插件没挂载，或没注册 `shell.overlay`（`ctx.slots.inject`
  会等槽声明，日志里查 `slots` 服务是否就绪）。
- **关闭后刷新又出现？** 检查 `shell.overlay` 的 `id` 是否改动过（关闭状态按 id 持久化）。
- **「配置」按钮不显示？** `widgets.config` 没有该 id 的条目（注册被跳过，通常是
  管理器未安装、或槽声明与注册时机/`id` 不一致）。
- **弹窗样式和主题不一致？** 用 `--dsw-alias-*` 语义令牌（面板弹窗：
  `--dsw-alias-bg-layer-2` + `--dsw-shadow-lv3` + `--dsw-alias-bg-mask-1`）。
- **改了 harness 同步包的代码？** `pnpm sync` 会覆盖，务必在代码/README 标注并同步后重打补丁。

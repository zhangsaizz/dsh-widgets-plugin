# @dsh-plugins/client-ui-card-container

A floating **card container** widget for the DeepSeek Harness web UI: it docks
other `shell.overlay` widgets into one tidy, evenly-gapped card grid, so your
dashboards stop fighting for screen corners.

English | [中文](README.zh.md)

## What it does

- Registers a floating container panel into `shell.overlay` (id
  `card-container`). Enable it from the **Widgets** manager page.
- **Multi-group**: the container holds several named groups (each with its own
  docked set). A tab bar switches between them; the manage button (⋯) creates,
  renames or deletes groups. A widget can be docked in only one group at a
  time. Dragging a card over another group's tab and releasing moves it there.
- The **tray** lists every widget currently enabled in the overlay (balance,
  token-crit, session-monitor, …). Drag a chip into the grid (or click it) to
  **dock** the widget into the active group.
- Docking hides the widget's floating panel (a shadow entry wins its overlay
  cell — the same mechanism the Widgets manager uses to disable widgets) and
  renders the widget's compact **card view** inside the grid. Undock (the ×
  button, or dragging the card out of the grid) restores the floating panel.
- Cards reorder **live**: dragging a card lifts it into a ghost that follows
  the pointer while the remaining cards shuffle in real time; releasing inside
  the grid persists the order, releasing **outside** the grid undocks it.
- Keyboard: focus a card (Tab), Enter/Space undocks, arrow keys reorder.
- The grid uses a consistent gap (12px) and auto-fills or fixes the column
  count (configurable), so cards always line up evenly.
- The container panel / docked cards / collapsed pill / group menu use a
  **liquid-glass** material — the same recipe as the rainbow-flow input box
  (translucent white glass gradient + light frosted backdrop blur + 1 px edge
  reflections + soft drop shadow, with theme-aware dark/light glass
  palettes).
- Docked order, active group, groups and the panel position persist across
  reloads.
- Touch devices (no hover): the chrome stays fully visible so the dock remains
  reachable.
- While the container itself is disabled (hidden by the Widgets manager), the
  dock shadows are released so the widgets float again; re-enabling the
  container restores the dock from the persisted groups.

## Card views (adapter contract)

The container declares the `widgets.card` child slot as a **standard, optional
adapter contract**: a widget's own package can provide its compact card view by
registering into that slot (id = the widget's `shell.overlay` id, default
priority 0). The container renders the docked widget's card through
`renderSlot('widgets.card', {}, { only: id, fallback })`. Registering is
strictly optional — without a registration the container shows a generic
placeholder card.

```ts
// In your widget package's client apply (type-only import; add
// "@dsh-plugins/client-ui-card-container" to peerDependencies):
import type { WidgetCardProps, WidgetCardComponent } from '@dsh-plugins/client-ui-card-container/client'
import type {} from '@dsh-plugins/client-ui-card-container/client'

export function MyWidgetCard({ useSessions, undock }: WidgetCardProps) { /* … */ }
// Optional: declare the card's grid footprint ('small' = 1 column, default;
// 'medium' = 2 columns; 'large' = full row).
(MyWidgetCard as WidgetCardComponent).spec = 'medium'

ctx.slots.inject('widgets.card', () => ctx.slots.register({
  name: 'widgets.card',
  id: 'my-widget',       // must equal the shell.overlay id
  order: 0, priority: 0, // default 0 wins over the container's built-ins (10)
  // locale: 'my-widget', // optional: declares the `t` seat
}, MyWidgetCard))
```

`WidgetCardProps` = `PropsRuntime<'widgets.card'>` (the framework's global
`useSessions` / `useWorkspaces` seat) plus the slot-level inject face
`CardSlotInject` — the `useContainer` hook (live dock/available snapshot) and
the `dock` / `undock` verbs, so a card can act on the container (e.g. restore
its floating panel). Extend with `PropsLocale<'your-ns'>` when the card declares
a locale. The optional static `spec` (`WidgetCardComponent`) sizes the card in
the grid. See `WIDGET-DEVELOPMENT.md` §2.5 for the full contract.

**Quick-dock from floating panels**: a floating widget can dispatch the
container's dock-request window event (`detail` = its `shell.overlay` id) to
dock itself — decoupled, no-op when the container is absent:
`window.dispatchEvent(new CustomEvent('dsh.card-container.dock', { detail: 'my-widget' }))`.

This package ships built-in fallback views (at priority 10, so a widget's own
card at priority 0 wins when present):

| Widget | Built-in card | Size |
|---|---|---|
| `token-crit` | Compact token-usage stat (current session) | small |
| `session-monitor` | Compact busy-session count | medium |
| `balance` | Generic card (full view lives in the floating dashboard) | large |

## Usage

From the **小组件管理** (Widgets) settings page, click **添加** on the
**卡片容器** row. The panel appears (top-left by default; drag the header to
move it). Drag tray chips into the grid to dock, drag cards to reorder, click
× to undock, and use **配置** to change the column count or reset the layout.

## Development

- Pure client UI plugin: `src/index.ts` is an empty host apply; the browser
  half lives in `src/client/`.
- State: groups (`dsh-plugins.card-container.groups`), active group
  (`dsh-plugins.card-container.active`), panel position
  (`dsh-plugins.card-container.pos`) and settings (`dsh-plugins.card-container.settings`)
  persist to localStorage (the legacy single `docked` list migrates into the
  default group); config changes are announced via a window `CustomEvent`
  (`dsh.card-container.settings-changed`).
- The controller (`src/client/controller.ts`) owns the dock shadows
  (priority -2, registrant `card-container`), the group CRUD / switching, the
  available-widget tray projection and the self-healing reconcile against the
  overlay ledger.

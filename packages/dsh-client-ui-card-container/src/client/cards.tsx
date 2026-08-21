/**
 * Card view ADAPTER CONTRACT for the card container.
 *
 * Any widget package can OPT IN to providing its own compact card view inside
 * the container's grid. The integration is purely client-side and additive:
 *
 *  - Slot: `widgets.card` (list, root scope), DECLARED by the card container.
 *    Register into it via `ctx.slots.inject('widgets.card', …)` — the callback
 *    runs whenever the container is mounted, and silently skips when it is not
 *    (the container is the only renderer of this slot).
 *  - Entry id: MUST equal the widget's `shell.overlay` registration id (the
 *    container renders a docked widget's card with `{ only: widgetId }`).
 *  - Component props: this module's `WidgetCardProps` — the framework's global
 *    standard seat (`useSessions` / `useWorkspaces`, available on every slot
 *    component), optionally extended with `PropsLocale<'your-ns'>` when the
 *    registration declares a `locale` (same pattern as `widgets.config`).
 *    Every card ALSO receives the slot-level inject face `CardSlotInject`:
 *    the `useContainer` hook (live dock/available snapshot) and the `dock` /
 *    `undock` verbs — a card can react to container state and, e.g., restore
 *    its floating panel via `undock(id)`.
 *  - Priority: register at the DEFAULT 0 — the container's built-in fallback
 *    views sit at priority 10, so a widget's own card always wins the cell
 *    when it exists; without any registration the container shows a generic
 *    placeholder card. Registration is therefore strictly OPTIONAL.
 *
 * Example (in the widget package's client apply):
 * ```ts
 * import type {} from '@dsh-plugins/client-ui-card-container/client'
 * ctx.slots.inject('widgets.card', () => ctx.slots.register({
 *   name: 'widgets.card',
 *   id: 'my-widget',          // = shell.overlay id
 *   order: 0, priority: 0,    // default priority 0 wins over the built-ins (10)
 *   locale: 'my-widget',      // optional: declares the `t` seat
 * }, MyWidgetCard))
 * ```
 *
 * CARD SIZE SPEC: a card may declare how much of the grid it occupies by
 * setting a static `spec` property on its component ('small' = one column,
 * 'medium' = two columns, 'large' = the full row). The container reads the
 * winning entry's component spec and sizes the cell accordingly — cards
 * without a spec default to 'small'. Typed via {@link WidgetCardComponent}:
 * ```ts
 * import type { WidgetCardComponent } from '@dsh-plugins/client-ui-card-container/client'
 * export function MyWidgetCard(props: WidgetCardProps) { … }
 * (MyWidgetCard as WidgetCardComponent).spec = 'medium'
 * ```
 *
 * The card container package ships NO built-in card views — it is generic.
 * Each widget that provides a compact card registers it into `widgets.card`
 * at priority 0 in its own package (token-crit, session-monitor, balance all
 * do). A widget that ships no card falls back to the generic placeholder.
 */

import type { PropsRuntime, SlotComponent, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CardContainerKey } from './locales.ts'

/** Standard composed props for any `widgets.card` entry: the framework's
 *  global standard seat (`useSessions` / `useWorkspaces`). Extend with
 *  `PropsLocale<'your-ns'>` (and declare `locale:` in the registration) when
 *  the card needs its own dictionary. */
export type WidgetCardProps = PropsRuntime<'widgets.card'>

/** Card grid size spec: 'small' = one column (default), 'medium' = two
 *  columns, 'large' = the full grid row. Declared as a static `spec` property
 *  on the card component (see {@link WidgetCardComponent}). */
export type CardSpec = 'small' | 'medium' | 'large'

/** A widget card component, optionally carrying its declared grid size. */
export interface WidgetCardComponent<P = WidgetCardProps> extends SlotComponent<P> {
  /** Declared grid size of this card; defaults to 'small' when absent. */
  spec?: CardSpec
}

/** Read the declared grid size of a widget's card (the winning `widgets.card`
 *  entry's component static), defaulting to 'small'. */
export function cardSpecOf(ctx: ClientContext, id: string): CardSpec {
  try {
    const winner = ctx.slots.entriesOfSlot('widgets.card')
      .find((entry) => entry.options.id === id)
    const spec = (winner?.component as WidgetCardComponent | undefined)?.spec
    return spec ?? 'small'
  } catch {
    return 'small'
  }
}


/** Built-in display names for the known widget ids (falls back to the raw id).
 *  Used ONLY for the container's own built-in fallback cards (balance) and the
 *  tray chips — a widget that registers a `label` on its shell.overlay entry
 *  shows that label instead (see labelOf in index.ts). */
const NAME_KEYS: Record<string, CardContainerKey> = {
  balance: 'widgetBalance',
  'token-crit': 'widgetTokenCrit',
  'session-monitor': 'widgetSessionMonitor',
}

/** Resolve a widget's display name: the built-in map, else the raw id. Used
 *  by the container for chips/headers; a widget's own `label` registration
 *  wins (see `widgetLabelOf` below). */
export function widgetName(id: string, t: TranslateNS<'card-container'>): string {
  const key = NAME_KEYS[id]
  return key !== undefined ? t(key) : id
}

/** Resolve a widget's display label, preferring the widget's OWN registered
 *  `shell.overlay` label (a thunk following the active locale) — the standard
 *  way for third-party widgets to name themselves in the container. Falls back
 *  to the built-in name map, then the raw id. */
export function widgetLabelOf(ctx: ClientContext, id: string, t: TranslateNS<'card-container'>): string {
  try {
    const entry = ctx.slots.entries('shell.overlay')
      .find((e) => e.options.id === id)
    const label = entry !== undefined
      ? resolveSlotLabel(entry.options.label)
      : undefined
    if (label !== undefined && label !== '') return label
  } catch { /* ledger read failed — fall through */ }
  return widgetName(id, t)
}

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
 * The card container package ships built-in fallback views for the project's
 * known widgets (token-crit, session-monitor, balance-generic) registered at
 * priority 10 — they are REPLACED the moment the owning package registers its
 * own card, and other widgets fall back to the generic placeholder.
 */

import type { PropsLocale, PropsRuntime, SlotComponent, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { CardContainerKey } from './locales.ts'
import css from './CardContainerWidget.module.css'

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

/** Compact number formatting (1.2K / 3.4M / 1.1B). */
function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

/** Cumulative token-usage projection value (from the token-meter). */
interface TokenUsage {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Select the current session's token usage (mirrors the token-crit widget).
 *  `projectionValues` is typed `Partial<SessionProjectionMap>` whose declared
 *  keys don't include `tokenUsage` — read through the projection-value record
 *  like the token-crit widget does. */
function selectUsage(s: SessionListState): TokenUsage | undefined {
  const cid = s.current
  if (!cid) return undefined
  const byId = s.byId as Readonly<Record<string, SessionSummary>>
  const entry = byId[cid]
  if (!entry || !entry.projectionValues) return undefined
  const values = entry.projectionValues as Record<string, unknown>
  return values.tokenUsage as TokenUsage | undefined
}

/** Compact token-usage card for the token-crit widget. */
export function TokenCritCard(props: PropsRuntime<'widgets.card'> & PropsLocale<'card-container'>) {
  const { useSessions, t } = props
  const usage = useSessions(selectUsage)
  const input = usage
    ? (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    : 0
  const output = usage ? (usage.outputTokens ?? 0) : 0
  const total = input + output
  return (
    <div className={css.statCard}>
      <span className={css.statValue}>{compact(total)}</span>
      <span className={css.statLabel}>{t('cardTokenLabel')}</span>
      <span className={css.statMeta}>
        {t('cardTokenIn', { n: compact(input) })} · {t('cardTokenOut', { n: compact(output) })}
      </span>
    </div>
  )
}
// One-column compact stat.
(TokenCritCard as WidgetCardComponent).spec = 'small'

/** Select the live session-list snapshot for the session-monitor card. */
function selectSessions(s: SessionListState): SessionListState {
  return s
}

/** Compact busy-count card for the session-monitor widget (running or busy). */
export function SessionMonitorCard(props: PropsRuntime<'widgets.card'> & PropsLocale<'card-container'>) {
  const { useSessions, t } = props
  const sessions = useSessions(selectSessions)
  // byId is keyed by SessionId (a branded string); index through a plain view.
  const byId = sessions.byId as Readonly<Record<string, SessionSummary>>
  const busy = sessions.ids.filter((id) => {
    const row = byId[id]
    if (!row || row.blank) return false
    if (row.running) return true
    if (row.pendingInteraction !== undefined) return true
    return false
  }).length
  return (
    <div className={css.statCard}>
      <span className={css.statValue}>{busy}</span>
      <span className={css.statLabel}>{t('cardBusyLabel')}</span>
      <span className={css.statMeta}>{t('cardSessionMeta', { n: String(sessions.ids.length) })}</span>
    </div>
  )
}
// Two-column medium stat.
(SessionMonitorCard as WidgetCardComponent).spec = 'medium'

/** Generic card body for a widget without a compact view. */
export function GenericCard({ name, hint }: { name: string; hint: string }) {
  return (
    <div className={css.genericCard}>
      <span className={css.genericName}>{name}</span>
      <span className={css.genericHint}>{hint}</span>
    </div>
  )
}

/** Built-in balance card: generic body (no remote wiring — full view lives in
 *  the floating dashboard, which is hidden while docked). */
export function BalanceCard(props: PropsRuntime<'widgets.card'> & PropsLocale<'card-container'>) {
  const { t } = props
  return <GenericCard name={widgetName('balance', t)} hint={t('cardMissing')} />
}
// Full-row large card.
(BalanceCard as WidgetCardComponent).spec = 'large'

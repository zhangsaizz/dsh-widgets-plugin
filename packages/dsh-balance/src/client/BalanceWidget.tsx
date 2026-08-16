/**
 * The balance dashboard widget: a floating, zoomable, snap-dockable panel
 * registered into the shell.overlay list. Pure presentation: balance data
 * arrives through the inject useBalance hook, and the zoom/dock/collapse
 * choices ride the declared view store. The amount rolls between observations
 * and the trend arrow colors up/down from the Host-computed delta.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { BalanceAccount, BalanceListEntry, BalanceQueryResult, BalanceTrend } from '../types.ts'
import type { BalanceController, BalanceViewState } from './controller.ts'
import { MAX_SCALE, MIN_SCALE } from './store.ts'
import type { createBalanceViewStore } from './store.ts'
import type { DockCorner } from './store.ts'
import css from './BalanceWidget.module.css'

/** Injected business face: the live balance source and the manual refresh verb. */
export interface BalanceInject {
  hooks: { balance: BalanceController }
  refresh: () => void
}

/** Full composed props for the widget (runtime + store + inject + locale shares). */
export type BalanceWidgetProps =
  & PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createBalanceViewStore>>
  & InjectFace<BalanceInject>
  & PropsLocale<'balance'>

/** Distance from a viewport corner that triggers a snap, in px. */
const SNAP_THRESHOLD = 56
/** Fixed inset from the viewport edge while docked, in px. */
const DOCK_INSET = 16
/** How long the collapsed pill keeps showing a changed other provider. */
const HIGHLIGHT_MS = 3000

/** Format one amount with up to four decimals, trailing zeros stripped. */
function formatAmount(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, '')
}

/** Trend glyph: up/down arrows, a muted dash for flat, nothing for unknown. */
function trendGlyph(trend: BalanceTrend): string | null {
  if (trend === 'up') return '▲'
  if (trend === 'down') return '▼'
  if (trend === 'flat') return '–'
  return null
}

/** Narrow the view to the resolved ok account, or null. */
function resolvedAccount(view: BalanceViewState): BalanceAccount | null {
  const account = view.result?.account
  if (view.result?.bound === true && account?.status === 'ok') return account
  return null
}

/** Position style for one dock corner (or the free position). */
function positionStyle(dock: DockCorner, position: { x: number; y: number }): CSSProperties {
  switch (dock) {
    case 'top-left': return { top: DOCK_INSET, left: DOCK_INSET }
    case 'top-right': return { top: DOCK_INSET, right: DOCK_INSET }
    case 'bottom-left': return { bottom: DOCK_INSET, left: DOCK_INSET }
    case 'bottom-right': return { bottom: DOCK_INSET, right: DOCK_INSET }
    case 'free': return { left: position.x, top: position.y }
  }
}

/** Transform origin matching the anchor corner, so zoom grows toward the docked edge. */
function transformOrigin(dock: DockCorner): string {
  switch (dock) {
    case 'top-right': return 'top right'
    case 'bottom-left': return 'bottom left'
    case 'bottom-right': return 'bottom right'
    default: return 'top left'
  }
}

/** Tween toward a new target on change; the dynamic rolling of the balance amount. */
function useAnimatedNumber(target: number, enabled: boolean): number {
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    if (!enabled) {
      fromRef.current = target
      setDisplay(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    const start = performance.now()
    const duration = 700
    let frame = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (target - from) * eased)
      if (t < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
  }, [target, enabled])
  return display
}

/** Direction indicator for the Host-computed trend. */
function TrendArrow(props: { trend: BalanceTrend }) {
  const glyph = trendGlyph(props.trend)
  if (glyph === null) return null
  return <span className={css.trend} data-trend={props.trend} aria-label={props.trend}>{glyph}</span>
}

/** The balance panel body for one view, rendering the state or the rolling amount. */
function BalanceBody(props: {
  view: BalanceViewState
  animated: number
  t: TranslateNS<'balance'>
}) {
  const { view, animated, t } = props
  if (view.phase === 'no-session') return <span className={css.note}>{t('noSession')}</span>
  if (view.phase === 'loading' && view.result === null) return <span className={css.note}>{t('loading')}</span>
  if (view.provider === null || view.result === null) return <span className={css.note}>{t('noModel')}</span>
  const account = view.result.account
  if (!view.result.bound || account === undefined) return <span className={css.note}>{t('unbound')}</span>
  switch (account.status) {
    case 'unconfigured': return <span className={css.note}>{t('unconfigured')}</span>
    case 'unsupported': return <span className={css.note}>{t('unsupported')}</span>
    case 'error': return <span className={css.note}>{account.errorMessage ?? t('error')}</span>
    case 'ok':
      return (
        <span className={css.amountRow}>
          <span className={css.amount} data-trend={account.trend}>{formatAmount(animated)}</span>
          <span className={css.currency}>{account.currency}</span>
          <TrendArrow trend={account.trend} />
        </span>
      )
  }
}

/** Multi-account body: one row per bound provider, current provider pinned first. */
function AccountList(props: {
  accounts: readonly BalanceListEntry[] | null
  currentResult: BalanceQueryResult | null
  t: TranslateNS<'balance'>
}) {
  const { accounts, currentResult, t } = props
  const currentProvider = currentResult?.provider ?? null
  const rows: BalanceListEntry[] = []
  for (const entry of accounts ?? []) {
    if (entry.bound && entry.account !== undefined && entry.account.status === 'ok') rows.push(entry)
  }
  // The current account must always be visible: the Host binding table may not
  // contain its route (a custom pi-ai provider name), so merge the single-query
  // result in when the listing lacks it.
  if (currentResult !== null && currentResult.bound && currentResult.account !== undefined
    && currentResult.account.status === 'ok'
    && !rows.some(entry => entry.provider === currentProvider)) {
    rows.push({ provider: currentResult.provider, bound: true, account: currentResult.account })
  }
  if (rows.length === 0) {
    return <span className={css.note}>{accounts === null ? t('loading') : t('noAccounts')}</span>
  }
  const ordered = [...rows].sort((left, right) => {
    if (left.provider === currentProvider) return -1
    if (right.provider === currentProvider) return 1
    return 0
  })
  return (
    <div className={css.accountList}>
      {ordered.map((entry) => {
        const account = entry.account
        if (account === undefined) return null
        const isCurrent = entry.provider === currentProvider
        return (
          <div key={entry.provider} className={css.accountRow} data-current={isCurrent || undefined}>
            <span className={css.accountName} title={entry.provider}>
              <span className={css.accountVendor}>{account.displayName}</span>
              {account.label !== '' && account.label.toLowerCase() !== account.displayName.toLowerCase()
                ? <span className={css.accountLabel}>{account.label}</span>
                : null}
              {isCurrent ? <span className={css.accountCurrent}>{t('current')}</span> : null}
            </span>
            {account.status === 'ok' ? (
              <>
                <span className={css.accountValue} data-trend={account.trend}>{formatAmount(account.total)}</span>
                <span className={css.accountCurrency}>{account.currency}</span>
                <TrendArrow trend={account.trend} />
              </>
            ) : (
              <span className={css.accountStatus} data-status={account.status}>
                {account.status === 'unconfigured' ? t('unconfigured')
                  : account.status === 'unsupported' ? t('unsupported')
                    : account.errorMessage ?? t('error')}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The floating balance widget. */
export function BalanceWidget(props: BalanceWidgetProps) {
  const { useBalance, useStore, actions, refresh, t } = props
  const view = useBalance(s => s)
  const settings = useStore(s => s)
  const okAccount = resolvedAccount(view)
  // The collapsed pill shows the current account by default, but briefly flips
  // to a CHANGED other provider (multi-account view), then restores.
  const lastAccountsRef = useRef<readonly BalanceListEntry[] | null>(null)
  const highlightRef = useRef<{ account: BalanceAccount; until: number } | null>(null)
  const [highlightEpoch, setHighlightEpoch] = useState(0)

  useEffect(() => {
    const accounts = view.accounts
    if (accounts === null) return
    const previous = lastAccountsRef.current
    lastAccountsRef.current = accounts
    if (previous === null) return
    for (const entry of accounts) {
      if (entry.provider === view.provider) continue
      const account = entry.account
      if (account === undefined || account.status !== 'ok') continue
      const before = previous.find(prev => prev.provider === entry.provider)?.account
      const changed = before === undefined || before.status !== 'ok'
        || before.total !== account.total || before.updatedAt !== account.updatedAt
      if (!changed || (account.trend !== 'up' && account.trend !== 'down')) continue
      highlightRef.current = { account, until: Date.now() + HIGHLIGHT_MS }
      setHighlightEpoch(epoch => epoch + 1)
      break
    }
  }, [view.accounts, view.provider])

  useEffect(() => {
    const highlight = highlightRef.current
    if (highlight === null) return
    const timer = setTimeout(() => {
      highlightRef.current = null
      setHighlightEpoch(epoch => epoch + 1)
    }, Math.max(0, highlight.until - Date.now()))
    return () => { clearTimeout(timer) }
  }, [highlightEpoch])

  const pillAccount = highlightRef.current !== null ? highlightRef.current.account : okAccount
  const animated = useAnimatedNumber(pillAccount?.total ?? 0, pillAccount !== null)
  // Model-provider display name once a bound account resolves; the raw route otherwise.
  const headerLabel = view.result?.account?.displayName ?? view.provider

  const drag = useRef<DragState | null>(null)
  const frame = useRef<number | null>(null)
  const latest = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  /** Collapsed-pill gesture: a move past the threshold drags; a plain tap expands. */
  const pillDrag = useRef<PillDragState | null>(null)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Control buttons never start a drag: pointer capture on the header would
    // swallow their click. The controls container also stops propagation, so
    // this guard only protects buttons rendered elsewhere in the header.
    if ((event.target as HTMLElement).closest('button') !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.closest('[data-balance-widget]')?.getBoundingClientRect()
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: rect?.left ?? 0,
      baseY: rect?.top ?? 0,
      size: { w: rect?.width ?? 0, h: rect?.height ?? 0 },
      snap: null,
    }
    // Dragging a docked widget must break the dock first so the free position
    // takes over immediately (the corner layout ignores `position`), keeping
    // the widget under the pointer instead of jumping on release.
    if (settings.dock !== 'free') {
      if (rect !== undefined) actions.setPosition(rect.left, rect.top)
      actions.dockTo('free')
    }
  }, [actions, settings.dock])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (state === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    resolveMagneticDrag(state, latest, event.clientX - state.startX, event.clientY - state.startY)
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      const { x, y } = latest.current
      actions.setPosition(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)))
    })
  }, [actions])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    const state = drag.current
    drag.current = null
    if (state === null) return
    // A live magnetic snap wins: dock to the corner the widget was pulled to.
    // Otherwise land the final position and fall back to the release-edge call.
    if (state.snap !== null) {
      actions.setPosition(latest.current.x, latest.current.y)
      actions.dockTo(state.snap)
      return
    }
    const { x, y } = latest.current
    actions.setPosition(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)))
    const rect = event.currentTarget.closest('[data-balance-widget]')?.getBoundingClientRect()
    actions.dockTo(rect === undefined ? snapCorner(event.clientX, event.clientY) : snapRect(rect))
  }, [actions])

  // The collapsed pill is draggable like the panel header, and a tap expands it.
  const onPillPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointer capture is unavailable in jsdom */ }
    const rect = event.currentTarget.closest('[data-balance-widget]')?.getBoundingClientRect()
    pillDrag.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: rect?.left ?? 0,
      baseY: rect?.top ?? 0,
      size: { w: rect?.width ?? 0, h: rect?.height ?? 0 },
      snap: null,
      moved: false,
    }
    // Same dock-break on drag start as the panel header.
    if (settings.dock !== 'free') {
      if (rect !== undefined) actions.setPosition(rect.left, rect.top)
      actions.dockTo('free')
    }
  }, [actions, settings.dock])

  const onPillPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = pillDrag.current
    if (state === null) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) state.moved = true
    if (!state.moved) return
    resolveMagneticDrag(state, latest, dx, dy)
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      const { x, y } = latest.current
      actions.setPosition(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)))
    })
  }, [actions])

  const onPillPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = pillDrag.current
    pillDrag.current = null
    if (state === null) return
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* pointer capture is unavailable in jsdom */ }
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (!state.moved) {
      actions.toggleCollapsed()
      return
    }
    if (state.snap !== null) {
      actions.setPosition(latest.current.x, latest.current.y)
      actions.dockTo(state.snap)
      return
    }
    // Same synchronous final-position flush as the header drag, then snap by
    // the pill's real edges rather than the pointer position.
    const { x, y } = latest.current
    actions.setPosition(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)))
    const rect = event.currentTarget.closest('[data-balance-widget]')?.getBoundingClientRect()
    actions.dockTo(rect === undefined ? snapCorner(event.clientX, event.clientY) : snapRect(rect))
  }, [actions])

  const collapsed = settings.collapsed

  const deltaText = okAccount !== null && (okAccount.trend === 'up' || okAccount.trend === 'down')
    ? (okAccount.delta >= 0 ? '+' : '-') + formatAmount(Math.abs(okAccount.delta))
    : null

  return (
    <div
      className={css.widget}
      style={positionStyle(settings.dock, settings.position)}
      data-dock={settings.dock}
      data-collapsed={collapsed || undefined}
      data-balance-widget
    >
      <div
        className={css.scaleBox}
        style={{ transform: `scale(${settings.scale})`, transformOrigin: transformOrigin(settings.dock) }}
      >
        {collapsed ? (
          <div
            role="button"
            tabIndex={0}
            className={css.pill}
            aria-label={t('expand')}
            title={t('expand')}
            data-highlight={highlightRef.current !== null || undefined}
            onPointerDown={onPillPointerDown}
            onPointerMove={onPillPointerMove}
            onPointerUp={onPillPointerUp}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                actions.toggleCollapsed()
              }
            }}
          >
            {pillAccount !== null ? (
              <>
                <span className={css.pillLabel}>{pillAccount.displayName}</span>
                <span className={css.pillAmount} data-trend={pillAccount.trend}>{formatAmount(animated)}</span>
                <TrendArrow trend={pillAccount.trend} />
              </>
            ) : headerLabel !== null ? (
              <span className={css.pillLabel}>{headerLabel}</span>
            ) : null}
          </div>
        ) : (
          <div className={css.panel}>
            <div
              className={css.header}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <span className={css.title}>{t('title')}</span>
              {headerLabel !== null && <span className={css.provider} title={view.provider ?? undefined}>{headerLabel}</span>}
              <span className={css.controls} onPointerDown={(event) => { event.stopPropagation() }}>
                <button type="button" className={css.iconButton} onClick={() => { actions.zoomOut() }} disabled={settings.scale <= MIN_SCALE} aria-label={t('zoomOut')} title={t('zoomOut')}>−</button>
                <button type="button" className={css.zoomLevel} onClick={() => { actions.resetZoom() }} aria-label={t('resetZoom')} title={t('resetZoom')}>{Math.round(settings.scale * 100)}%</button>
                <button type="button" className={css.iconButton} onClick={() => { actions.zoomIn() }} disabled={settings.scale >= MAX_SCALE} aria-label={t('zoomIn')} title={t('zoomIn')}>+</button>
                <span className={css.divider} />
                <button type="button" className={css.iconButton} onClick={(event) => {
                  if (settings.dock === 'free') {
                    actions.dockTo('bottom-right')
                    return
                  }
                  // Un-docking keeps the current spot: record the widget rect as
                  // the free position so it does not jump to a stale value.
                  const rect = (event.currentTarget as HTMLElement).closest('[data-balance-widget]')?.getBoundingClientRect()
                  if (rect !== undefined) actions.setPosition(rect.left, rect.top)
                  actions.dockTo('free')
                }} aria-label={t('dock')} title={t('dock')} data-active={settings.dock !== 'free' || undefined}>⛶</button>
                <button type="button" className={css.iconButton} onClick={() => { actions.setMode(settings.mode === 'current' ? 'all' : 'current') }} aria-label={settings.mode === 'current' ? t('showAll') : t('showCurrent')} title={settings.mode === 'current' ? t('showAll') : t('showCurrent')} data-active={settings.mode === 'all' || undefined}>▦</button>
                <button type="button" className={css.iconButton} onClick={() => { refresh() }} aria-label={t('refresh')} title={t('refresh')}>⟳</button>
                <button type="button" className={css.iconButton} onClick={() => { actions.toggleCollapsed() }} aria-label={t('collapse')} title={t('collapse')}>—</button>
              </span>
            </div>
            <div className={css.body}>
              {settings.mode === 'all'
                ? <AccountList accounts={view.accounts} currentResult={view.result} t={t} />
                : <BalanceBody view={view} animated={animated} t={t} />}
            </div>
            {settings.mode === 'current' && okAccount !== null && (
              <div className={css.footer}>
                <span className={css.delta} data-trend={okAccount.trend}>
                  {deltaText !== null ? deltaText : okAccount.trend === 'flat' ? t('flat') : ''}
                </span>
                <span className={css.updatedAt}>
                  {t('updatedAt')} {new Date(okAccount.updatedAt).toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Choose the nearest viewport corner within the snap threshold, else free. */
function snapCorner(x: number, y: number): DockCorner {
  const nearLeft = x < SNAP_THRESHOLD
  const nearRight = x > window.innerWidth - SNAP_THRESHOLD
  const nearTop = y < SNAP_THRESHOLD
  const nearBottom = y > window.innerHeight - SNAP_THRESHOLD
  if (nearLeft && nearTop) return 'top-left'
  if (nearRight && nearTop) return 'top-right'
  if (nearLeft && nearBottom) return 'bottom-left'
  if (nearRight && nearBottom) return 'bottom-right'
  return 'free'
}

/** Snap by the widget's real edges: a corner is targeted when any edge touches it. */
function snapRect(rect: DOMRect): DockCorner {
  const nearLeft = rect.left < SNAP_THRESHOLD
  const nearRight = rect.right > window.innerWidth - SNAP_THRESHOLD
  const nearTop = rect.top < SNAP_THRESHOLD
  const nearBottom = rect.bottom > window.innerHeight - SNAP_THRESHOLD
  if (nearLeft && nearTop) return 'top-left'
  if (nearRight && nearTop) return 'top-right'
  if (nearLeft && nearBottom) return 'bottom-left'
  if (nearRight && nearBottom) return 'bottom-right'
  return 'free'
}

/** One drag's mutable state; the pill adds a tap-vs-drag flag. */
interface DragState {
  startX: number
  startY: number
  baseX: number
  baseY: number
  /** Widget layout size captured at drag start (the magnetic snap's anchor box). */
  size: { w: number; h: number }
  /** Corner the drag is currently pulled toward, or null while free. */
  snap: DockCorner | null
}

/** Collapsed-pill drag state; a move past the threshold is a drag, else a tap. */
interface PillDragState extends DragState {
  moved: boolean
}

/** The corner layout position a widget's top-left must sit at to dock there. */
interface SnapTarget {
  dock: DockCorner
  pos: { x: number; y: number }
}

/**
 * Magnetic corner target for a widget whose top-left is at (x, y) with size
 * w×h: the nearest corner whose anchored position is within the snap
 * threshold, or null while no corner pulls.
 */
function snapTarget(x: number, y: number, w: number, h: number): SnapTarget | null {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const candidates: readonly SnapTarget[] = [
    { dock: 'top-left', pos: { x: DOCK_INSET, y: DOCK_INSET } },
    { dock: 'top-right', pos: { x: vw - w - DOCK_INSET, y: DOCK_INSET } },
    { dock: 'bottom-left', pos: { x: DOCK_INSET, y: vh - h - DOCK_INSET } },
    { dock: 'bottom-right', pos: { x: vw - w - DOCK_INSET, y: vh - h - DOCK_INSET } },
  ]
  let best: SnapTarget | null = null
  let bestDistance = SNAP_THRESHOLD
  for (const candidate of candidates) {
    const distance = Math.hypot(x - candidate.pos.x, y - candidate.pos.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/**
 * Resolve one pointer-move into the drag state: the free position, magnetic
 * pull toward the nearest corner when within range, and the published
 * position the rAF flush commits.
 */
function resolveMagneticDrag(
  state: DragState,
  latest: { current: { x: number; y: number } },
  dx: number,
  dy: number,
): void {
  const x = state.baseX + dx
  const y = state.baseY + dy
  const target = snapTarget(x, y, state.size.w, state.size.h)
  if (target !== null) {
    state.snap = target.dock
    latest.current = target.pos
  } else {
    state.snap = null
    latest.current = { x, y }
  }
}

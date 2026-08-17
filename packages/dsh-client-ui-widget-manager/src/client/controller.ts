/**
 * Widget manager controller: the runtime enable/disable half.
 *
 * "Close" (disable) a widget by registering a SHADOW entry into
 * `shell.overlay` with the same list `id` at a lower `priority` (-1 vs the
 * widgets' default 0). List-slot cells render their lowest-priority live
 * winner (ui-slots shadowing), so the shadow wins the cell and the widget's
 * own entry stops rendering — without unmounting the widget plugin or
 * touching its code. "Add" (enable) disposes the shadow and the widget
 * renders again. Shadows live and die with this plugin's fiber through
 * ctx.slots.register (fiber unload cascades them).
 *
 * State is persisted to localStorage (browser-side only, no Host seam) and
 * reconciled reactively: the controller subscribes to `shell.overlay`
 * mutations, so a widget that mounts after this manager (or after a reload)
 * is shadowed the moment its entry appears. It also subscribes to the
 * `widgets.config` ledger (the manager-declared child slot widgets register
 * their config panel into) so each row knows whether a "Configure" action is
 * available.
 *
 * @module @dsh-plugins/client-ui-widget-manager/client/controller
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { WIDGET_CATALOG } from './widgets.ts'
import type { WidgetDescriptor } from './widgets.ts'
import type { WidgetManagerLocaleKey } from './locales.ts'

/** Shadow entries win at this priority (widgets register at the default 0). */
export const SHADOW_PRIORITY = -1
/** Registrant stamp placed on shadow entries so the ledger can tell them apart. */
export const REGISTRANT = 'widget-manager'
/** Registrant stamp the card container places on its DOCK shadows — a widget
 *  hidden by the container is "docked", not "disabled": the manager page must
 *  not offer to re-enable it (the dock shadow still wins), but offer to
 *  undock instead. */
export const DOCKED_REGISTRANT = 'card-container'
/** localStorage key persisting the disabled widget ids. */
export const STORAGE_KEY = 'dsh-plugins.widget-manager.disabled'
/** Window event the manager dispatches (detail = widget id) to ask the card
 *  container to undock a docked widget (mirror of the container's
 *  `dsh.card-container.dock` request; a no-op when the container is absent). */
export const UNDOCK_REQUEST_EVENT = 'dsh.card-container.undock'

/** Dispatch an undock request for the given widget id (the container listens
 *  and restores the floating panel). Safe when the container is absent. */
export function requestUndock(id: string): void {
  try {
    window.dispatchEvent(new CustomEvent(UNDOCK_REQUEST_EVENT, { detail: id }))
  } catch { /* events unavailable */ }
}

/** One row of the widget list page. */
export interface WidgetRow {
  /** The `shell.overlay` entry id (also the toggle key). */
  id: string
  /** Shipping package name; undefined for widgets outside the catalog. */
  packageName: string | undefined
  /** Catalog display-name key; undefined for widgets outside the catalog. */
  nameKey: WidgetManagerLocaleKey | undefined
  /** Catalog description key; undefined for widgets outside the catalog. */
  descriptionKey: WidgetManagerLocaleKey | undefined
  /** Whether the widget contributed a config panel into `widgets.config`. */
  hasConfig: boolean
  /** Whether the widget plugin currently has an entry in the overlay. */
  registered: boolean
  /** Whether the widget's entry is the cell winner (visible). */
  enabled: boolean
  /** Whether the widget is hidden because it is DOCKED in the card container
   *  (a container dock shadow wins its cell) — distinct from a manager
   *  disable: the row offers "undock" instead of "add". */
  docked: boolean
}

/** Renders nothing — the winning shadow hides its cell. */
function ShadowWidget(): null {
  return null
}

/**
 * Per-plugin widget manager object layer. One instance per client plugin
 * apply; published through the inject hooks compartment as `useWidgets`.
 */
export class WidgetManagerController implements HostObservable<readonly WidgetRow[]> {
  private readonly listeners = new Set<() => void>()
  /** id → disposer of the live shadow entry (one per disabled widget). */
  private readonly shadows = new Map<string, () => void>()
  /** Session-authoritative disabled set (localStorage is best-effort persistence). */
  private readonly disabled = new Set<string>()
  /** Overlay ids that currently contribute a panel into `widgets.config`. */
  private configIds: ReadonlySet<string> = new Set()
  private rows: readonly WidgetRow[] = []

  /**
   * @param ctx - client root context carrying the slot registry.
   */
  constructor(private readonly ctx: ClientContext) {
    const stop = ctx.slots.subscribe('shell.overlay', () => { this.reconcile(); this.notify() })
    const stopConfig = ctx.slots.subscribe('widgets.config', () => { this.reconcileConfigs(); this.reconcile(); this.notify() })
    ctx.effect(() => () => { stop(); stopConfig() }, 'widget-manager: ledger subscriptions')
    // Seed the session set from persistence, then apply shadows as widgets come online.
    for (const id of readDisabled()) this.disabled.add(id)
    for (const id of this.disabled) this.reconcileShadow(id)
    this.reconcileConfigs()
    this.reconcile()
  }

  /** uSES getSnapshot side (bound as the `useWidgets` selector hook). */
  getSnapshot(): readonly WidgetRow[] {
    return this.rows
  }

  /** uSES subscribe side (bound as the `useWidgets` selector hook). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Toggle one widget: disable when visible, enable when shadowed by US. The
   *  decision keys off our own shadow map, not the raw ledger: a THIRD-PARTY
   *  negative-priority entry can hide a widget too, and basing the toggle on
   *  it would flip our state without changing what the user sees (and keep
   *  flipping forever). Our own disabled set stays consistent with our own
   *  actions; third-party shadows still show up in the row's `enabled` state. */
  toggle(id: string): void {
    if (this.shadows.has(id)) {
      this.disabled.delete(id)
    } else {
      this.disabled.add(id)
    }
    writeDisabled(this.disabled)
    this.reconcileShadow(id)
    this.reconcile()
    this.notify()
  }

  /**
   * Whether something currently hides the widget's cell: any live entry for
   * the id at a NEGATIVE priority wins over the widget's default 0 (manager
   * shadows are stamped `widget-manager`; third-party shadows count too).
   */
  private isShadowed(id: string): boolean {
    return this.ctx.slots.entries('shell.overlay').some((entry) =>
      entry.options.id === id && (entry.options.priority ?? 0) < 0)
  }

  /** A ledger entry is a manager shadow iff it carries our registrant stamp at shadow priority. */
  private isShadowEntry(entry: StoredEntry): boolean {
    return entry.registrant === REGISTRANT && entry.options.priority === SHADOW_PRIORITY
  }

  /** Whether the widget is hidden because it is DOCKED in the card container
   *  (a container dock shadow at priority -2 wins its cell) rather than
   *  disabled by us — the page must offer "undock", not "add". */
  private isDocked(id: string): boolean {
    return this.ctx.slots.entries('shell.overlay').some((entry) =>
      entry.options.id === id && entry.registrant === DOCKED_REGISTRANT && (entry.options.priority ?? 0) < 0)
  }

  /** Bring the shadow for one id in line with the disabled set. */
  private reconcileShadow(id: string): void {
    const want = this.disabled.has(id)
    const has = this.shadows.has(id)
    if (want && !has) {
      // Only shadow a widget that is actually mounted (the subscription retries otherwise).
      const target = this.ctx.slots.entries('shell.overlay').find((entry) => entry.options.id === id && !this.isShadowEntry(entry))
      if (target === undefined) return
      try {
        const disposer = this.ctx.slots.register(
          {
            name: 'shell.overlay',
            id,
            ...(target.options.order === undefined ? {} : { order: target.options.order }),
            priority: SHADOW_PRIORITY,
            registrant: REGISTRANT,
          },
          ShadowWidget,
        )
        this.shadows.set(id, disposer)
      } catch (error) {
        this.ctx.logger.warn('widget-manager: failed to disable widget "%s"', id)
        this.ctx.logger.warn(error)
      }
    } else if (!want && has) {
      const dispose = this.shadows.get(id)!
      this.shadows.delete(id)
      dispose()
    }
  }

  /** Project the `widgets.config` ledger into the set of config-bearing ids. */
  private reconcileConfigs(): void {
    const ids = new Set<string>()
    for (const entry of this.ctx.slots.entries('widgets.config')) {
      if (entry.options.id !== undefined) ids.add(entry.options.id)
    }
    this.configIds = ids
  }

  private reconcile(): void {
    const widgetIds = new Set<string>()
    for (const entry of this.ctx.slots.entries('shell.overlay')) {
      if (entry.options.id !== undefined && !this.isShadowEntry(entry)) widgetIds.add(entry.options.id)
    }
    // Self-heal uninstalled widgets: when a widget we have SHADOWED disappears
    // from the ledger (its plugin unloaded), drop our shadow AND the disabled
    // mark — a permanent shadow would silently hide any future plugin that
    // reuses the id, and the stale row would offer no way out. Only ids we
    // actually shadowed are cleaned: a disabled-but-never-mounted id keeps its
    // preference so a slower widget mount still gets shadowed.
    let cleaned = false
    for (const id of [...this.disabled]) {
      if (!this.shadows.has(id)) continue
      if (widgetIds.has(id)) continue
      const dispose = this.shadows.get(id)!
      this.shadows.delete(id)
      this.disabled.delete(id)
      dispose()
      cleaned = true
    }
    if (cleaned) writeDisabled(this.disabled)
    // Late-mounted widgets retry their shadows here.
    for (const id of this.disabled) this.reconcileShadow(id)

    const rows: WidgetRow[] = []
    for (const descriptor of WIDGET_CATALOG) {
      rows.push(this.rowOf(descriptor, widgetIds.has(descriptor.id)))
    }
    for (const id of widgetIds) {
      if (rows.some((row) => row.id === id)) continue
      rows.push({ id, packageName: undefined, nameKey: undefined, descriptionKey: undefined, hasConfig: this.configIds.has(id), registered: true, enabled: !this.isShadowed(id), docked: this.isDocked(id) })
    }
    this.rows = rows
  }

  private rowOf(descriptor: WidgetDescriptor, registered: boolean): WidgetRow {
    return {
      id: descriptor.id,
      packageName: descriptor.packageName,
      nameKey: descriptor.nameKey,
      descriptionKey: descriptor.descriptionKey,
      hasConfig: this.configIds.has(descriptor.id),
      registered,
      enabled: registered && !this.isShadowed(descriptor.id),
      docked: registered && this.isDocked(descriptor.id),
    }
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

/** Read the persisted disabled widget ids (tolerant of corrupt storage). */
function readDisabled(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

/** Persist the disabled widget ids (best-effort; the session set works regardless). */
function writeDisabled(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // Storage unavailable (privacy mode etc.) — toggling still works for this page load.
  }
}

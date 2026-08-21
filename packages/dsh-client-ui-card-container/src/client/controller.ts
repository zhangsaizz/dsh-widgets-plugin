/**
 * Card container controller: the runtime dock/undock half.
 *
 * The container is itself a `shell.overlay` widget (id `card-container`).
 * Docking another widget means two things:
 *
 *  1. a SHADOW entry is registered into `shell.overlay` under the same list
 *     `id` at a lower priority (-2; the widget-manager uses -1, and same
 *     id + same priority throws, so -2 never collides) — the list cell then
 *     renders the shadow (null), so the widget's own floating panel stops
 *     rendering without unmounting its plugin or touching its code;
 *  2. the widget's compact CARD VIEW is rendered inside the container's grid
 *     (`widgets.card` list slot, `renderSlot(..., { only: id })`).
 *
 * MULTI-GROUP: the container holds several independent groups (each with its
 * own name + docked order), and the floating panel shows ONE active group at a
 * time. A widget docks into the ACTIVE group; switching groups shows that
 * group's cards. A widget can only be docked in ONE group at a time (its dock
 * shadow is unique), so docking an already-docked widget moves it.
 *
 * Undocking disposes the shadow and the floating panel returns. State persists
 * to localStorage, and the controller reconciles against the live
 * `shell.overlay` ledger: a docked widget whose plugin unloads is dropped (and
 * its shadow disposed, so a later plugin reusing the id is not silently
 * hidden), and while the CONTAINER ITSELF is hidden (disabled by the
 * widget-manager) every dock shadow is released so the widgets float again —
 * the persisted order stays, so re-enabling the container restores the dock.
 *
 * @module @dsh-plugins/client-ui-card-container/client/controller
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

/** The container's own `shell.overlay` id (never dockable). */
export const SELF_ID = 'card-container'
/** Dock shadows win at this priority (widgets register at 0, the manager at -1). */
export const SHADOW_PRIORITY = -2
/** Registrant stamp on dock shadows so the ledger can tell them apart. */
export const REGISTRANT = 'card-container'
/** Legacy localStorage key of the pre-multi-group single docked list (migrated once). */
export const DOCK_KEY = 'dsh-plugins.card-container.docked'
/** localStorage key persisting the multi-group state: { [id]: { name, docked } }. */
export const GROUPS_KEY = 'dsh-plugins.card-container.groups'
/** localStorage key persisting the active group id. */
export const ACTIVE_GROUP_KEY = 'dsh-plugins.card-container.active'
/** localStorage key persisting the container panel position. */
export const POS_KEY = 'dsh-plugins.card-container.pos'
/** localStorage key persisting the container settings (columns). */
export const SETTINGS_KEY = 'dsh-plugins.card-container.settings'
/** Window event dispatched by the config panel so the mounted widget re-reads. */
export const SETTINGS_CHANGED_EVENT = 'dsh.card-container.settings-changed'
/** Window event a floating widget dispatches (detail = its shell.overlay id)
 *  to request docking itself into the container — the quick-dock affordance
 *  on floating panels, decoupled from the container package. */
export const DOCK_REQUEST_EVENT = 'dsh.card-container.dock'
/** Window event the widget manager dispatches (detail = its shell.overlay id)
 *  to request undocking a docked widget — the manager page's "移出容器" action,
 *  decoupled from the container package. */
export const UNDOCK_REQUEST_EVENT = 'dsh.card-container.undock'

/** Dispatch a dock request for the given widget id (the container listens and
 *  docks it). Safe to call when the container is not mounted (no-op then). */
export function requestDock(id: string): void {
  try {
    window.dispatchEvent(new CustomEvent(DOCK_REQUEST_EVENT, { detail: id }))
  } catch { /* events unavailable */ }
}

/** Dispatch an undock request for the given widget id (the container listens
 *  and restores the floating panel). Safe to call when the container is not
 *  mounted (no-op then). */
export function requestUndock(id: string): void {
  try {
    window.dispatchEvent(new CustomEvent(UNDOCK_REQUEST_EVENT, { detail: id }))
  } catch { /* events unavailable */ }
}

/** Renders nothing — the winning dock shadow hides its cell. */
export function ShadowWidget(): null {
  return null
}

/** One container group: a named, ordered docked list. */
export interface ContainerGroup {
  id: string
  name: string
  docked: readonly string[]
}

/** One reconciled snapshot the container widget renders from. */
export interface ContainerSnapshot {
  /** Widget ids currently enabled in the overlay (dockable), in ledger order. */
  available: readonly string[]
  /** The id of the group the panel currently shows. */
  activeGroup: string
  /** Every group, in creation order (the panel shows one at a time). */
  groups: readonly ContainerGroup[]
  /** Widget ids docked in the ACTIVE group, in grid order (persisted). */
  docked: readonly string[]
}

/** Persisted group record (localStorage shape). */
interface PersistedGroup {
  name: string
  docked: string[]
}

/** Default group id — always present, the first dock target. */
export const DEFAULT_GROUP = 'default'

/** Read the persisted groups, migrating the legacy single-docked list once. */
export function readGroups(): Record<string, PersistedGroup> {
  try {
    const raw = localStorage.getItem(GROUPS_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, PersistedGroup> = {}
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          const g = value as Partial<PersistedGroup> | undefined
          if (!g || typeof g !== 'object') continue
          out[id] = {
            name: typeof g.name === 'string' && g.name !== '' ? g.name : id,
            docked: Array.isArray(g.docked) ? g.docked.filter((v): v is string => typeof v === 'string') : [],
          }
        }
        if (out[DEFAULT_GROUP] !== undefined) return out
        return { [DEFAULT_GROUP]: { name: DEFAULT_GROUP, docked: [] }, ...out }
      }
    }
    // Legacy single-list: migrate into the default group, then drop the key.
    const legacy = readLegacyDocked()
    if (legacy.length > 0) {
      const out = { [DEFAULT_GROUP]: { name: DEFAULT_GROUP, docked: legacy } }
      writeGroups(out)
      try { localStorage.removeItem(DOCK_KEY) } catch { /* storage */ }
      return out
    }
    return { [DEFAULT_GROUP]: { name: DEFAULT_GROUP, docked: [] } }
  } catch {
    return { [DEFAULT_GROUP]: { name: DEFAULT_GROUP, docked: [] } }
  }
}

/** Read the legacy single-docked list (pre-multi-group). */
function readLegacyDocked(): string[] {
  try {
    const raw = localStorage.getItem(DOCK_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

/** Persist the full group map (best-effort). */
export function writeGroups(groups: Record<string, PersistedGroup>): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups))
  } catch { /* storage unavailable */ }
}

/** Read the persisted active group id (validated against the group map). */
export function readActiveGroup(groups: Record<string, PersistedGroup>): string {
  try {
    const raw = localStorage.getItem(ACTIVE_GROUP_KEY)
    if (raw !== null && groups[raw] !== undefined) return raw
  } catch { /* storage */ }
  return DEFAULT_GROUP
}

/** Persist the active group id (best-effort). */
export function writeActiveGroup(id: string): void {
  try {
    localStorage.setItem(ACTIVE_GROUP_KEY, id)
  } catch { /* storage unavailable */ }
}

/** Read the free panel position (top-left), or null for the default corner. */
export function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
    return null
  } catch {
    return null
  }
}

/** Persist the free panel position. */
export function savePos(pos: { x: number; y: number } | null): void {
  try {
    if (pos === null) localStorage.removeItem(POS_KEY)
    else localStorage.setItem(POS_KEY, JSON.stringify(pos))
  } catch { /* storage unavailable */ }
}

/** Grid columns: 'auto' = auto-fill; a digit = fixed column count. */
export type ColumnSetting = 'auto' | '2' | '3' | '4'

/** Read the persisted column setting (validated; defaults to 'auto'). */
export function loadColumns(): ColumnSetting {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return 'auto'
    const s: unknown = JSON.parse(raw)
    if (s && typeof s === 'object' && 'columns' in s) {
      const cols = (s as { columns: unknown }).columns
      if (cols === 'auto' || cols === '2' || cols === '3' || cols === '4') return cols
    }
    return 'auto'
  } catch {
    return 'auto'
  }
}

/** Persist the column setting (best-effort). */
export function saveColumns(columns: ColumnSetting): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ columns }))
  } catch { /* storage unavailable */ }
}

/** Per-widget dock controller; one instance per client plugin apply, published
 *  through the inject hooks compartment as `useContainer`. */
export class CardContainerController implements HostObservable<ContainerSnapshot> {
  private readonly listeners = new Set<() => void>()
  /** id → disposer of the live dock shadow (one per docked widget). */
  private readonly shadows = new Map<string, () => void>()
  /** Persisted groups, session-authoritative ({ id → { name, docked } }). */
  private groups: Record<string, PersistedGroup> = readGroups()
  /** The group the panel currently shows. */
  private activeGroup = readActiveGroup(this.groups)
  /** Group ids in stable order (insertion order, default first). */
  private groupOrder: string[] = this.orderedGroupIds()
  private snapshot: ContainerSnapshot = { available: [], activeGroup: this.activeGroup, groups: [], docked: [] }

  /**
   * @param ctx - client root context carrying the slot registry.
   */
  constructor(private readonly ctx: ClientContext) {
    const stop = ctx.slots.subscribe('shell.overlay', () => { this.reconcile(); this.notify() })
    const onSettings = (): void => {
      // The config panel may have edited groups / the active group — reload
      // from storage and let reconcile release/re-add shadows as needed.
      this.groups = readGroups()
      this.groupOrder = this.orderedGroupIds()
      this.activeGroup = readActiveGroup(this.groups)
      this.reconcile()
      this.notify()
    }
    try { window.addEventListener(SETTINGS_CHANGED_EVENT, onSettings) } catch { /* no window */ }
    ctx.effect(() => () => {
      stop()
      try { window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettings) } catch { /* no window */ }
    }, 'card-container: ledger + settings subscriptions')
    this.reconcile()
  }

  /** uSES getSnapshot side (bound as the `useContainer` selector hook). */
  getSnapshot(): ContainerSnapshot {
    return this.snapshot
  }

  /** uSES subscribe side (bound as the `useContainer` selector hook). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Dock one widget into the ACTIVE group: hide its floating panel (shadow)
   *  and add its card to the group's grid. A widget docked in another group
   *  moves here. */
  dock(id: string): void {
    this.dockTo(id, this.activeGroup)
  }

  /** Dock one widget into a SPECIFIC group (used by cross-group card drags).
   *  An already-docked widget moves groups; a fresh one requires an enabled
   *  overlay winner (same rule as docking into the active group). */
  dockTo(id: string, groupId: string): void {
    if (id === SELF_ID) return
    const group = this.groups[groupId]
    if (!group) return
    const alreadyDocked = this.allDocked().has(id)
    if (!alreadyDocked) {
      // Only widgets whose entry is currently the enabled winner are dockable.
      const winner = this.ctx.slots.entriesOfSlot('shell.overlay')
        .find((entry) => entry.options.id === id)
      if (winner === undefined || (winner.options.priority ?? 0) < 0) return
    }
    // Remove from every group (a widget has one dock shadow), then add here.
    for (const other of Object.values(this.groups)) {
      const i = other.docked.indexOf(id)
      if (i >= 0) other.docked.splice(i, 1)
    }
    if (!group.docked.includes(id)) group.docked.push(id)
    writeGroups(this.groups)
    this.reconcileShadow(id)
    this.reconcile()
    this.notify()
  }

  /** Undock one widget: dispose its shadow, so the floating panel returns. */
  undock(id: string): void {
    let found = false
    for (const group of Object.values(this.groups)) {
      const i = group.docked.indexOf(id)
      if (i < 0) continue
      group.docked.splice(i, 1)
      found = true
    }
    if (!found) return
    writeGroups(this.groups)
    this.disposeShadow(id)
    this.reconcile()
    this.notify()
  }

  /** Reorder the ACTIVE group's grid: move the card at `from` to index `to`. */
  move(from: number, to: number): void {
    const group = this.groups[this.activeGroup]
    if (!group || from < 0 || from >= group.docked.length) return
    const [id] = group.docked.splice(from, 1)
    const at = Math.min(to, group.docked.length)
    group.docked.splice(at, 0, id)
    writeGroups(this.groups)
    this.reconcile()
    this.notify()
  }

  /** Undock every widget of the ACTIVE group. */
  clearDocked(): void {
    const group = this.groups[this.activeGroup]
    if (!group || group.docked.length === 0) return
    const ids = [...group.docked]
    group.docked = []
    writeGroups(this.groups)
    for (const id of ids) this.disposeShadow(id)
    this.reconcile()
    this.notify()
  }

  /** Switch the panel to another group. */
  setActiveGroup(id: string): void {
    if (id === this.activeGroup || this.groups[id] === undefined) return
    this.activeGroup = id
    writeActiveGroup(id)
    this.reconcile()
    this.notify()
  }

  /** Create a new empty group and switch to it. */
  addGroup(name: string): string {
    const id = `group-${Date.now().toString(36)}`
    this.groups[id] = { name: name.trim() !== '' ? name.trim() : id, docked: [] }
    this.groupOrder = this.orderedGroupIds()
    writeGroups(this.groups)
    this.activeGroup = id
    writeActiveGroup(id)
    this.reconcile()
    this.notify()
    return id
  }

  /** Rename a group (default keeps its stable id). */
  renameGroup(id: string, name: string): void {
    const group = this.groups[id]
    if (!group) return
    group.name = name.trim() !== '' ? name.trim() : id
    writeGroups(this.groups)
    this.reconcile()
    this.notify()
  }

  /** Delete a group: its docked widgets are undocked (shadows released). The
   *  default group cannot be deleted. */
  removeGroup(id: string): void {
    if (id === DEFAULT_GROUP || this.groups[id] === undefined) return
    const ids = [...this.groups[id].docked]
    delete this.groups[id]
    this.groupOrder = this.orderedGroupIds()
    writeGroups(this.groups)
    for (const wid of ids) this.disposeShadow(wid)
    if (this.activeGroup === id) {
      this.activeGroup = DEFAULT_GROUP
      writeActiveGroup(this.activeGroup)
    }
    this.reconcile()
    this.notify()
  }

  /** A ledger entry is OUR dock shadow iff it carries our stamp at our priority. */
  private isDockShadow(entry: StoredEntry): boolean {
    return entry.registrant === REGISTRANT && entry.options.priority === SHADOW_PRIORITY
  }

  /** Bring the shadow for one id in line with the docked set. */
  private reconcileShadow(id: string): void {
    if (this.shadows.has(id)) return
    // Only shadow a widget whose own entry is live (the subscription retries otherwise).
    const target = this.ctx.slots.entries('shell.overlay')
      .find((entry) => entry.options.id === id && !this.isDockShadow(entry))
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
      this.ctx.logger.warn('card-container: failed to dock widget "%s"', id)
      this.ctx.logger.warn(error)
    }
  }

  private disposeShadow(id: string): void {
    const dispose = this.shadows.get(id)
    if (!dispose) return
    this.shadows.delete(id)
    dispose()
  }

  private disposeAllShadows(): void {
    for (const id of [...this.shadows.keys()]) this.disposeShadow(id)
  }

  /** Group ids in stable order: default first, then insertion order. */
  private orderedGroupIds(): string[] {
    const ids = Object.keys(this.groups)
    return ids.sort((a, b) => (a === DEFAULT_GROUP ? -1 : b === DEFAULT_GROUP ? 1 : 0))
  }

  /** The set of all widget ids docked across every group. */
  private allDocked(): Set<string> {
    const set = new Set<string>()
    for (const group of Object.values(this.groups)) {
      for (const id of group.docked) set.add(id)
    }
    return set
  }

  private reconcile(): void {
    const winners = this.ctx.slots.entriesOfSlot('shell.overlay')
    const dockedAll = this.allDocked()
    // Available: enabled (non-shadowed) winners, not the container, not docked.
    const available: string[] = []
    for (const entry of winners) {
      const id = entry.options.id
      if (id === undefined || id === SELF_ID) continue
      if ((entry.options.priority ?? 0) < 0) continue
      if (dockedAll.has(id)) continue
      available.push(id)
    }
    // Self-heal: a docked widget that vanished from the ledger (plugin unload)
    // loses its dock AND its shadow — a permanent shadow would silently hide
    // any future plugin reusing the id.
    let cleaned = false
    for (const id of dockedAll) {
      if (winners.some((entry) => entry.options.id === id)) continue
      for (const group of Object.values(this.groups)) {
        const i = group.docked.indexOf(id)
        if (i >= 0) group.docked.splice(i, 1)
      }
      this.disposeShadow(id)
      cleaned = true
    }
    if (cleaned) writeGroups(this.groups)
    // Ensure the active group still exists (a removed group falls back to default).
    if (this.groups[this.activeGroup] === undefined) {
      this.activeGroup = DEFAULT_GROUP
      writeActiveGroup(this.activeGroup)
    }
    // While the container itself is hidden (the manager shadowed its cell),
    // release every dock shadow so the widgets float again; the persisted
    // order stays, so re-enabling the container re-docks them.
    const selfWinner = winners.find((entry) => entry.options.id === SELF_ID)
    const selfEnabled = selfWinner !== undefined && (selfWinner.options.priority ?? 0) >= 0
    if (selfEnabled) {
      for (const id of this.allDocked()) this.reconcileShadow(id)
      // Drop any shadow whose widget is no longer docked anywhere — e.g. the
      // config panel's "清空停靠" (clears the active group) edits storage and
      // the change event reloads groups; reconcile must release the shadows
      // that the cleared dock no longer needs, or the floating panels would
      // stay hidden.
      for (const id of [...this.shadows.keys()]) {
        if (!dockedAll.has(id)) this.disposeShadow(id)
      }
    } else {
      this.disposeAllShadows()
    }
    const groupView: ContainerGroup[] = this.groupOrder.map((id) => ({
      id,
      name: this.groups[id].name,
      docked: [...this.groups[id].docked],
    }))
    this.snapshot = {
      available,
      activeGroup: this.activeGroup,
      groups: groupView,
      docked: [...(this.groups[this.activeGroup]?.docked ?? [])],
    }
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

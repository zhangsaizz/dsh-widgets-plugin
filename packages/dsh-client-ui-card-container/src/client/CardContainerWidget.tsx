/**
 * The card container widget: a floating, draggable panel registered into the
 * shell.overlay list (id `card-container`). It docks other overlay widgets
 * into a tidy, evenly-gapped grid:
 *
 *  - the TRAY lists the widgets that are currently enabled in the overlay
 *    (projected by the controller through the `useContainer` hook); dragging a
 *    chip into the grid (or clicking it) docks the widget — its floating panel
 *    is hidden by a shadow entry (see the controller) and its compact CARD
 *    VIEW renders inside the grid;
 *  - the GRID renders each docked widget's card through the declared
 *    `widgets.card` child slot (`renderSlot(..., { only: id, fallback })`);
 *    cards reorder by dragging, and the × button undocks (floating panel
 *    returns);
 *  - the panel itself drags by its header and collapses to a pill; columns
 *    and the panel position persist to localStorage.
 *
 * @module @dsh-plugins/client-ui-card-container/client
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  POS_KEY, SETTINGS_CHANGED_EVENT, DEFAULT_GROUP, loadColumns, loadPos, savePos, SELF_ID,
} from './controller.ts'
import type { CardContainerController, ColumnSetting, ContainerSnapshot } from './controller.ts'
import type { CardSpec } from './cards.tsx'
import css from './CardContainerWidget.module.css'

/** Injected business face: the container controller source + dock verbs. */
export interface CardContainerInject {
  hooks: {
    /** Live dock/available projection (bound as the `useContainer` hook). */
    container: CardContainerController
  }
  /** Resolve a widget's display label (fallback: the raw id). */
  labelOf: (id: string) => string
  /** Resolve a docked widget's declared card size spec (default 'small'). */
  specOf: (id: string) => CardSpec
  /** Dock one widget (hide floating panel, show card in the grid). */
  dock: (id: string) => void
  /** Undock one widget (restore floating panel). */
  undock: (id: string) => void
  /** Reorder the docked grid. */
  move: (from: number, to: number) => void
  /** Move a docked card into a specific group (cross-group drag drop). */
  dockTo: (id: string, groupId: string) => void
  /** Switch the panel to another group. */
  setActiveGroup: (id: string) => void
  /** Create a new empty group and switch to it. */
  addGroup: (name: string) => void
  /** Rename a group. */
  renameGroup: (id: string, name: string) => void
  /** Delete a group (its docked widgets are undocked). */
  removeGroup: (id: string) => void
}

/** Full composed props for the widget (runtime + locale + child-slot render + inject shares). */
export type CardContainerWidgetProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<'card-container'>
  & PropsRenderSlots<'widgets.card'>
  & InjectFace<CardContainerInject>

/** Pointer-drag state for the panel. */
interface DragState {
  pointerId: number
  startX: number
  startY: number
  originLeft: number
  originTop: number
}

/** Drag source: tray chips use HTML5 DnD (dock); card reorder is a separate
 *  live pointer drag (startCardReorder). */
type DragSource = 'tray'

/** Which element a drag started from (dataTransfer carries only the id). */
const dragSourceRef: { current: DragSource | null } = { current: null }

/** Default panel corner while the user has not dragged it. */
const DEFAULT_LEFT = 16
const DEFAULT_TOP = 96
/** Panel width used to clamp dragging; matches the CSS width. */
const PANEL_W = 380

/** Grid columns: 'auto' = auto-fill; a digit = fixed column count.
 *  Shared single source of truth lives in ./controller.ts (used by both the
 *  widget and its config panel). Re-exported here for backward compat. */
export type { ColumnSetting } from './controller.ts'

/** Keep the panel's top-left inside the viewport (with a small margin). */
function clampToViewport(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const m = 6
  return {
    x: Math.round(Math.min(Math.max(x, m), Math.max(m, window.innerWidth - w - m))),
    y: Math.round(Math.min(Math.max(y, m), Math.max(m, window.innerHeight - h - m))),
  }
}

/** Whether two rects overlap (with a small tolerance). */
function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  const tol = 8
  return a.left < b.right + tol
    && a.right > b.left - tol
    && a.top < b.bottom + tol
    && a.bottom > b.top - tol
}

export function CardContainerWidget(props: CardContainerWidgetProps) {
  const {
    t, renderSlot, labelOf, specOf, dock, undock, move, dockTo,
    setActiveGroup, addGroup, renameGroup, removeGroup,
  } = props
  /** Live dock/available projection from the controller. */
  const snapshot = props.useContainer((s: ContainerSnapshot) => s)

  /** Display label for a group: the user's custom name, except the pristine
   *  default group whose persisted name is its raw id ('default') — that shows
   *  the localized "默认" instead. */
  const groupLabel = (group: { id: string; name: string }): string =>
    group.id === DEFAULT_GROUP && group.name === DEFAULT_GROUP ? t('defaultGroup') : group.name

  const [collapsed, setCollapsed] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadPos)
  const [columns, setColumns] = useState<ColumnSetting>(loadColumns)
  const [dragging, setDragging] = useState(false)
  /** Live card-reorder preview: while a card is being dragged it is LIFTED out
   *  of the grid into a ghost that follows the pointer (see the ghost render
   *  below); this array holds the target order (including the dragged card),
   *  so the remaining cards visibly shuffle into place in real time. The
   *  persisted order only changes on pointerup (move()). */
  const [previewOrder, setPreviewOrder] = useState<readonly string[] | null>(null)
  /** Whether the mouse is over the container: the chrome (header + tray +
   *  section labels) fades in only while hovered, so at rest the container
   *  shows just the docked cards. */
  const [hovered, setHovered] = useState(false)
  /** Group-management popover open state (rename/new/delete affordances). */
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  /** Draft name while creating/renaming a group. */
  const [groupNameDraft, setGroupNameDraft] = useState('')
  /** Fixed-position anchor of the group menu (below the ⋯ button). */
  const [groupMenuPos, setGroupMenuPos] = useState<{ left: number; top: number } | null>(null)
  const groupMenuBtnRef = useRef<HTMLButtonElement | null>(null)
  const groupMenuRef = useRef<HTMLDivElement | null>(null)
  /** Group currently being renamed inline in the menu (null = none). */
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)

  const anchorRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const movedRef = useRef(false)
  const posRef = useRef<{ x: number; y: number } | null>(null)
  const columnsRef = useRef(columns)
  const snapshotRef = useRef(snapshot)
  /** Grid element used to map pointer position → target index during a live
   *  card-reorder drag. */
  const gridRef = useRef<HTMLDivElement | null>(null)
  /** Ghost element (the lifted dragged card following the pointer). */
  const ghostRef = useRef<HTMLDivElement | null>(null)
  /** Active live-reorder drag: dragged id, its ORIGINAL index, the pointer id,
   *  the grab offset inside the card (so the ghost follows 1:1) and the drag
   *  start coords (a small movement threshold decides whether this becomes a
   *  drag at all). */
  const reorderRef = useRef<{
    id: string
    from: number
    pointerId: number
    grabX: number
    grabY: number
    startX: number
    startY: number
  } | null>(null)
  /** Latest preview order, mirrored for the once-subscribed document listeners. */
  const previewRef = useRef<readonly string[] | null>(null)
  /** Latest pointer coords during a reorder drag, coalesced into one frame. */
  const latestMoveRef = useRef<{ x: number; y: number } | null>(null)
  /** Pending animation frame for the throttled reorder geometry recompute. */
  const moveRafRef = useRef<number | null>(null)
  /** Whether the pointer has left the grid during the current reorder drag
   *  (releasing there undocks the card). Ref for the drag loop; mirrored to
   *  state so the ghost's target badge re-renders. */
  const movedOutRef = useRef(false)
  const [dragOut, setDragOut] = useState(false)
  /** Group tab element currently hovered while a card drag is in flight
   *  (dropping there moves the card to that group). Ref for the drag loop;
   *  mirrored to state so the tab highlight re-renders. */
  const dragGroupRef = useRef<string | null>(null)
  const [dragGroup, setDragGroup] = useState<string | null>(null)
  /** Map of group-tab refs, so drag-over can hit-test tabs. */
  const groupTabRefs = useRef<Map<string, HTMLElement>>(new Map())
  /** Floating-widget drag observation: when the user drags another overlay
   *  widget (its root carries `data-widget-id`) over the container, releasing
   *  inside the grid docks it — without intercepting the widget's own drag.
   *  Only a REAL drag (movement beyond the threshold) can dock: a plain click
   *  on a floating widget must never accidentally dock it. */
  const floatDragRef = useRef<{
    id: string
    pointerId: number
    x: number
    y: number
    moved: boolean
  } | null>(null)
  const [floatOverGrid, setFloatOverGrid] = useState(false)

  useEffect(() => { columnsRef.current = columns }, [columns])
  useEffect(() => { snapshotRef.current = snapshot }, [snapshot])
  useEffect(() => { previewRef.current = previewOrder }, [previewOrder])

  // Re-read settings/position whenever the config panel writes them.
  useEffect(() => {
    const handler = (): void => {
      const p = loadPos()
      posRef.current = p
      setPos(p)
      setColumns(loadColumns())
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handler)
  }, [])

  // Close the group manager popover on outside click / Escape.
  useEffect(() => {
    if (!groupMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null
      if (!target) return
      const inside = groupMenuBtnRef.current?.contains(target)
        || groupMenuRef.current?.contains(target)
      if (!inside) {
        setGroupMenuOpen(false)
        setGroupMenuPos(null)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setGroupMenuOpen(false)
        setGroupMenuPos(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [groupMenuOpen])

  // Keep a stored position inside the viewport: clamp once when it changes,
  // and again whenever the window resizes.
  useEffect(() => {
    if (!pos) return
    const clamp = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const current = posRef.current ?? pos
      const p = clampToViewport(current.x, current.y, rect.width, rect.height)
      if (p.x !== current.x || p.y !== current.y) {
        posRef.current = p
        setPos(p)
        savePos(p)
      }
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [pos])

  function startDrag(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const target = e.currentTarget
    try { target.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
    const rect = anchorRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
    }
    movedRef.current = false
    setDragging(true)
    e.preventDefault()
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true
    const rect = anchorRef.current?.getBoundingClientRect()
    const p = clampToViewport(
      d.originLeft + dx,
      d.originTop + dy,
      rect?.width ?? PANEL_W,
      rect?.height ?? 60,
    )
    posRef.current = p
    setPos(p)
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const wasTap = !movedRef.current
    dragRef.current = null
    setDragging(false)
    if (posRef.current) savePos(posRef.current)
    if (wasTap && collapsed) setCollapsed(false)
  }

  /** Start a TRAY chip drag (HTML5 DnD into the grid docks the widget). */
  function startWidgetDrag(e: ReactDragEvent, id: string): void {
    dragSourceRef.current = 'tray'
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function endWidgetDrag(): void {
    dragSourceRef.current = null
  }

  /** Drop onto the grid: a tray chip docks; card reorders are handled by the
   *  live pointer drag instead (see startCardReorder). */
  function onGridDrop(e: ReactDragEvent): void {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    dragSourceRef.current = null
    if (!id) return
    dock(id)
  }

  /** Start a live card-reorder drag: the card is LIFTED out of the grid into a
   *  ghost that follows the pointer; the remaining cards shuffle in real time.
   *  Listens on document so the ghost tracks even outside the grid. A tap
   *  (no movement) does not start a drag — only once the pointer moves beyond
   *  a small threshold does the reorder begin. */
  function startCardReorder(e: ReactPointerEvent<HTMLDivElement>, id: string, from: number): void {
    if (e.button !== 0) return
    const card = e.currentTarget
    const rect = card.getBoundingClientRect()
    reorderRef.current = {
      id,
      from,
      pointerId: e.pointerId,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
    }
    movedOutRef.current = false
    e.preventDefault()
  }

  /** Whether the pointer is OUTSIDE the grid area — releasing there undocks
   *  the dragged card (restores its floating panel). A small tolerance keeps
   *  near-edge releases as reorders. */
  function isOutsideGrid(clientX: number, clientY: number): boolean {
    const grid = gridRef.current
    if (!grid) return false
    const rect = grid.getBoundingClientRect()
    const tol = 24
    return clientX < rect.left - tol
      || clientX > rect.right + tol
      || clientY < rect.top - tol
      || clientY > rect.bottom + tol
  }

  /** Map the pointer position to a target index inside the grid (0..len),
   *  inserting before the cell the pointer is over. Returns -1 while the
   *  pointer is over the NON-grid panel area (tray / header / labels), so
   *  dragging there reads as "about to undock" rather than jumping to the
   *  first cell. */
  function indexFromPointer(clientX: number, clientY: number): number {
    const grid = gridRef.current
    if (!grid) return -1
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .' + css.card))
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom && clientX >= rect.left && clientX <= rect.right) {
        return i
      }
    }
    const rect = grid.getBoundingClientRect()
    // Outside the grid entirely (below/right edges): append / prepend.
    if (clientX > rect.right) return cards.length
    if (clientX < rect.left) return 0
    if (clientY > rect.bottom) return cards.length
    if (clientY < rect.top) return -1 // over the tray/header — undock territory
    // Inside the grid's bounds but between cards (row gaps): locate the row
    // under the pointer (first card whose bottom is below it), then map X
    // against THAT row's actual cells — a naive total-width/column-count
    // estimate breaks on multi-row grids.
    let rowStart = 0
    const rowCards: HTMLElement[] = []
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (rowCards.length > 0 && Math.abs(r.top - cards[rowStart].getBoundingClientRect().top) > 2) {
        break
      }
      rowCards.push(cards[i])
    }
    // Column under/after the pointer within the found row (or the first row
    // when the pointer sits between rows).
    const rowBottom = rowCards[rowCards.length - 1].getBoundingClientRect().bottom
    if (clientY >= rowBottom && rowStart + rowCards.length < cards.length) {
      // Pointer in the gap BELOW this row: target the start of the next row.
      return rowStart + rowCards.length
    }
    let colIndex = 0
    for (let c = 0; c < rowCards.length; c++) {
      const rc = rowCards[c].getBoundingClientRect()
      if (clientX >= (rc.left + rc.right) / 2) colIndex = c + 1
    }
    return Math.min(cards.length, rowStart + colIndex)
  }

  /** Which group tab the pointer is currently over (cross-group drop target),
   *  or null. */
  function groupFromPointer(clientX: number, clientY: number): string | null {
    for (const [id, el] of groupTabRefs.current) {
      const rect = el.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return id
      }
    }
    return null
  }

  /** Recompute the reorder preview from the given (latest) pointer coords.
   *  Runs at most once per animation frame (see scheduleReorderFrame). The
   *  ghost POSITION is updated per-event in onReorderMove (cheap); only the
   *  geometry read + shuffle/state work is throttled here. */
  function processReorderFrame(clientX: number, clientY: number): void {
    const r = reorderRef.current
    if (!r || previewRef.current === null) return
    // Cross-group drop target: hovering a GROUP TAB means the card moves to
    // that group on release. The ghost turns translucent so the (possibly
    // large) card stops hiding the tabs beneath; the green badge keeps the
    // destination unmistakable.
    const overGroup = groupFromPointer(clientX, clientY)
    if (overGroup !== dragGroupRef.current) {
      dragGroupRef.current = overGroup
      setDragGroup(overGroup)
      ghostRef.current?.classList.toggle(css.cardGhostGroup, overGroup !== null)
      ghostRef.current?.classList.toggle(css.cardGhostTranslucent, overGroup !== null)
    }
    if (overGroup !== null) {
      // Over a tab: no in-grid shuffle, no undock — just a group target.
      if (movedOutRef.current) {
        movedOutRef.current = false
        setDragOut(false)
        ghostRef.current?.classList.remove(css.cardGhostOut)
      }
      return
    }
    // Dragging OUTSIDE the grid means "undock this card" — the ghost turns
    // red as an affordance; releasing there restores the floating panel. The
    // non-grid panel area (tray/header) counts as outside too.
    const to = indexFromPointer(clientX, clientY)
    const outside = to < 0 || isOutsideGrid(clientX, clientY)
    if (outside !== movedOutRef.current) {
      movedOutRef.current = outside
      setDragOut(outside)
      ghostRef.current?.classList.toggle(css.cardGhostOut, outside)
    }
    if (outside || to < 0) return
    const current = previewRef.current ?? snapshotRef.current.docked
    const from = current.indexOf(r.id)
    if (from < 0) return
    const clamped = Math.min(Math.max(to, 0), current.length - 1)
    if (clamped === from) return
    const next = [...current]
    const [moved] = next.splice(from, 1)
    next.splice(clamped, 0, moved)
    setPreviewOrder(next)
  }

  /** Coalesce a burst of pointermove events into a single per-frame recompute
   *  of the reorder preview — the geometry read (querySelectorAll +
   *  getBoundingClientRect over every card + tab) is the expensive part and
   *  need not run on every event. */
  function scheduleReorderFrame(): void {
    if (moveRafRef.current !== null) return
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = null
      const px = latestMoveRef.current
      if (px !== null) processReorderFrame(px.x, px.y)
    })
  }

  function onReorderMove(e: PointerEvent): void {
    const r = reorderRef.current
    if (!r || r.pointerId !== e.pointerId) return
    // Deferred activation: a tap must not start a drag — only once the pointer
    // moves beyond a small threshold does the ghost lift + preview begin. This
    // check is cheap and must stay immediate so the ghost lifts on the first
    // qualifying move.
    if (previewRef.current === null) {
      if (Math.abs(e.clientX - r.startX) + Math.abs(e.clientY - r.startY) <= 6) return
      if (ghostRef.current) {
        ghostRef.current.classList.remove(css.cardGhostOut)
        ghostRef.current.style.left = `${e.clientX - r.grabX}px`
        ghostRef.current.style.top = `${e.clientY - r.grabY}px`
      }
      setPreviewOrder([...snapshotRef.current.docked])
      return
    }
    // Record the latest coords; the geometry-heavy work runs on the next frame.
    latestMoveRef.current = { x: e.clientX, y: e.clientY }
    // The ghost follows the pointer IMMEDIATELY (this is a cheap style write);
    // only the geometry read + shuffle is throttled to the frame.
    if (ghostRef.current) {
      ghostRef.current.style.left = `${e.clientX - r.grabX}px`
      ghostRef.current.style.top = `${e.clientY - r.grabY}px`
    }
    scheduleReorderFrame()
  }

  /** End the live reorder: a tap that never activated the drag is a no-op;
   *  release over a GROUP TAB moves the card to that group; release inside
   *  the grid persists the new order; release OUTSIDE the grid UNDOCKS the
   *  card (restores its floating panel). */
  function endCardReorder(e: PointerEvent): void {
    const r = reorderRef.current
    if (!r || r.pointerId !== e.pointerId) return
    // Flush any pending throttled frame so the drop target reflects the LAST
    // pointer position (the final move may not have been recomputed yet).
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current)
      moveRafRef.current = null
      const px = latestMoveRef.current
      if (px !== null) processReorderFrame(px.x, px.y)
    }
    latestMoveRef.current = null
    reorderRef.current = null
    const preview = previewRef.current
    const outside = movedOutRef.current
    const targetGroup = dragGroupRef.current
    dragGroupRef.current = null
    setDragGroup(null)
    setDragOut(false)
    movedOutRef.current = false
    setPreviewOrder(null)
    // Tap (no drag activated): nothing was moved or lifted — do nothing.
    if (preview === null) return
    // Cross-group drop: move the card to the hovered group (default group
    // excluded — its tab is not a valid target when already there).
    if (targetGroup !== null && targetGroup !== snapshotRef.current.activeGroup) {
      dockTo(r.id, targetGroup)
      return
    }
    if (outside) {
      undock(r.id)
      return
    }
    const to = preview.indexOf(r.id)
    if (to >= 0 && to !== r.from) move(r.from, to)
  }

  // Document-level pointer listeners drive the ghost + live shuffle, so the
  // dragged card follows the cursor even when it leaves the grid bounds.
  // Subscribed once; the handlers read the latest state through refs.
  useEffect(() => {
    document.addEventListener('pointermove', onReorderMove)
    document.addEventListener('pointerup', endCardReorder)
    document.addEventListener('pointercancel', endCardReorder)
    return () => {
      if (moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current)
        moveRafRef.current = null
      }
      document.removeEventListener('pointermove', onReorderMove)
      document.removeEventListener('pointerup', endCardReorder)
      document.removeEventListener('pointercancel', endCardReorder)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Floating-widget drag observation: dragging ANOTHER overlay widget (its
  // root carries `data-widget-id`) over the container docks it on release —
  // without intercepting the widget's own drag (no preventDefault, no capture;
  // we only read pointer position and the widget's live rect). Only a REAL
  // drag (moved beyond the threshold) can dock — a plain click on a floating
  // widget must never accidentally dock it. Releasing inside the grid calls
  // dock(id); elsewhere the widget just keeps its floating position.
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      // Left button only; and do not disturb our own card-reorder or panel drags.
      if (e.button !== 0) return
      if (reorderRef.current !== null || dragRef.current !== null) return
      const target = e.target as HTMLElement | null
      const el = target?.closest('[data-widget-id]')
      const id = el?.getAttribute('data-widget-id')
      if (!id || id === SELF_ID) return
      // Only watch widgets that are actually dockable (enabled winners).
      const winner = snapshotRef.current.available.includes(id)
      if (!winner) return
      floatDragRef.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
    }
    const onMove = (e: PointerEvent): void => {
      const f = floatDragRef.current
      if (!f || f.pointerId !== e.pointerId) return
      // Mark as a real drag once the pointer moves beyond the threshold — a
      // plain click must never dock.
      if (!f.moved) {
        if (Math.abs(e.clientX - f.x) + Math.abs(e.clientY - f.y) <= 6) return
        f.moved = true
      }
      // Dock when the dragged WIDGET's rect overlaps the grid — matching the
      // visual reality (a large floating panel that covers the grid docks),
      // rather than requiring the pointer itself to be inside.
      const grid = gridRef.current
      const widgetEl = document.querySelector<HTMLElement>(`[data-widget-id="${f.id}"]`)
      const over = grid !== null && widgetEl !== null
        && rectsOverlap(widgetEl.getBoundingClientRect(), grid.getBoundingClientRect())
      if (over !== floatOverGrid) setFloatOverGrid(over)
    }
    const onUp = (e: PointerEvent): void => {
      const f = floatDragRef.current
      if (!f || f.pointerId !== e.pointerId) return
      floatDragRef.current = null
      setFloatOverGrid(false)
      // Only a real drag whose WIDGET overlaps the grid on release docks.
      if (!f.moved) return
      const grid = gridRef.current
      const widgetEl = document.querySelector<HTMLElement>(`[data-widget-id="${f.id}"]`)
      if (grid !== null && widgetEl !== null
        && rectsOverlap(widgetEl.getBoundingClientRect(), grid.getBoundingClientRect())) {
        dock(f.id)
      }
    }
    const onCancel = (e: PointerEvent): void => {
      const f = floatDragRef.current
      if (!f || f.pointerId !== e.pointerId) return
      floatDragRef.current = null
      setFloatOverGrid(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const anchorStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 9997,
    pointerEvents: 'auto',
    touchAction: 'none',
  }
  if (pos) {
    anchorStyle.left = pos.x
    anchorStyle.top = pos.y
  } else {
    anchorStyle.left = DEFAULT_LEFT
    anchorStyle.top = DEFAULT_TOP
  }

  const gridStyle: CSSProperties = {
    gridTemplateColumns: columns === 'auto'
      ? 'repeat(auto-fill, minmax(170px, 1fr))'
      : `repeat(${columns}, 1fr)`,
  }

  // With no docked cards the container must stay fully visible (its chrome
  // would otherwise be unreachable), so the auto-hide behavior only applies
  // once at least one card is docked. While a card drag is in flight (from
  // pointerdown to pointerup) the panel surface AND the chrome stay visible
  // too — the group tabs are the cross-group drop targets, so they must
  // remain reachable even when the pointer leaves the panel. reorderRef is a
  // ref, so this is read during render from the latest committed pointerdown.
  const hasCards = snapshot.docked.length > 0
  const dragActive = reorderRef.current !== null
  const chromeVisible = hovered || !hasCards || dragActive
  /** Panel surface visible: hovered, empty, or mid-drag. */
  const panelSurface = chromeVisible
  /** Order actually rendered: the live reorder preview while dragging a card,
   *  else the persisted docked order. */
  const renderOrder = previewOrder ?? snapshot.docked
  /** Name of the group a card drag currently targets (drop = move there). */
  const dragGroupName = dragGroup !== null
    ? snapshot.groups.find((g) => g.id === dragGroup)?.name ?? dragGroup
    : null
  /** Widget ids docked across EVERY group (a widget lives in one group only). */
  const totalDockedAll = snapshot.groups.reduce((n, g) => n + g.docked.length, 0)

  /** ARIA tabs keyboard navigation: arrows/Home/End move focus AND activate
   *  (auto-activation), the standard behaviour for a lightweight tab switcher. */
  function onGroupTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, currentId: string): void {
    const ids = snapshot.groups.map((g) => g.id)
    const cur = ids.indexOf(currentId)
    if (cur < 0) return
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % ids.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + ids.length) % ids.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ids.length - 1
    else return
    e.preventDefault()
    const nextId = ids[next]
    setActiveGroup(nextId)
    groupTabRefs.current.get(nextId)?.focus()
  }

  let body
  if (collapsed) {
    body = (
      <div
        className={[css.pill, dragging ? css.dragging : ''].filter(Boolean).join(' ')}
        role="button"
        tabIndex={0}
        title={t('expand')}
        onPointerDown={startDrag}
        onKeyDown={(e) => {
          // Keyboard access to expand the pill (pointer taps already expand via endDrag).
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(false)
          }
        }}
      >
        <span className={css.pillIcon}>▦</span>
        <span className={css.pillText}>{t('title')}</span>
        <span className={css.pillCount}>{snapshot.docked.length}</span>
      </div>
    )
  } else {
    body = (
      <div
        className={[
          css.panel,
          panelSurface ? css.panelHover : '',
          dragging ? css.dragging : '',
        ].filter(Boolean).join(' ')}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Chrome (header + tray + section labels): fades in while hovered so
            at rest the container shows only the docked cards — except while
            no card is docked, when it stays fully visible. */}
        <div className={[css.chrome, chromeVisible ? css.chromeVisible : ''].filter(Boolean).join(' ')}>
          <div className={css.header} onPointerDown={startDrag}>
            <span className={css.titleDot} />
            <span className={css.title}>{t('title')}</span>
            <span
              className={css.count}
              title={t('countTip', {
                docked: snapshot.docked.length,
                total: snapshot.available.length + totalDockedAll,
              })}
            >
              {snapshot.docked.length} / {snapshot.available.length + totalDockedAll}
            </span>
            <button
              className={css.iconBtn}
              title={t('collapse')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setCollapsed(true)}
            >
              —
            </button>
          </div>

          {/* Group switcher: tabs over the named groups; the active group's
              cards are shown. The trailing button opens the group manager
              (add / rename / delete). */}
          <div className={css.groupBar}>
            <div className={css.groupTabs} role="tablist" aria-orientation="horizontal">
              {snapshot.groups.map((group) => (
                <button
                  key={group.id}
                  ref={(el) => {
                    if (el) groupTabRefs.current.set(group.id, el)
                    else groupTabRefs.current.delete(group.id)
                  }}
                  type="button"
                  role="tab"
                  id={`cc-tab-${group.id}`}
                  aria-selected={group.id === snapshot.activeGroup}
                  aria-controls="cc-group-panel"
                  tabIndex={group.id === snapshot.activeGroup ? 0 : -1}
                  className={[
                    css.groupTab,
                    group.id === snapshot.activeGroup ? css.groupTabActive : '',
                    dragGroup === group.id ? css.groupTabDrop : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setActiveGroup(group.id)}
                  onKeyDown={(e) => onGroupTabKeyDown(e, group.id)}
                >
                  <span className={css.groupTabName}>{groupLabel(group)}</span>
                  <span className={css.groupTabCount}>{group.docked.length}</span>
                </button>
              ))}
            </div>
            <div className={css.groupActions}>
              <button
                ref={groupMenuBtnRef}
                type="button"
                className={css.groupBtn}
                title={t('manageGroups')}
                onClick={() => {
                  const btn = groupMenuBtnRef.current
                  if (!btn) { setGroupMenuOpen((v) => !v); return }
                  const rect = btn.getBoundingClientRect()
                  if (groupMenuOpen) {
                    setGroupMenuOpen(false)
                    setGroupMenuPos(null)
                  } else {
                    // Anchor below the button, right-aligned, in viewport
                    // coordinates (the menu is rendered at the anchor layer,
                    // outside the overflow-hidden panel).
                    setGroupMenuPos({ left: Math.max(8, rect.right - 220), top: rect.bottom + 4 })
                    setGroupMenuOpen(true)
                  }
                }}
              >
                ⋯
              </button>
            </div>
          </div>

          {/* Tray: the currently enabled widgets that can be docked. */}
          <div className={css.tray}>
            <div className={css.sectionHead}>
              <span className={css.sectionTitle}>{t('trayTitle')}</span>
              <span className={css.sectionHint}>{t('trayHint')}</span>
            </div>
            {snapshot.available.length === 0
              ? <div className={css.empty}>{t('trayEmpty')}</div>
              : (
                <div className={css.trayChips}>
                  {snapshot.available.map((id) => (
                    <div
                      key={id}
                      className={css.chip}
                      draggable
                      role="button"
                      tabIndex={0}
                      title={t('dock')}
                      onDragStart={(e) => startWidgetDrag(e, id)}
                      onDragEnd={endWidgetDrag}
                      onClick={() => dock(id)}
                      onKeyDown={(e) => {
                        // Keyboard access to dock (pointer click already docks).
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          dock(id)
                        }
                      }}
                    >
                      <span className={css.chipGrip} aria-hidden="true" />
                      <span className={css.chipDot} />
                      <span className={css.chipName}>{labelOf(id)}</span>
                      <span className={css.chipAdd} aria-hidden="true">+</span>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>

        {/* Grid: the docked widget cards, evenly spaced. */}
        <div className={css.gridWrap} role="tabpanel" id="cc-group-panel" aria-labelledby={`cc-tab-${snapshot.activeGroup}`}>
          <div className={[css.sectionHead, css.chrome, chromeVisible ? css.chromeVisible : ''].filter(Boolean).join(' ')}>
            <span className={css.sectionTitle}>{t('gridTitle')}</span>
            {hasCards && <span className={css.sectionHint}>{t('gridHint')}</span>}
          </div>
          {snapshot.docked.length === 0
            ? (
              <div className={[css.empty, css.emptyGuide, css.chrome, chromeVisible ? css.chromeVisible : ''].filter(Boolean).join(' ')}>
                <span className={css.emptyIcon}>▦</span>
                <span className={css.emptyTitle}>{t('gridEmptyTitle')}</span>
                <span className={css.emptyDesc}>{t('gridEmpty')}</span>
                {snapshot.available.length > 0 && (
                  <button
                    className={css.dockAllBtn}
                    type="button"
                    onClick={() => snapshot.available.forEach((id) => dock(id))}
                  >
                    {t('dockAll')}
                  </button>
                )}
              </div>
            )
            : (
              <div
                ref={gridRef}
                className={[
                  css.grid,
                  previewOrder !== null ? css.gridRearranging : '',
                  floatOverGrid ? css.gridDropTarget : '',
                ].filter(Boolean).join(' ')}
                style={gridStyle}
                onDragOver={(e) => { e.preventDefault() }}
                onDrop={onGridDrop}
              >
                {renderOrder.map((id, index) => {
                  const spec = specOf(id)
                  const isDragged = reorderRef.current?.id === id
                  return (
                  <div
                    key={id}
                    role="group"
                    aria-label={labelOf(id)}
                    tabIndex={0}
                    className={[
                      css.card,
                      spec === 'medium' ? css.cardMedium : '',
                      spec === 'large' ? css.cardLarge : '',
                      isDragged ? css.cardGhostSlot : '',
                    ].filter(Boolean).join(' ')}
                    onPointerDown={(e) => startCardReorder(e, id, index)}
                    onKeyDown={(e) => {
                      // Keyboard accessibility: Enter/Space undocks; arrow keys
                      // reorder within the active group.
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        undock(id)
                        return
                      }
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        if (index > 0) move(index, index - 1)
                        return
                      }
                      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        e.preventDefault()
                        if (index < renderOrder.length - 1) move(index, index + 1)
                      }
                    }}
                  >
                    {!isDragged && (
                      <>
                        <div className={css.cardHead}>
                          <span className={css.cardTitle}>{labelOf(id)}</span>
                          <button
                            className={css.undockBtn}
                            title={t('undock')}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); undock(id) }}
                          >
                            ×
                          </button>
                        </div>
                        <div className={css.cardBody}>
                          {renderSlot('widgets.card', {}, {
                            only: id,
                            fallback: (
                              <div className={css.cardFallback}>
                                {t('cardMissing')}
                              </div>
                            ),
                          })}
                        </div>
                      </>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={anchorRef}
      className={css.anchor}
      style={anchorStyle}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {body}
      {/* Lifted card ghost: renders the dragged card's content in a
          fixed-position layer that follows the pointer 1:1 while reordering.
          Rendered only once the drag actually activates (previewOrder set).
          Width follows the card's spec (medium/large get wider ghosts). */}
      {previewOrder !== null && reorderRef.current !== null && (
        <div
          ref={ghostRef}
          className={[
            css.cardGhost,
            specOf(reorderRef.current.id) === 'medium' ? css.cardGhostMedium : '',
            specOf(reorderRef.current.id) === 'large' ? css.cardGhostLarge : '',
          ].filter(Boolean).join(' ')}
        >
          {/* Drop-target badge: makes the destination unmistakable even when
              the (possibly large) ghost covers the group tabs. */}
          <div
            className={[
              css.ghostBadge,
              dragGroup !== null ? css.ghostBadgeGroup : '',
              dragOut ? css.ghostBadgeOut : '',
            ].filter(Boolean).join(' ')}
          >
            {dragGroup !== null
              ? t('dropToGroup', { name: dragGroupName ?? dragGroup })
              : dragOut
                ? t('dropToUndock')
                : t('dropToReorder')}
          </div>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{labelOf(reorderRef.current.id)}</span>
          </div>
          <div className={css.cardBody}>
            {renderSlot('widgets.card', {}, {
              only: reorderRef.current.id,
              fallback: (
                <div className={css.cardFallback}>
                  {t('cardMissing')}
                </div>
              ),
            })}
          </div>
        </div>
      )}

      {/* Group manager popover: fixed-position so the overflow-hidden panel
          cannot clip it (the in-panel version made the delete button
          unreachable when the tray grew tall). */}
      {groupMenuOpen && groupMenuPos !== null && (
        <div ref={groupMenuRef} className={css.groupMenu} style={{ left: groupMenuPos.left, top: groupMenuPos.top }}>
          <div className={css.groupMenuRow}>
            <input
              className={css.groupInput}
              value={groupNameDraft}
              placeholder={t('newGroupPlaceholder')}
              onChange={(e) => setGroupNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && groupNameDraft.trim() !== '') {
                  addGroup(groupNameDraft)
                  setGroupNameDraft('')
                  setGroupMenuOpen(false)
                  setGroupMenuPos(null)
                }
              }}
            />
            <button
              type="button"
              className={css.groupBtn}
              disabled={groupNameDraft.trim() === ''}
              onClick={() => {
                if (groupNameDraft.trim() === '') return
                addGroup(groupNameDraft)
                setGroupNameDraft('')
                setGroupMenuOpen(false)
                setGroupMenuPos(null)
              }}
            >
              +
            </button>
          </div>
          {snapshot.groups.map((group) => (
            <div key={group.id} className={css.groupMenuRow}>
              {renamingGroup === group.id
                ? (
                  <input
                    className={css.groupInput}
                    defaultValue={group.name}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (e.currentTarget.value.trim() !== '') renameGroup(group.id, e.currentTarget.value)
                        setRenamingGroup(null)
                      } else if (e.key === 'Escape') {
                        setRenamingGroup(null)
                      }
                    }}
                    onBlur={() => setRenamingGroup(null)}
                  />
                )
                : <span className={css.groupMenuName}>{groupLabel(group)}</span>}
              <button
                type="button"
                className={css.groupBtn}
                disabled={group.id === DEFAULT_GROUP}
                title={t('renameGroup')}
                onClick={() => { setRenamingGroup(group.id) }}
              >
                ✎
              </button>
              <button
                type="button"
                className={css.groupBtn}
                disabled={group.id === DEFAULT_GROUP}
                title={t('deleteGroup')}
                onClick={() => {
                  removeGroup(group.id)
                  // Deleting the active group switches to default — close the
                  // menu so the new state is obvious.
                  setGroupMenuOpen(false)
                  setGroupMenuPos(null)
                  setRenamingGroup(null)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

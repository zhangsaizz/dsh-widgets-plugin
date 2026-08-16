/**
 * View-interaction store for the balance widget: zoom scale, dock corner,
 * free position, and collapsed state. The balance DATA arrives through the
 * inject hooks compartment; this store carries only what the widget itself
 * chooses (and persists across reloads).
 *
 * @module @dsh-plugins/balance/client/store
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Dock corner, or \`free\` for drag-placed position. */
export type DockCorner = 'free' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** Which balance view the widget renders: the current session's provider, or every configured provider. */
export type BalanceViewMode = 'current' | 'all'

/** Persisted view settings. */
export interface BalanceViewSettings {
  /** Zoom scale (content is CSS-scaled). */
  scale: number
  /** Snap corner; \`free\` uses {@link BalanceViewSettings.position}. */
  dock: DockCorner
  /** Free top-left offset in px, used while \`dock\` is \`free\`. */
  position: { x: number; y: number }
  /** Collapsed to a compact pill. */
  collapsed: boolean
  /** Single-account (current provider) or multi-account (all configured) view. */
  mode: BalanceViewMode
}

/** Minimum zoom scale. */
export const MIN_SCALE = 0.75
/** Maximum zoom scale. */
export const MAX_SCALE = 1.5
/** Zoom step between adjacent scale levels. */
export const SCALE_STEP = 0.25

/** Round to two decimals so zoom steps stay clean under float arithmetic. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type BalanceViewActions = {
  zoomIn: (draft: BalanceViewSettings) => void
  zoomOut: (draft: BalanceViewSettings) => void
  resetZoom: (draft: BalanceViewSettings) => void
  dockTo: (draft: BalanceViewSettings, corner: DockCorner) => void
  setPosition: (draft: BalanceViewSettings, x: number, y: number) => void
  toggleCollapsed: (draft: BalanceViewSettings) => void
  setMode: (draft: BalanceViewSettings, mode: BalanceViewMode) => void
}

/**
 * Create the balance widget's view-settings store handle. Zoom clamps into
 * the {@link MIN_SCALE}–{@link MAX_SCALE} range in {@link SCALE_STEP} steps,
 * and the whole state persists to \`localStorage\` under \`dsh.balance.view\`.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createBalanceViewStore(): EngineStoreHandle<BalanceViewSettings, BalanceViewActions> {
  const handle = defineStore({
    init: (): BalanceViewSettings => ({
      scale: 1,
      dock: 'bottom-right',
      position: { x: 24, y: 24 },
      collapsed: false,
      mode: 'current',
    }),
    persist: 'dsh.balance.view',
    actions: {
      zoomIn: (d) => { d.scale = Math.min(MAX_SCALE, round2(d.scale + SCALE_STEP)) },
      zoomOut: (d) => { d.scale = Math.max(MIN_SCALE, round2(d.scale - SCALE_STEP)) },
      resetZoom: (d) => { d.scale = 1 },
      dockTo: (d, corner: DockCorner) => { d.dock = corner },
      setPosition: (d, x: number, y: number) => { d.position = { x, y } },
      toggleCollapsed: (d) => { d.collapsed = !d.collapsed },
      setMode: (d, mode: BalanceViewMode) => { d.mode = mode },
    },
  })
  return handle
}

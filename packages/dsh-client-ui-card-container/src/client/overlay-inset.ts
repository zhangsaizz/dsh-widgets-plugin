/**
 * Desktop-shell viewport inset for a floating overlay.
 *
 * The official desktop renders its own window chrome in the web document and
 * publishes the band it occupies on `<html>` as `--dsh-frame-top-clearance`
 * (harness `packages/client/ui-layout/src/client/AppFrame.module.css`): 48px for
 * the macOS traffic lights plus the frame's leading window controls, 40px for
 * the Windows caption strip carrying the Application/Edit menu, the sidebar
 * controls and the native window buttons. Neither band is freed in fullscreen —
 * the strip is the frame's own caption layer, the macOS lights are native, and
 * the caption menu stays `position: fixed` — so the step below it is the same in
 * windowed and fullscreen states. That is also why this helper does not use the
 * shell's `--dsh-frame-overlay-top`, whose fullscreen value drops to 20px for
 * *centered* overlays that may safely cover the band; a floating widget may not.
 * Plain web publishes no band and keeps its own margin.
 *
 * The arithmetic mirrors the harness's own `overlayTopMargin()` helper
 * (`@deepseek-ai/dsh-client-ui-primitives`, which does not export it), minus
 * that fullscreen reduction.
 *
 * The container panel dragged to the top edge would otherwise slide under that
 * chrome; on Windows it would also swallow the caption's window-drag band, so a
 * click meant for the panel would move the window instead.
 *
 * @module @dsh-plugins/client-ui-card-container/client/overlay-inset
 */

/** Last resolved value, keyed by everything the inset depends on. */
let cachedKey = ''
let cachedInset = 0

/**
 * Resolve the top inset a floating overlay keeps from the viewport edge.
 * @param fallback - the widget's own top margin, used as the floor and as the
 *   web-app answer when the shell publishes no window-chrome band.
 * @returns the larger of `fallback` and the shell's band plus a 20px gap, in px.
 */
export function overlayTopInset(fallback: number): number {
  const root = document.documentElement
  // The band is a pure function of the platform marker and the Windows-caption
  // marker — the shell publishes it from its stylesheet gated on exactly those
  // — so these attributes are a complete cache key; reading the computed style
  // on every pointer-move frame would force a style flush right after the layout
  // read the drag already performs. A miss is cached for the same reason: on a
  // marked platform the band's presence is fixed for the document's life, and
  // the shell sets its markers before this plugin's first render.
  const key = `${root.dataset.platform ?? ''}|${root.hasAttribute('data-windows-titlebar')}|${fallback}`
  if (key === cachedKey) return cachedInset
  const clearance = Number.parseFloat(getComputedStyle(root).getPropertyValue('--dsh-frame-top-clearance'))
  cachedInset = Number.isFinite(clearance) ? Math.max(fallback, clearance + 20) : fallback
  cachedKey = key
  return cachedInset
}

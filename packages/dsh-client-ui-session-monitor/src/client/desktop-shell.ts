/**
 * Which desktop shell (if any) hosts this page.
 *
 * Two shells can host the widget:
 *  - the **official DeepSeek Harness desktop** (Electron), which exposes
 *    `window.dshDesktop` to its application document
 *    (`apps/desktop/src/preload-app.ts` in the harness) and lets the dashboard
 *    live in the main window — nothing to launch, and its session list is the
 *    app's own;
 *  - the **self-built Tauri companion** (`desktop/dsh-session-desktop`), which
 *    exposes `window.__TAURI__` and is brought up through the `dsh-smon://`
 *    protocol registered by the widget page.
 *
 * Only the Tauri companion needs the `dsh-smon://` launch switch and the
 * server-mediated jump queue; inside the official desktop that switch has
 * nothing to launch (the app is already running this page) and is hidden.
 *
 * @module @dsh-plugins/client-ui-session-monitor/client/desktop-shell
 */

/**
 * Whether the page runs inside the official Electron desktop renderer.
 * @returns true when the harness desktop exposes its `dshDesktop` bridge.
 */
export function inOfficialDesktop(): boolean {
  return 'dshDesktop' in globalThis
}

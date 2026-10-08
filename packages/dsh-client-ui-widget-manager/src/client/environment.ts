/**
 * Which shell hosts this page, and what that environment can actually do.
 *
 * The widget UI runs in one of three places, and a config panel must only
 * offer options the current one can honour:
 *  - **web** — a browser tab on the Harness Web app (`dsh web`, loopback);
 *  - **official-desktop** — the official DeepSeek Harness desktop (Electron),
 *    which exposes `window.dshDesktop` to its application document
 *    (`apps/desktop/src/preload-app.ts` in the harness) and hosts the dashboard
 *    in its own main window;
 *  - **tauri** — the self-built Tauri companion
 *    (`desktop/dsh-session-desktop`), which exposes `window.__TAURI__` and only
 *    ever talks to the WEB deployment (`dsh-smon://` → 127.0.0.1:3080).
 *
 * Panels ask this module instead of probing the bridges themselves, so the
 * classification lives in one place and the capability probes (`Notification`,
 * WebAudio) travel with it. Each package carries its own copy — they publish
 * independently, so a shared package is not an option — and
 * `scripts/build.mjs` fails the build when the copies drift apart.
 *
 * @module @dsh-plugins/client-ui-widget-manager/client/environment
 */

/** Which shell hosts this page. */
export type ShellEnvironment = 'web' | 'official-desktop' | 'tauri'

/** Tauri 2's injected global (the self-built companion shell). */
const TAURI_BRIDGE = '__TAURI__'
/** The official Electron desktop's preload bridge. */
const DESKTOP_BRIDGE = 'dshDesktop'

/**
 * Classify the hosting shell. The two bridges are disjoint in practice (the
 * companion's WebView is plain Chromium, the official renderer is Electron),
 * and the narrower shell wins if a future build exposes both.
 * @returns the hosting shell.
 */
export function detectEnvironment(): ShellEnvironment {
  if (TAURI_BRIDGE in globalThis) return 'tauri'
  if (DESKTOP_BRIDGE in globalThis) return 'official-desktop'
  return 'web'
}

/**
 * Whether this environment can raise a system/browser notification at all.
 * Some embedded WebViews ship without the API; a switch that can never be
 * turned on is worse than an absent option, so panels omit the row.
 * @returns true when `Notification` is defined.
 */
export function supportsSystemNotifications(): boolean {
  return typeof Notification !== 'undefined'
}

/**
 * Whether this environment can synthesise the notification chime (WebAudio).
 * @returns true when an AudioContext constructor is exposed.
 */
export function supportsAudioChime(): boolean {
  const scope = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown }
  return typeof scope.AudioContext === 'function' || typeof scope.webkitAudioContext === 'function'
}

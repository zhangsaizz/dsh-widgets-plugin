/**
 * Session monitor plugin, browser half: one register() call contributes the
 * floating SessionMonitorWidget into the shell.overlay list, and a second one
 * registers its configuration panel into the widget manager's "Configure"
 * dialog (`widgets.config`, id `session-monitor`). The session LIST and
 * running bits ride the standard `useSessions` global prop — the runtime
 * pushes session-list and running-status updates reactively, so the list needs
 * no Host RPC. Only the turn-end REASON table (toast refinement) is polled
 * from the Host status route every few seconds. The jump-to-session verb
 * closes over `ctx.sessions.open`.
 *
 * @module @dsh-plugins/client-ui-session-monitor/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `widgets.config` SlotMap merge declared by the widget
// manager (the config panel lives in its "Configure" dialog).
import type {} from '@dsh-plugins/client-ui-widget-manager/client'
import { SessionMonitorWidget, RELAY_EVENT } from './SessionMonitorWidget.tsx'
import type { SessionMonitorInject } from './SessionMonitorWidget.tsx'
import { SessionSettings } from './SessionSettings.tsx'
import type { SessionSettingsInjected } from './SessionSettings.tsx'
import { en, zh } from './locales.ts'
import type { SessionMonitorKey } from './locales.ts'

export type { MonitorSettings } from './settings.ts'
export { DEFAULT_SETTINGS, POS_KEY, loadSettings, saveSettings } from './settings.ts'
export type { SessionMonitorInject, SessionMonitorWidgetProps } from './SessionMonitorWidget.tsx'
export type { SessionSettingsInjected } from './SessionSettings.tsx'
export type { SessionMonitorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by this plugin. */
    'session-monitor': SessionMonitorKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'session-monitor'

/**
 * Server-mediated desktop bridge. The desktop widget lives in the Tauri
 * WebView2 webview, whose storage partition is separate from the browser's —
 * BroadcastChannel / localStorage cannot cross it. Both sides therefore go
 * through Host routes instead:
 *
 *  - Settings mirror (`/_dsh/session-monitor/settings`): this half pushes the
 *    web's localStorage settings on every save and pulls the Host store on
 *    boot + poll, so the web widget/config panel (which keep reading
 *    localStorage unchanged) stay consistent with the desktop widget.
 *  - Jump queue (`/_dsh/session-monitor/jump`): the desktop widget posts
 *    `{ sessionId }` on a row click; this half polls, opens the session in
 *    place and marks it consumed; the desktop falls back to the browser when
 *    nothing consumed it in time.
 */
export const SETTINGS_ROUTE = '/_dsh/session-monitor/settings'
export const JUMP_ROUTE = '/_dsh/session-monitor/jump'
export const JUMP_POLL_ROUTE = '/_dsh/session-monitor/jump/poll'
/** Host route relaying client-transient interaction pauses into the inbox. */
export const EVENTS_ROUTE = '/_dsh/session-monitor/events'
export const SETTINGS_KEY = 'dsh.smon.settings'
export const SETTINGS_CHANGED_EVENT = 'dsh.smon.settings-changed'
const SETTINGS_POLL_MS = 5000

/** Query param the desktop widget appends when it falls back to opening the
 *  web app in the browser; this half selects the session on boot. */
const BOOT_OPEN_PARAM = 'dsh-open'

/**
 * Required services: the slot registry, the client sessions service (for
 * jump-to-session) and the locale face.
 */
export const inject = ['slots', 'sessions', 'locale']

/** Fetch the Host bridge route and unwrap the `{ ok, value }` envelope. */
function bridgeFetch(input: string, init?: RequestInit): Promise<{ ok: boolean; value?: unknown }> {
  return fetch(input, { cache: 'no-store', ...init })
    .then((res) => res.json() as Promise<{ ok?: boolean; value?: unknown }>)
    .then((body) => ({ ok: body.ok === true, value: body.value }))
    .catch(() => ({ ok: false }))
}

/** Debounce helper for the settings push (one save storm → one POST). */
function debounce(fn: () => void, ms: number): () => void {
  let timer: number | undefined
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(fn, ms)
  }
}

/**
 * Client plugin body: register the floating dashboard and its config panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-monitor: dictionaries')

  // ── Settings mirror (web localStorage ⇄ Host store) ────────────────
  const pushSettings = debounce(() => {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return
    void bridgeFetch(SETTINGS_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    })
  }, 300)
  const onLocalSettingsSaved = (): void => { pushSettings() }
  window.addEventListener(SETTINGS_CHANGED_EVENT, onLocalSettingsSaved)
  ctx.effect(() => () => {
    window.removeEventListener(SETTINGS_CHANGED_EVENT, onLocalSettingsSaved)
  }, 'session-monitor: settings push')

  // Pull the Host store; apply to localStorage + notify only when it differs
  // (a change from the desktop side must reach the mounted widget live).
  let lastServerSettings = ''
  const pullSettings = (): void => {
    void bridgeFetch(SETTINGS_ROUTE).then((body) => {
      if (!body.ok || body.value === undefined || typeof body.value !== 'object') return
      const next = JSON.stringify(body.value)
      if (next === lastServerSettings) return
      lastServerSettings = next
      if (next !== window.localStorage.getItem(SETTINGS_KEY)) {
        window.localStorage.setItem(SETTINGS_KEY, next)
        try { window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT)) } catch { /* ignore */ }
      }
    })
  }
  pullSettings()
  const settingsPoll = window.setInterval(pullSettings, SETTINGS_POLL_MS)
  ctx.effect(() => () => clearInterval(settingsPoll), 'session-monitor: settings pull')

  // ── Interaction relay (widget → Host inbox) ──────────────────────────
  // The widget dispatches RELAY_EVENT when a client-transient interaction
  // pause (question / plan-review — states that never hit the session log)
  // appears or disappears; this half forwards it to the Host inbox so the
  // desktop widget sees "waiting for you" items. Idempotent server-side, so
  // repeated dispatches (StrictMode double effects) are harmless.
  const onRelay = (event: Event): void => {
    const detail = (event as CustomEvent<{
      sessionId?: unknown
      kind?: unknown
      state?: unknown
      title?: unknown
    }>).detail
    if (detail === null || typeof detail !== 'object') return
    if (typeof detail.sessionId !== 'string' || detail.sessionId.length === 0) return
    const kind = detail.kind === 'question' || detail.kind === 'plan-review' ? detail.kind : undefined
    if (kind === undefined) return
    void bridgeFetch(EVENTS_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: detail.sessionId,
        kind,
        state: detail.state === 'closed' ? 'closed' : 'open',
        title: typeof detail.title === 'string' ? detail.title : '',
      }),
    })
  }
  window.addEventListener(RELAY_EVENT, onRelay)
  ctx.effect(() => () => {
    window.removeEventListener(RELAY_EVENT, onRelay)
  }, 'session-monitor: interaction relay')

  // ── Jump queue (desktop row click → this web tab switches in place) ──
  // Long-poll loop: hold a fetch open until a jump arrives, handle it, and
  // re-issue immediately. Held fetches are NOT subject to the background-tab
  // timer throttling that would stall a setInterval poll (Chrome clamps
  // background timers to ~1/min after a few minutes).
  let lastJumpHandledAt = 0
  const pollJump = (): void => {
    void bridgeFetch(JUMP_POLL_ROUTE).then((body) => {
      const value = body.value as { sessionId?: unknown; at?: unknown; consumed?: unknown } | null
      if (body.ok && value !== null && typeof value.sessionId === 'string' && value.consumed !== true) {
        const at = typeof value.at === 'number' ? value.at : 0
        if (at > lastJumpHandledAt) {
          lastJumpHandledAt = at
          try {
            ctx.sessions.open(value.sessionId as SessionId)
            try { window.focus() } catch { /* ignore */ }
            void bridgeFetch(JUMP_ROUTE, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ consume: true }),
            })
          } catch (error) {
            // Unknown / not-yet-listed session: leave it unconsumed so the
            // desktop widget falls back to the browser.
            ctx.logger?.warn?.(`session-monitor: desktop jump failed: ${String(error)}`)
          }
        }
      }
      if (body.ok) {
        // The held fetch settled (jump arrived or the server timed it out) —
        // re-issue immediately. NO timer on this path, so background-tab
        // timer throttling cannot stall consumption.
        pollJump()
      } else {
        // Server unreachable: back off, then retry.
        setTimeout(pollJump, 2000)
      }
    })
  }
  pollJump()
  ctx.effect(() => () => { /* the loop dies with the page */ }, 'session-monitor: jump poll')

  // Heartbeat: proves an open web tab runs this half. The desktop widget uses
  // `webAlive` to decide how long to wait for consumption before falling back
  // to the system browser (alive → wait; dead → fall back quickly).
  const ping = (): void => {
    void bridgeFetch(JUMP_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping: true }),
    })
  }
  ping()
  const pingTimer = window.setInterval(ping, 3000)
  ctx.effect(() => () => clearInterval(pingTimer), 'session-monitor: jump ping')

  // Boot deep link (?dsh-open=<sessionId>): the desktop widget's browser
  // fallback opens the web app with this param; select the session once the
  // list is available (open() throws while the target is not yet listed).
  const bootTarget = new URLSearchParams(window.location.search).get(BOOT_OPEN_PARAM)
  if (bootTarget) {
    let attempts = 0
    const tryOpen = (): void => {
      attempts++
      try {
        ctx.sessions.open(bootTarget as SessionId)
      } catch {
        if (attempts < 6) setTimeout(tryOpen, 800 * attempts)
      }
    }
    setTimeout(tryOpen, 800)
  }

  const t = ctx.locale.bind(NS)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-monitor',
    order: 90,
    label: () => t('title'),
    locale: NS,
    inject: (): SessionMonitorInject => ({
      open: (sessionId) => { ctx.sessions.open(sessionId as SessionId) },
    }),
  }, SessionMonitorWidget))

  // The config panel: registered only while the widget manager declares the
  // `widgets.config` slot, so installs without the manager simply skip it.
  ctx.slots.inject('widgets.config', () => ctx.slots.register({
    name: 'widgets.config',
    id: 'session-monitor',
    order: 0,
    inject: (): SessionSettingsInjected => ({ t }),
  }, SessionSettings))
}

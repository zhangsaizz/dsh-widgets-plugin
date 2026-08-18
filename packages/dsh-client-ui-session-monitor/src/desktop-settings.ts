/**
 * Server-side session-monitor settings vocabulary: the settings namespace and
 * schema shared by the web app and the desktop widget.
 *
 * Why server-mediated: the desktop widget runs in the Tauri WebView2 webview,
 * whose storage partition (user-data folder) is separate from the browser's —
 * localStorage and BroadcastChannel do NOT cross between the two, so a shared
 * client-side blob cannot keep them consistent. The Host settings store
 * (`ctx.settings`, persisted in the harness settings document) is the single
 * source of truth: the web client half mirrors it into its localStorage
 * (`dsh.smon.settings`, which the existing widget/config panel read unchanged),
 * and the desktop widget reads/writes it directly.
 *
 * @module @dsh-plugins/client-ui-session-monitor/desktop-settings
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Server-side mirror of the client `MonitorSettings` shape (see
 *  `src/client/settings.ts`); every field the web config panel edits. */
export interface MonitorSettingsWire {
  /** Show a toast when a session finishes a round. */
  readonly notify: boolean
  /** How a toast goes away: 'auto' after a few seconds, or only on 确认/知道了. */
  readonly notifyMode: 'auto' | 'confirm'
  /** Seconds before an auto-mode toast dismisses itself. */
  readonly autoDismissSec: number
  /** Play a short chime when a toast appears. */
  readonly sound: boolean
  /** Also send a browser/system notification on round completion (needs permission). */
  readonly browserNotify: boolean
  /** List only running sessions in the dashboard. */
  readonly runningOnly: boolean
  /** Keep only sessions active within this many minutes (0 = keep all). */
  readonly timeWindowMin: number
  /** Mark sessions that finished a round with a "本轮完成" badge until visited. */
  readonly showDone: boolean
  /** Also notify when the current session finishes its round. */
  readonly notifyCurrent: boolean
  /** Show (and notify about) subagent sessions in the dashboard. */
  readonly showSubagents: boolean
  /** Desktop inbox: mark a notification read automatically after 处理 jumps to it. */
  readonly ackOnJump: boolean
  /** Desktop inbox: auto-ack everything when the widget starts (default off —
   *  opening the widget should surface what still needs attention). */
  readonly autoAckOnOpen: boolean
}

/** Settings namespace owning the shared session-monitor options. */
export const MONITOR_SETTINGS_NS = settingsNamespace('session-monitor')

/** Schema for the shared settings section. Defaults mirror the client
 *  `DEFAULT_SETTINGS` so an absent section resolves identically on both sides. */
export const MonitorSettingsSchema: z<MonitorSettingsWire> = z.object({
  notify: z.boolean().default(true),
  notifyMode: z.union(['auto', 'confirm']).default('auto'),
  autoDismissSec: z.number().default(8),
  sound: z.boolean().default(false),
  browserNotify: z.boolean().default(false),
  runningOnly: z.boolean().default(false),
  timeWindowMin: z.number().default(60),
  showDone: z.boolean().default(true),
  notifyCurrent: z.boolean().default(false),
  showSubagents: z.boolean().default(false),
  ackOnJump: z.boolean().default(true),
  autoAckOnOpen: z.boolean().default(false),
})

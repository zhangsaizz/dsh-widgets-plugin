/**
 * Token crit meter plugin, browser half: one register() call contributes the
 * floating TokenCritWidget into the shell.overlay list. The widget reads the
 * current session's cumulative token usage from the `tokenUsage` session
 * projection through the standard `useSessions` prop — no Host RPC, no
 * polling: the runtime pushes projection frames reactively.
 *
 * @module @dsh-plugins/client-ui-token-crit/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { TokenCritWidget } from './TokenCritWidget.tsx'

/** Required services: the slot system and the timer mixin. */
export const inject = ['slots']

/**
 * Client plugin body: the floating token counter.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'token-crit',
    order: 50,
    // The card container resolves a widget's tray/card name from its overlay
    // label first; token-crit has no locale namespace, so a small thunk keeps
    // the label in sync with the page language.
    label: () => document.documentElement.lang === 'zh' ? 'Token 暴击' : 'Token crit',
  }, TokenCritWidget))
}

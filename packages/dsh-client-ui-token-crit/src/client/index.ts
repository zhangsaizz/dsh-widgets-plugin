/**
 * Token crit meter plugin, browser half: one register() call contributes the
 * floating TokenCritWidget into the shell.overlay list. The widget reads the
 * current session's cumulative token usage from the `tokenUsage` session
 * projection through the standard `useSessions` prop — no Host RPC, no
 * polling: the runtime pushes projection frames reactively.
 *
 * @module @dsh-plugins/client-ui-token-crit/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `ctx.slots` (SlotRegistry) Context merge from ui-renderer.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `widgets.card` SlotMap merge the card registration
// below type-checks against (declared by the card container).
import type {} from '@dsh-plugins/client-ui-card-container/client'
import { TokenCritWidget } from './TokenCritWidget.tsx'
import type { TokenCritInject } from './TokenCritWidget.tsx'
import { CardContainerAvailability } from './container-dock.ts'
import { TokenCritCard } from './cards.tsx'

// Type surface, mirroring the sibling widget packages (balance /
// session-monitor both re-export their inject + widget-props types).
export type { TokenCritInject, TokenCritWidgetProps } from './TokenCritWidget.tsx'

/** Required services: the slot system and the timer mixin. */
export const inject = ['slots']

/**
 * Client plugin body: the floating token counter + its compact card view.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Whether the card container can currently receive this widget: the quick-dock
  // button on the badge is only rendered while it can (the dock request is a
  // silent no-op when the container is absent or closed on the manager page).
  // One instance per apply; its ledger subscription lives in this fiber.
  const cardContainer = new CardContainerAvailability(ctx)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'token-crit',
    order: 50,
    // The card container resolves a widget's tray/card name from its overlay
    // label first; token-crit has no locale namespace, so a small thunk keeps
    // the label in sync with the page language.
    label: () => document.documentElement.lang === 'zh' ? 'Token 暴击' : 'Token crit',
    inject: (): TokenCritInject => ({ hooks: { cardContainer } }),
  }, TokenCritWidget))

  // Own compact card in the card container's grid. Registered at priority 0:
  // the container registers no built-in cards, so this is the sole card for
  // the token-crit id (unregistered widgets fall back to a placeholder).
  // `locale: 'card-container'` reuses the card container's shared stat labels.
  ctx.slots.inject('widgets.card', () => ctx.slots.register({
    name: 'widgets.card',
    id: 'token-crit',
    order: 50,
    priority: 0,
    locale: 'card-container',
  }, TokenCritCard))
}

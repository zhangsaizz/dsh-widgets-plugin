/**
 * Rainbow flow plugin, browser half: two `conversation.input.left` entries.
 *
 *  - id `rainbow-flow-toggle` (order 100) — the on/off switch with a live
 *    running dot, sitting at the left end of the composer tool row.
 *  - id `rainbow-flow-glow` (order 99) — the rainbow ring + halo carved around
 *    the composer card while the session runs, spinning at a rate driven by
 *    the live output-token speed (angular velocity eases toward the sampled
 *    target, so fast↔slow transitions glide smoothly).
 *
 * The slot is declared by ui-conversation (`InputZone` owner share: the
 * point-in-time session/input snapshots), so both entries read
 * `props.session.running` directly — no Host RPC, no polling for state.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the `conversation.input.left` SlotMap merge from
// ui-conversation (its InputZone owner contract).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RainbowFlowGlow, RainbowFlowToggle } from './RainbowFlow.tsx'

/** Required services: the slot system. */
export const inject = ['slots']

/**
 * Client plugin body: the rainbow flow + its toggle.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The toggle: left end of the composer tool row.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'rainbow-flow-toggle',
    order: 100,
  }, RainbowFlowToggle))

  // The glow: same slot, decorative absolute layer over the whole card.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'rainbow-flow-glow',
    order: 99,
  }, RainbowFlowGlow))
}

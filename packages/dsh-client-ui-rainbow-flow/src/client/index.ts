/**
 * Rainbow flow plugin, browser half: three `conversation.input` entries plus
 * a widget-manager configuration panel.
 *
 *  - id `rainbow-flow-toggle` (order 100) — the on/off switch with a live
 *    running dot, sitting at the left end of the composer tool row.
 *  - id `rainbow-flow-glow` (order 99) — the rainbow ring + halo carved around
 *    the composer card while the session runs, spinning at a rate driven by
 *    the live output-token speed (angular velocity eases toward the sampled
 *    target, so fast↔slow transitions glide smoothly).
 *  - id `rainbow-flow-send` (order 150, `conversation.input.right`) — the
 *    send/stop button beautification: an invisible probe mirrors the button's
 *    effective state onto the composer card (`data-rf-send`), and the global
 *    `SendButton.css` dresses the primary button in a rainbow conic fill with
 *    dynamic effects (breathing glow while idle with a draft; rotating
 *    rainbow + expanding pulse ring while running).
 *  - id `rainbow-flow-settings` (`widgets.config`) — the configuration panel
 *    opened from the widget manager ("Configure"), editing wisps / opacity /
 *    speed / mood in the shared settings store.
 *
 * The slot is declared by ui-conversation (`InputZone` owner share: the
 * point-in-time session/input snapshots), so all entries read
 * `props.session.running` directly — no Host RPC, no polling for state.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the `conversation.input.left`/`.right` SlotMap merge from
// ui-conversation (its InputZone owner contract).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `widgets.config` SlotMap merge declared by the widget
// manager (the config panel lives in its "Configure" dialog).
import type {} from '@dsh-plugins/client-ui-widget-manager/client'
import { RainbowFlowGlow, RainbowFlowSend, RainbowFlowToggle, mountManagerBridge } from './RainbowFlow.tsx'
import type { RainbowFlowToggleInjected } from './RainbowFlow.tsx'
import { RainbowFlowSettings } from './SettingsPanel.tsx'
import type { RainbowFlowSettingsInjected } from './SettingsPanel.tsx'
import { en, zh } from './locales.ts'
import type { RainbowFlowKey } from './locales.ts'
import './SendButton.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by this plugin. */
    'rainbow-flow': RainbowFlowKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'rainbow-flow'

/** Required services: the slot system and the locale face. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the rainbow flow + its toggle + the send/stop button
 * beautification + the configuration panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Register the `rainbow-flow` dictionary namespace (settings panel + toggle
  // copy). Disposed with this fiber.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rainbow-flow: dictionaries')

  // The widget-manager toggle bridge: apply `dsh.rnglow.manager-toggle`
  // events to the on/off store, so the manager page can enable/disable the
  // effect exactly like the toolbar dot. Disposed with this fiber.
  ctx.effect(() => mountManagerBridge(), 'rainbow-flow: manager toggle bridge')

  // The toggle: left end of the composer tool row. `conversation.input.left`
  // carries only the InputZone owner share (no locale seat), so the toggle's
  // copy is injected through the registration's inject face.
  const tToggle = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'rainbow-flow-toggle',
    order: 100,
    inject: (): RainbowFlowToggleInjected => ({ t: tToggle }),
  }, RainbowFlowToggle))

  // The glow: same slot, decorative absolute layer over the whole card.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'rainbow-flow-glow',
    order: 99,
  }, RainbowFlowGlow))

  // The send/stop button beautification: right end of the tool row, just
  // before the primary button (whose card state it mirrors).
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'rainbow-flow-send',
    order: 150,
  }, RainbowFlowSend))

  // The configuration panel (widget manager "Configure" dialog). The manager
  // declares `widgets.config`; when it is absent this registration is skipped
  // gracefully by the slot system.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('widgets.config', () => ctx.slots.register({
    name: 'widgets.config',
    id: 'rainbow-flow',
    order: 0,
    inject: (): RainbowFlowSettingsInjected => ({ t }),
  }, RainbowFlowSettings))
}

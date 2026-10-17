/**
 * Card-container availability probe for the "put into container" affordance.
 *
 * A floating widget that ships the quick-dock button talks to the card
 * container through a window CustomEvent (`dsh.card-container.dock`), which is
 * a SILENT no-op whenever the container cannot receive the widget. There are
 * two such states, and neither unloads this package:
 *
 *  - the container plugin is not installed / not mounted → no `shell.overlay`
 *    entry with its id exists at all;
 *  - the container is "closed" on the Widgets manager page → the manager keeps
 *    it mounted but registers a SHADOW entry with the same cell id at a
 *    negative priority (its shadow wins the cell, the panel is invisible).
 *
 * A button that visibly does nothing when clicked is worse than no button, so
 * every widget offering the affordance hides it while this probe says the
 * container is unavailable.
 *
 * The check reads the overlay LEDGER rather than the event channel: the
 * container is itself a `shell.overlay` entry (id `card-container`) and the
 * ledger is the single source of truth for whether its cell is won by a
 * visible entry — the same winners projection
 * (`ctx.slots.entriesOfSlot('shell.overlay')`) the container's own controller
 * uses to notice that it was disabled and release its dock shadows, so the
 * button and the container can never disagree.
 *
 * {@link CardContainerAvailability} wraps that read in a plain observable
 * snapshot source (getSnapshot + subscribe), handed to a widget through its
 * registration's inject `hooks` compartment as the `useCardContainer` selector
 * hook: the affordance then follows a live enable/disable click without a
 * reload.
 *
 * This file is copied verbatim into every widget package that offers the
 * affordance (they publish independently, so a shared fifth package is not an
 * option); only the `@module` line of the docblock may differ, and
 * `scripts/build.mjs` asserts the copies stay byte-identical from
 * {@link CARD_CONTAINER_ID} onward.
 *
 * @module @dsh-plugins/balance/client/container-dock
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

/** The container's own `shell.overlay` entry id (never dockable itself). */
export const CARD_CONTAINER_ID = 'card-container'

/**
 * Whether the card container is visible, given a key's shadowing winners.
 * @param winners - the `shell.overlay` winners projection
 *   (`ctx.slots.entriesOfSlot('shell.overlay')`), or any projection in the
 *   same shape.
 * @returns true when the container wins its cell at a non-negative priority
 *   (mounted and not shadowed, i.e. it can take a docked widget right now).
 */
export function isCardContainerIn(winners: readonly StoredEntry[]): boolean {
  const winner = winners.find((entry) => entry.options.id === CARD_CONTAINER_ID)
  return winner !== undefined && (winner.options.priority ?? 0) >= 0
}

/**
 * Read the container's live visibility straight off the overlay ledger.
 * @param ctx - client root context carrying the slot registry.
 * @returns true while the container is mounted and not disabled.
 */
export function isCardContainerAvailable(ctx: ClientContext): boolean {
  return isCardContainerIn(ctx.slots.entriesOfSlot('shell.overlay'))
}

/**
 * Reactive container availability, injected into a widget as its
 * `useCardContainer` selector hook. One instance per client plugin apply; the
 * ledger subscription is disposed with the plugin's fiber.
 */
export class CardContainerAvailability implements HostObservable<boolean> {
  private readonly listeners = new Set<() => void>()
  private readonly ctx: ClientContext
  private value: boolean

  /**
   * @param ctx - client root context carrying the slot registry.
   */
  constructor(ctx: ClientContext) {
    this.ctx = ctx
    this.value = isCardContainerAvailable(ctx)
    const stop = ctx.slots.subscribe('shell.overlay', () => { this.refresh() })
    ctx.effect(() => stop, 'container-dock: overlay ledger subscription')
  }

  /** uSES getSnapshot side (bound as the `useCardContainer` selector hook). */
  getSnapshot(): boolean {
    return this.value
  }

  /** uSES subscribe side (bound as the `useCardContainer` selector hook). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Re-read the ledger and wake subscribers only on a real change. */
  private refresh(): void {
    const next = isCardContainerAvailable(this.ctx)
    if (next === this.value) return
    this.value = next
    for (const fn of [...this.listeners]) fn()
  }
}

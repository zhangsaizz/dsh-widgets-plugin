/**
 * Client-safe type surface of the `sessionMonitorTurnEnd` session projection
 * (see ./turn-end-projection.ts for the Host-side unit).
 *
 * Kept free of host-only imports (cordis, zod, the projection registry) so the
 * browser half and the standalone desktop page can share the key and the value
 * type through the `/types` outlet of `dsh-session-projection` — the outlet
 * exists exactly so client aggregates declare-merge a key without dragging the
 * registry's host Context merges in.
 *
 * @module @dsh-plugins/client-ui-session-monitor/turn-end-types
 */

// Type-only: the merge-extensible projection table this file augments.
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** The projection's registry key (wire and fold state use the same name). */
export const TURN_END_PROJECTION_KEY = 'sessionMonitorTurnEnd'

/** One session's latest `turn/end` fact (wire value and fold state alike). */
export interface SessionMonitorTurnEnd {
  /**
   * The turn-end reason kind (`completed` / `aborted` / `blocked` / `error` /
   * `max-tokens` / `interrupted`, or a plugin-merged variant).
   */
  readonly reason: string
  /** Event wall time (Unix epoch milliseconds). */
  readonly at: number
  /** Durable count of `turn/end` events in the log, this one included. The
   *  fold covers the fork-inherited prefix too (whole-log convention), so a
   *  forked session continues its parent's numbering. */
  readonly round: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Latest `turn/end` fact for the session; null until its first turn ends. */
    sessionMonitorTurnEnd: SessionMonitorTurnEnd | null
  }
  interface SessionProjectionStateMap {
    /** Same as the wire value (the view is the identity). */
    sessionMonitorTurnEnd: SessionMonitorTurnEnd | null
  }
}

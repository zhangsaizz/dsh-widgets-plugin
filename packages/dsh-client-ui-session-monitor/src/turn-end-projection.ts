/**
 * The `sessionMonitorTurnEnd` session projection unit (Host half): one
 * session's latest `turn/end` fact — the same fact the `/status` route serves
 * today — folded from the durable log by the Harness session-projection
 * registry. The value type and key live in ./turn-end-types.ts (client-safe).
 *
 * Why a projection instead of only the hand-rolled fold in `./index.ts`: the
 * registry owns the single `session/event` subscription, the per-session
 * watermark cache, the persisted checkpoint rows (`(sessionId, key, ver, seq,
 * val)`, so a value survives a Host restart and stays readable for a session
 * nothing has attached), and the client change feed. Its `wire` view is
 * delivered to every Harness browser client through
 * `SessionSummary.projectionValues.sessionMonitorTurnEnd`, so the web half can
 * read turn-end reasons per session without polling; `/_dsh/session-monitor/
 * status` stays for the standalone desktop widget page, which is not a Harness
 * client (see ./widget-page.html), and remains the fallback for a deployment
 * that composes no `dsh-session-projection`.
 *
 * State IS the wire value (plain JSON, identity view), so a Host reader gets
 * the same object from `ctx.sessionProjections.stateOf(session, KEY)` that a
 * browser reads out of the projection values.
 *
 * Two deliberate differences from the in-memory store in `./index.ts`, both
 * consequences of folding the LOG rather than watching this process:
 *  - `round` is the durable count of `turn/end` events in the session's log,
 *    not a counter that starts at zero when the Host boots (the browser's
 *    "第 N 轮" is therefore correct across restarts). The fold starts at seq 0,
 *    so a FORKED session's count includes its inherited prefix — the same
 *    whole-log convention `sessionStats` uses. Counting only the turns since
 *    the fork would need `init`'s `inheritedEventCount` subtracted, which is a
 *    product decision, not a fold detail.
 *  - the value exists for sessions this process never watched live, as long as
 *    the unit has folded them (any event or read builds the cell by folding the
 *    whole in-memory log). A COLD session's value comes from its persisted
 *    checkpoint row instead — `dsh-session-projection-cache` flushes one on
 *    every `turn/end` — so a session whose last turn ended before this unit was
 *    registered has no usable row and reads as absent until a fuller read path
 *    refolds it.
 * Bump `stateVersion` whenever the state shape or the fold semantics change, so
 * cached rows from the older unit are discarded instead of being
 * forward-applied into garbage.
 *
 * @module @dsh-plugins/client-ui-session-monitor/turn-end-projection
 */

import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionMonitorTurnEnd } from './turn-end-types.ts'
import { TURN_END_PROJECTION_KEY } from './turn-end-types.ts'

/** Wire + state schema (the value is null before the first `turn/end`). */
export const turnEndProjectionSchema = z.object({
  reason: z.string(),
  at: z.number(),
  round: z.number().int().nonnegative(),
}).nullable()

/** Pure fold: the newest `turn/end` in the log, with its running count. Every
 *  other event returns the state reference unchanged, so the framework does no
 *  downstream work for them. `satisfies` (not an annotation) keeps the literal
 *  type — the registry's client-visible overload requires `wire` to be present,
 *  which an annotated `ProjectionDefinition` would widen back to optional. */
export const turnEndProjection = {
  key: TURN_END_PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: turnEndProjectionSchema,
  init: () => null,
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'turn/end') return state
    return {
      reason: event.data.reason.kind,
      at: event.time,
      round: (state?.round ?? 0) + 1,
    }
  },
  wire: {
    viewSchema: turnEndProjectionSchema,
    view: (state) => state,
  },
} satisfies ProjectionDefinition<typeof TURN_END_PROJECTION_KEY, SessionMonitorTurnEnd | null>

/**
 * Register the unit when the session-projection registry is composed. The
 * registration rides the calling fiber (removed on unload); a deployment
 * without the registry keeps the route-only path.
 * @param ctx - host context.
 */
export function installTurnEndProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(turnEndProjection)
  })
}

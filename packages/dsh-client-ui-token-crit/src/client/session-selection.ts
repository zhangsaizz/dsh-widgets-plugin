/**
 * The selected Session under the harness 0.1.7 Session Controller.
 *
 * `SessionListState.current` was removed in 0.1.7: view selection left the
 * controller, and the authoritative "which Session is the main view showing"
 * fact is now the `mainView` source count on the list row itself. The WORKSPACE
 * UI plugin (`@deepseek-ai/dsh-client-ui-workspace`) is the one that retains the
 * selected Session under that label (`sessions.retain(target, { source:
 * 'mainView' })`); ui-session only derives its main binding from the resulting
 * counts, and the harness's own consumers read the same fact the same way
 * (layout's DocumentTitle, the workspace browser's `mainSessionId`).
 *
 * Only one holder is assumed: with a second `mainView` retainer (a split view,
 * say) the `find()` below would pick whichever row the list happens to order
 * first — exactly like those harness consumers do.
 *
 * @module @dsh-plugins/client-ui-token-crit/client/session-selection
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the `SessionReferenceSourceMap.mainView` label merge (and the
// `useSessions` standard-prop merge) declared by ui-session, so the row's
// `retainedBy.mainView` lookup below type-checks.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** One Session identity as the list state brands it. */
export type ListedSessionId = SessionListState['ids'][number]

/**
 * Resolve the Session the main view currently shows.
 * @param state - the Session Controller list snapshot.
 * @returns the selected Session identity, or undefined while none is retained.
 */
export function currentSessionId(state: SessionListState): ListedSessionId | undefined {
  for (const row of Object.values(state.byId)) {
    if ((row.retainedBy.mainView ?? 0) > 0) return row.id
  }
  return undefined
}

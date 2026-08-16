/**
 * Browser-local object layer for the balance dashboard: one controller owns
 * the current-session/model resolution and the periodic refresh, and publishes
 * an immutable view through the inject hooks compartment. The Host answers
 * `balance/query`; this controller only decides WHEN to ask and WHERE the
 * answer lands.
 *
 * @module @dsh-plugins/balance/client/controller
 */

import type {
  IApiClient, ModelSelection, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BalanceListEntry, BalanceListResult, BalanceQueryResult } from '../types.ts'

/** The narrow generated-Remote face this controller reads. */
export interface BalanceRemote {
  query: (request: { provider: string; model?: string }) => Promise<RemoteResult<BalanceQueryResult>>
  list: () => Promise<RemoteResult<BalanceListResult>>
}

/** Lifecycle of the published view. */
export type BalancePhase = 'idle' | 'loading' | 'ready' | 'no-session'

/** Immutable view the widget renders. */
export interface BalanceViewState {
  phase: BalancePhase
  /** Current provider route, or null while no model is selected. */
  provider: string | null
  /** Current model id, or null while no model is selected. */
  model: string | null
  /** Host query result; null before the first successful settle. */
  result: BalanceQueryResult | null
  /** Every bound provider route's balance; null before the first settle or after a list failure. */
  accounts: readonly BalanceListEntry[] | null
}

/** Structural slice of ui-model-selection's `ctx.modelDirectories`, read optionally. */
interface ModelDirectoryStore {
  getSnapshot(): { current: ModelSelection | null }
  subscribe(fn: () => void): () => void
}

/** Optional reactive model-selection source (the composer /model state). */
export interface ModelDirectoriesLike {
  directoryFor(sessionId: SessionId): { store: ModelDirectoryStore }
}

const INITIAL: BalanceViewState = Object.freeze({
  phase: 'idle', provider: null, model: null, result: null, accounts: null,
})

/**
 * Per-plugin balance object layer. One instance per client plugin apply; it
 * follows the current session and its model, refreshes on the configured
 * interval, and republishes through a snapshot store bound as `useBalance`.
 */
export class BalanceController implements HostObservable<BalanceViewState> {
  private readonly store: SnapshotStore<BalanceViewState>
  private readonly unsubSessions: () => void
  private readonly refreshIntervalMs: number
  private unsubModel: (() => void) | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private generation = 0
  private disposed = false
  /** Last session id the model subscription is bound to (avoid needless rebinds). */
  private lastSessionId: SessionId | undefined
  /** Whether the initial bind/reconcile already ran (the guard below must not
   *  skip the constructor's first call, where both ids are `undefined`). */
  private sessionBound = false

  /**
   * @param remote - the generated balance Remote namespace.
   * @param sessions - client sessions service (current-selection feed).
   * @param models - the wire `sessions.models` read for authoritative selection.
   * @param modelDirectories - optional reactive selection source for prompt model switches.
   * @param refreshIntervalMs - periodic refresh interval (clamped to ≥ 1s).
   */
  constructor(
    private readonly remote: BalanceRemote,
    private readonly sessions: ISessions,
    private readonly models: Pick<IApiClient['sessions'], 'models'>,
    private readonly modelDirectories: ModelDirectoriesLike | undefined,
    refreshIntervalMs: number,
  ) {
    // Guard against a non-positive interval: setInterval would spin at
    // millisecond frequency. The production caller passes a fixed 30s constant.
    this.refreshIntervalMs = Math.max(1000, Math.floor(refreshIntervalMs))
    this.store = createSnapshotStore<BalanceViewState>(INITIAL)
    this.unsubSessions = this.sessions.list.subscribe(() => { this.onSessionChange() })
    this.onSessionChange()
    this.timer = setInterval(() => { void this.refresh() }, this.refreshIntervalMs)
  }

  /** Return the cached immutable view. */
  getSnapshot = (): BalanceViewState => this.store.getSnapshot()

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

  /** Re-read the current session + model and republish (also the manual refresh action). */
  refresh = (): Promise<void> => this.reconcile()

  /** Drop subscriptions and the timer when the owning fiber unloads. */
  dispose(): void {
    this.disposed = true
    this.unsubSessions()
    this.unsubModel?.()
    if (this.timer !== undefined) clearInterval(this.timer)
  }

  /** Follow the current-selection feed and (re)bind the reactive model source. */
  private onSessionChange(): void {
    const current = this.sessions.list.getSnapshot().current
    // The subscription fires on ANY list mutation; rebinding the model store
    // and re-reconciling only matters when the CURRENT session actually moved
    // — but never skip the constructor's first call (initial 'no session' must
    // still publish the no-session view).
    if (this.sessionBound && current === this.lastSessionId) return
    this.sessionBound = true
    this.lastSessionId = current
    this.unsubModel?.()
    this.unsubModel = undefined
    if (current !== undefined && this.modelDirectories !== undefined) {
      try {
        const directory = this.modelDirectories.directoryFor(current)
        this.unsubModel = directory.store.subscribe(() => { void this.reconcile() })
      } catch (_scopeNotReady) {
        // The session scope is not minted yet; the poll timer still covers it.
      }
    }
    void this.reconcile()
  }

  /** Resolve the authoritative selection, then query and publish the answer. */
  private async reconcile(): Promise<void> {
    const generation = ++this.generation
    const sessionId = this.sessions.list.getSnapshot().current
    if (sessionId === undefined) {
      this.publish({ phase: 'no-session', provider: null, model: null, result: null, accounts: null })
      return
    }
    let selected: ModelSelection | undefined
    try {
      selected = await this.resolveSelection(sessionId)
    } catch {
      // The wire call itself failed — publish an explicit error state instead
      // of leaving the view stuck (and an unhandled rejection behind).
      if (this.disposed || generation !== this.generation) return
      const previous = this.store.getSnapshot()
      this.publish({
        phase: 'ready',
        provider: previous.provider,
        model: previous.model,
        result: this.failure(previous.provider ?? '', null),
        accounts: previous.accounts,
      })
      return
    }
    if (this.disposed || generation !== this.generation) return
    const provider = selected?.provider ?? null
    const model = selected?.model ?? null
    const previous = this.store.getSnapshot()
    // No model selected for the session: there is nothing to query. Publish
    // ready (not loading) so the widget stays on its "no model" state, and
    // skip the pointless empty-route query that used to fire every interval.
    if (provider === null) {
      this.publish({ phase: 'ready', provider: null, model: null, result: null, accounts: previous.accounts })
      return
    }
    this.publish({ phase: 'loading', provider, model, result: previous.result, accounts: previous.accounts })

    // Fire both reads together; the current-account view must not wait on the
    // all-accounts listing (which serially interrogates every configured vendor
    // and can take many seconds), so the listing lands asynchronously after.
    // Guard against a stale browser bundle that predates the `list` method:
    // calling an absent method synchronously would abort the reconcile and
    // strand the view on loading.
    const carriedPromise = typeof this.remote.query === 'function'
      ? this.remote.query({ provider, ...(model === null ? {} : { model }) }).catch(() => null)
      : Promise.resolve(null)
    const listedPromise = typeof this.remote.list === 'function'
      ? this.remote.list().catch(() => null)
      : Promise.resolve(null)

    const carried = await carriedPromise
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- re-entrant reconcile/dispose can run during the await.
    if (this.disposed || generation !== this.generation) return
    const result = carried !== null && carried.ok ? carried.value : this.failure(provider, carried)
    this.publish({
      phase: 'ready', provider, model,
      accounts: this.store.getSnapshot().accounts,
      result,
    })

    const listed = await listedPromise
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- re-entrant reconcile/dispose can run during the await.
    if (this.disposed || generation !== this.generation) return
    this.publish({
      phase: 'ready',
      provider,
      model,
      // A failed listing renders as "no accounts" rather than stuck loading.
      accounts: listed !== null && listed.ok ? listed.value.accounts : [],
      result: this.store.getSnapshot().result,
    })
  }

  /** Build a query-failure result for a null carrier or an ok:false reply. */
  private failure(provider: string, carried: { ok: false; error: { code: string; message: string } } | null): BalanceQueryResult {
    return {
      provider,
      bound: false,
      account: {
        vendor: '', displayName: '', label: '', currency: '', total: 0,
        trend: 'unknown', delta: 0, updatedAt: Date.now(),
        status: 'error',
        errorCode: carried === null ? 'transport' : carried.error.code,
        errorMessage: carried === null ? 'balance query failed' : carried.error.message,
      },
    }
  }

  /** Read the current selection from the wire, tolerating a missing model. */
  private async resolveSelection(sessionId: SessionId): Promise<ModelSelection | undefined> {
    // Same stale-bundle guard as the remote reads: an absent method would
    // throw synchronously and abort the reconcile.
    if (typeof this.models?.models !== 'function') return undefined
    const { result } = await this.models.models({ sessionId })
    return result.ok ? result.value.current : undefined
  }

  /** Replace the view and drop stale work when the fiber unloads. */
  private publish(view: BalanceViewState): void {
    this.store.set(Object.freeze(view))
  }
}

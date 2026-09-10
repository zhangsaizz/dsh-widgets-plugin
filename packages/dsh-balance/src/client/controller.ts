/**
 * Browser-local object layer for the balance dashboard: one controller owns
 * the current-session/model resolution and the periodic refresh, and publishes
 * an immutable view through the inject hooks compartment. The Host answers
 * `balance/query`; this controller only decides WHEN to ask and WHERE the
 * answer lands.
 *
 * @module @dsh-plugins/balance/client/controller
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
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

/**
 * Late-bound lookup for that source. The owning plugin
 * (`@deepseek-ai/dsh-client-ui-model-selection`) is not a declared dependency, so
 * the service may be absent when this plugin applies and may appear later; every
 * read goes through this lookup instead of a value captured at apply time.
 */
export type ModelDirectoriesProvider = () => ModelDirectoriesLike | undefined

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
  /** Session whose directory the model subscription is bound to. */
  private boundModelSessionId: SessionId | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private generation = 0
  private disposed = false
  /** Current session id last seen by `onSessionChange` (skips list mutations
   *  that did not move the selection). */
  private lastSessionId: SessionId | undefined
  /** Whether the initial bind/reconcile already ran (the guard below must not
   *  skip the constructor's first call, where both ids are `undefined`). */
  private sessionBound = false

  /**
   * @param remote - the generated balance Remote namespace.
   * @param sessions - client sessions service (current-selection feed).
   * @param modelDirectories - late-bound lookup for the optional model-selection
   *   service (authoritative current model for a session; absent when
   *   ui-model-selection is not mounted, and re-read on every use).
   * @param refreshIntervalMs - periodic refresh interval (clamped to ≥ 1s).
   */
  constructor(
    private readonly remote: BalanceRemote,
    private readonly sessions: ISessions,
    private readonly modelDirectories: ModelDirectoriesProvider,
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
    this.unbindModelSource()
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
    this.bindModelSource(current)
    void this.reconcile()
  }

  /**
   * Subscribe to the current session's model directory when the optional
   * model-selection service is present. Called on every session change and on
   * every reconcile, so a service that was absent at apply time — or a session
   * scope minted later — still becomes the reactive source for `/model`
   * switches instead of leaving the dashboard on a stale model until reload.
   * @param sessionId - the session whose directory to follow, if any.
   */
  private bindModelSource(sessionId: SessionId | undefined): void {
    // A reconcile can still be in flight (or a refresh() clicked) when the fiber
    // unloads; re-subscribing then would outlive disposal.
    if (this.disposed) return
    if (sessionId === undefined) {
      this.unbindModelSource()
      return
    }
    if (this.unsubModel !== undefined && this.boundModelSessionId === sessionId) return
    this.unbindModelSource()
    const directories = this.modelDirectories()
    if (directories === undefined) return
    try {
      this.unsubModel = directories.directoryFor(sessionId).store.subscribe(() => { void this.reconcile() })
      this.boundModelSessionId = sessionId
    } catch (_scopeNotReady) {
      // The session scope is not minted yet; the poll timer re-attempts this.
    }
  }

  /** Withdraw the model subscription, if any. */
  private unbindModelSource(): void {
    this.unsubModel?.()
    this.unsubModel = undefined
    this.boundModelSessionId = undefined
  }

  /** Resolve the authoritative selection, then query and publish the answer. */
  private async reconcile(): Promise<void> {
    const generation = ++this.generation
    const sessionId = this.sessions.list.getSnapshot().current
    if (sessionId === undefined) {
      this.publish({ phase: 'no-session', provider: null, model: null, result: null, accounts: null })
      return
    }
    // Re-attempt the model subscription here as well: the service may have been
    // absent when the session was bound (see bindModelSource).
    this.bindModelSource(sessionId)
    let selected: ModelSelection | undefined
    try {
      selected = this.resolveSelection(sessionId)
    } catch {
      // Selection resolution failed — publish an explicit error state instead
      // of leaving the view stuck on its previous phase.
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

  /** Read the session's effective selection from the shared model directory. */
  private resolveSelection(sessionId: SessionId): ModelSelection | undefined {
    const directories = this.modelDirectories()
    // The directory service is optional (ui-model-selection may be absent); its
    // absence means "no model known yet", not a failed read.
    if (directories === undefined) return undefined
    let directory: ReturnType<ModelDirectoriesLike['directoryFor']>
    try {
      directory = directories.directoryFor(sessionId)
    } catch (_scopeNotReady) {
      // The session scope is not minted yet; the poll timer retries, so this
      // round reports "no selection" rather than a query failure.
      return undefined
    }
    // Past the scope check a throw is a genuine failure: it propagates so the
    // caller publishes the explicit error state instead of a silent "no model".
    return directory.store.getSnapshot().current ?? undefined
  }

  /** Replace the view and drop stale work when the fiber unloads. */
  private publish(view: BalanceViewState): void {
    this.store.set(Object.freeze(view))
  }
}

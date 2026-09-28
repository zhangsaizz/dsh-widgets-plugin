/**
 * Client bridge to the harness 0.1.7 background-job rosters (`ctx.jobs`).
 *
 * 0.1.5 carried a global, always-current per-session job mirror on the Session
 * Controller (`SessionListState.jobsBySession`). 0.1.7 replaced it with the job
 * controller's reference-counted streams: `ctx.jobs.state` is a bare observable
 * holding only the rosters some watcher asked for, and `ctx.jobs.watchRows(id)`
 * starts (and releases) one `job.list` stream per watched Session.
 *
 * This module is the one place that adapts the plugin's two card surfaces to
 * that shape. `apply` installs the bridge once with the live `ctx.jobs`
 * handles; `useWatchedJobRows` subscribes to the rosters and keeps a watch on
 * exactly the Sessions the caller currently lists, releasing a watch as soon as
 * its Session leaves the list or the component unmounts. Both halves of the
 * widget (the floating panel and the compact card) share the same bridge and so
 * can never disagree about a session's job count.
 *
 * The roster row shape is declared structurally on purpose: the authoritative
 * type lives in `@deepseek-ai/dsh-jobs/view`, which is intentionally outside
 * this package's typecheck graph — the same loose-shape convention the widget
 * uses for the `goal` projection.
 *
 * @module @dsh-plugins/client-ui-session-monitor/client/jobs-bridge
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

/** Structural view of one background-job roster row. */
export interface JobRowLoose {
  readonly id?: string
  /** Human-facing job label, mirrored into the "running job" progress copy. */
  readonly label?: string
  /** Registry status: `running` / `stopping` are the still-executing states. */
  readonly status?: string
}

/** Immutable roster snapshot: Session id → its visible jobs (absent = none). */
export interface JobsSnapshotLoose {
  readonly rows: Readonly<Record<string, readonly JobRowLoose[]>>
}

/** Bare observable source for the roster snapshot (`ctx.jobs.state`). */
export interface JobsSourceLoose {
  getSnapshot(): JobsSnapshotLoose
  subscribe(listener: () => void): () => void
}

/** Start watching one Session's roster; returns its reference release. */
export type WatchJobRows = (sessionId: string) => () => void

/** Stable empty snapshot, so an uninstalled bridge never re-renders. */
const EMPTY: JobsSnapshotLoose = Object.freeze({ rows: Object.freeze({}) })

let source: JobsSourceLoose | undefined
let watchRows: WatchJobRows | undefined
/** Release of the one subscription this bridge holds on {@link source}. */
let releaseSource: (() => void) | undefined
/** React's subscription callbacks; the bridge fans the source out to them. */
const listeners = new Set<() => void>()

function notify(): void {
  // Contained per listener, like the store's own `notifySubscribers`: one
  // throwing subscriber must not starve the rest of the fan-out.
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A subscriber's failure is its own; the remaining ones still run.
    }
  }
}

/**
 * Install the live job-controller handles. Called from the plugin `apply` once
 * `ctx.jobs` is available (see ./index.ts) and again if the plugin is
 * re-applied, so this replaces the handles rather than assuming a single call.
 *
 * The bridge owns ONE subscription on the current source and fans it out to
 * React, instead of handing each hook the source's `subscribe` directly: the
 * hook's subscription is created at mount and would otherwise stay bound to
 * whatever source existed then, leaving the rosters frozen when the service
 * arrives later or is replaced.
 * @param next - the `ctx.jobs.state` observable.
 * @param watch - the `ctx.jobs.watchRows` reference-counted watcher.
 */
export function installJobsBridge(next: JobsSourceLoose, watch: WatchJobRows): void {
  releaseSource?.()
  source = next
  watchRows = watch
  releaseSource = next.subscribe(notify)
  // Announce the replacement so an already-mounted hook re-reads the snapshot.
  notify()
}

/**
 * Drop the bridge (plugin unload): release the source subscription and forget
 * the handles, so an unloaded plugin stops pinning the disposed job model. The
 * hooks' own watches are released by their unmount effects; this only retires
 * the module-level state.
 */
export function uninstallJobsBridge(): void {
  releaseSource?.()
  releaseSource = undefined
  source = undefined
  watchRows = undefined
  notify()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

function getSnapshot(): JobsSnapshotLoose {
  return source?.getSnapshot() ?? EMPTY
}

function getServerSnapshot(): JobsSnapshotLoose {
  return EMPTY
}

/**
 * The Sessions worth watching for job rosters.
 *
 * 0.1.7 serves rosters per Session (`ctx.jobs.watchRows(id)`), so watching every
 * listed Session would hold one `job.list` stream open per Session for the whole
 * page life — the 0.1.5 global mirror had no such cost. Watch instead:
 *  - every RUNNING Session (a Session can only gain jobs while it runs);
 *  - every Session whose roster already holds a still-executing job, so a
 *    background job that outlives its turn keeps its badge;
 *  - the Session the main view shows, when the caller names one.
 * An idle Session that never reported a job is not watched: it cannot have one,
 * and its badge would be empty anyway.
 * @param ids - every listed Session id, in list order.
 * @param isRunning - running predicate for one Session.
 * @param rows - the rosters observed so far.
 * @param currentId - the Session the main view shows, if the caller tracks one.
 * @returns the ids to keep watched.
 */
export function jobWatchTargets(
  ids: readonly string[],
  isRunning: (id: string) => boolean,
  rows: Readonly<Record<string, readonly JobRowLoose[]>>,
  currentId: string | undefined,
): string[] {
  const targets: string[] = []
  for (const id of ids) {
    const live = (rows[id] ?? []).some((job) => job.status === 'running' || job.status === 'stopping')
    if (live || isRunning(id) || id === currentId) targets.push(id)
  }
  return targets
}

/**
 * The live job rosters, watching the Sessions a selector names.
 *
 * A Session entering the selected set starts one shared watch; leaving it (or
 * unmounting) releases that watch, so the widget never leaks a stream for a
 * Session it stopped caring about.
 * @param select - Sessions to watch, derived from the CURRENT rosters (the hook
 *   hands them back so the policy can keep a Session whose roster is already
 *   populated even after it stops running — see {@link jobWatchTargets}).
 * @returns the roster rows by Session id.
 */
export function useWatchedJobRows(
  select: (rows: Readonly<Record<string, readonly JobRowLoose[]>>) => readonly string[],
): Readonly<Record<string, readonly JobRowLoose[]>> {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const held = useRef(new Map<string, () => void>())
  /** The source every release in {@link held} was minted against. */
  const heldFor = useRef<JobsSourceLoose | undefined>(undefined)
  const ids = select(snapshot.rows)
  // The selector returns a fresh array every render; a joined key keeps the
  // effect below stable across renders while still reacting to real changes.
  const watchKey = ids.join('\u0000')

  useEffect(() => {
    const watch = watchRows
    const active = held.current
    if (watch === undefined) return
    // A REPLACED bridge invalidates every held watch: each release belongs to
    // the previous service (which drops its rosters as it goes away), so keep
    // them and the rosters stay frozen empty for the rest of the session.
    // Keying on the session id alone cannot see the swap — the wanted set is
    // unchanged, so the reconcile below would be a no-op.
    if (heldFor.current !== source) {
      for (const stop of active.values()) stop()
      active.clear()
      heldFor.current = source
    }
    const wanted = new Set(ids)
    for (const [id, stop] of active) {
      if (wanted.has(id)) continue
      active.delete(id)
      stop()
    }
    for (const id of wanted) {
      if (active.has(id)) continue
      try {
        active.set(id, watch(id))
      } catch {
        // The Session is not addressable yet (e.g. a catalog row whose Host
        // side has not settled); the next list change retries.
      }
    }
    // `snapshot` is a dependency on purpose: a bridge installed AFTER this
    // effect first ran (the job controller arriving late) changes the snapshot
    // identity, and that re-run is what starts the watches against the real
    // `watchRows`. Without it the rosters would stay empty forever, since
    // `watchKey` alone cannot express "the service just appeared". On a steady
    // bridge the loop above is a no-op over already-held ids.
  }, [snapshot, watchKey])

  useEffect(() => () => {
    for (const stop of held.current.values()) stop()
    held.current.clear()
  }, [])

  return snapshot.rows
}

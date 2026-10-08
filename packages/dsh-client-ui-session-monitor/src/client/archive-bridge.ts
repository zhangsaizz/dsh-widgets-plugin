/**
 * Client bridge to the Harness Workspace archive set (`ctx.workspaces.list`).
 *
 * Archiving is the user putting a Session away: the Host refuses to archive one
 * whose work still runs unless stopping that work was confirmed, so an archived
 * Session is inactive by definition and does not belong on a monitor whose
 * whole purpose is work in flight. Nothing in `SessionListState` marks it —
 * archive membership is registry-global state owned by the Workspace
 * Controller — so this module is the one place the two card surfaces read it
 * from, exactly like ./jobs-bridge.ts does for job rosters: `apply` installs
 * the live source once a Workspace Controller appears, both surfaces share the
 * one subscription, and an unmounted or replaced plugin leaves a frozen-empty
 * set instead of pinning a disposed model.
 *
 * The standalone desktop widget is not a Harness client, so it cannot use this
 * bridge: the Host marks its rows instead (see ../desktop-snapshot.ts).
 *
 * @module @dsh-plugins/client-ui-session-monitor/client/archive-bridge
 */

import { useSyncExternalStore } from 'react'
import type { WorkspaceSource } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Stable empty set, so an uninstalled bridge never re-renders. */
const EMPTY: ReadonlySet<string> = new Set<string>()
/** Stable empty id list for a source that carries no archive field yet. */
const NO_IDS: readonly string[] = []

let source: WorkspaceSource | undefined
/** Release of the one subscription this bridge holds on {@link source}. */
let releaseSource: (() => void) | undefined
/** Last published archive set (identity stable while its content is). */
let archived: ReadonlySet<string> = EMPTY
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

/** Publish one set, notifying readers only when the value actually changed. */
function publish(next: ReadonlySet<string>): void {
  if (next === archived) return
  archived = next
  notify()
}

/** Read the source snapshot and republish only when the archive set moved. */
function refresh(): void {
  const ids = source?.getSnapshot().archivedSessionIds
  const list = ids === undefined ? NO_IDS : ids
  if (list.length === archived.size) {
    let same = true
    for (const id of list) {
      if (!archived.has(id)) {
        same = false
        break
      }
    }
    // Equal size plus every new member already present means the sets match.
    if (same) return
  }
  publish(list.length === 0 ? EMPTY : new Set<string>(list.map(String)))
}

/**
 * Install the live Workspace Controller source. Called from the plugin `apply`
 * once `ctx.workspaces` is available (see ./index.ts) and again if the plugin is
 * re-applied, so this replaces the source rather than assuming a single call.
 * @param next - the `ctx.workspaces.list` observable.
 */
export function installArchiveBridge(next: WorkspaceSource): void {
  releaseSource?.()
  source = next
  // A replacement's archive set is unknown until its first snapshot arrives;
  // publishing empty keeps a reader from holding the previous source's ids.
  publish(EMPTY)
  releaseSource = next.subscribe(refresh)
  refresh()
}

/**
 * Drop the bridge (plugin unload): release the source subscription and forget
 * the source, so an unloaded plugin stops pinning the disposed model and every
 * reader falls back to "nothing archived".
 */
export function uninstallArchiveBridge(): void {
  releaseSource?.()
  releaseSource = undefined
  source = undefined
  publish(EMPTY)
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

function getSnapshot(): ReadonlySet<string> {
  return archived
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY
}

/**
 * The Session ids the user archived.
 *
 * An archived Session is hidden from both monitor surfaces, excluded from the
 * busy counts, and never raises a completion / waiting-for-you reminder — the
 * user explicitly put its work away. Without a Workspace Controller the set is
 * empty and the monitor behaves as before.
 * @returns the archived Session ids (stable identity between changes).
 */
export function useArchivedSessions(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

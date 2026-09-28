/**
 * The one protocol constant shared by both halves of the session monitor: the
 * optional optimistic-concurrency revision carried on the settings route.
 *
 * It lives in its own module — rather than in the host-only `./http.ts` — so the
 * BROWSER half can name it without importing the host HTTP plumbing (which
 * builds Node buffers) into the client bundle.
 *
 * Wire contract: a GET of the settings route answers with this header set to
 * the entry's current revision; a POST that sends it back asserts the section
 * has not moved since, and is refused with 409 `settings-conflict` otherwise.
 * Omitting it on a write keeps the historical last-write-wins behavior, which
 * the desktop app relies on.
 *
 * @module @dsh-plugins/client-ui-session-monitor/settings-revision
 */

/** Header carrying a settings section's revision. */
export const SETTINGS_REVISION_HEADER = 'X-DSH-Settings-Revision'

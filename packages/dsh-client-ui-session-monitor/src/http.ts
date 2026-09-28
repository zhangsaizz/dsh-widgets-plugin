/**
 * HTTP plumbing for the session-monitor host routes: CORS gating, JSON / HTML
 * responses, and the bounded JSON body reader. Extracted from the plugin entry
 * so the route layer stays thin; every helper is a pure function of its request
 * / response — no plugin state, so it is safe to unit-test in isolation.
 *
 * @module @dsh-plugins/client-ui-session-monitor/http
 */

import { SETTINGS_REVISION_HEADER } from './settings-revision.ts'

/** Cap on the JSON body the settings/jump routes accept. */
const MAX_BODY_BYTES = 64 * 1024

/** Response/request header carrying the settings section's revision. */
export { SETTINGS_REVISION_HEADER } from './settings-revision.ts'

/**
 * CORS is intentionally permissive on these routes — but only for trusted
 * consumers: the desktop shell loads the widget page same-origin, its startup
 * probe page runs on the Tauri `tauri://localhost` origin, and the web app is
 * served from wherever the user opened it. Every response is gated on the
 * request `Origin`: anything else gets a bare 403 with no CORS headers, so a
 * random website open in the user's browser can neither read the inbox
 * (session titles!) nor ack records nor overwrite settings. `allowOpaque`
 * additionally admits `Origin: null` — that is how the tauri://localhost →
 * widget page top-level NAVIGATION arrives — and is only used for the HTML
 * page; JSON data routes keep it closed so a sandboxed iframe cannot
 * exfiltrate them. The data is loopback-local monitor telemetry (session ids,
 * titles, activity times, UI preferences).
 */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // The settings routes carry an optional optimistic-concurrency revision in
  // this header; allowing it keeps the protocol usable from the cross-origin
  // desktop shell too (same-origin callers never preflight).
  'Access-Control-Allow-Headers': `Content-Type, ${SETTINGS_REVISION_HEADER}`,
  // Lets a cross-origin reader (the Tauri origin) see the revision we return.
  'Access-Control-Expose-Headers': SETTINGS_REVISION_HEADER,
}

/**
 * Read one request header (string-valued only; Node lowercases header names).
 * @param req - the incoming request.
 * @param name - header name, any case.
 * @returns the header value, or undefined when absent / repeated.
 */
export function requestHeader(req: import('node:http').IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()]
  return typeof raw === 'string' ? raw : undefined
}

/** Whether a request `Origin` may read/write these routes. The web app and the
 *  widget page are served from whatever host the user opened (127.0.0.1,
 *  localhost, or a LAN IP), so an origin is accepted when it matches this
 *  request's own `Host` header, plus any loopback hostname outright (the
 *  Tauri probe page and port-forwarded dev setups). Everything else — notably
 *  any random website open in the user's browser — is rejected. */
function originAllowed(origin: string | undefined, host: string | undefined, allowOpaque: boolean): boolean {
  if (origin === undefined) return true // same-origin / non-browser clients
  if (origin === 'null') return allowOpaque
  if (origin === 'tauri://localhost') return true
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (typeof host === 'string' && url.host === host) return true
    const hostname = url.hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/** Reject an out-of-policy request with a bare 403 (no CORS headers, so the
 *  browser cannot read the response nor pass a preflight). */
function rejectForbidden(res: import('node:http').ServerResponse): void {
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('forbidden')
}

/** Write a JSON response gated on the request origin (403 when out of policy). */
export function responseJson(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  if (!originAllowed(requestHeader(req, 'origin'), requestHeader(req, 'host'), false)) {
    rejectForbidden(res)
    return
  }
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
  res.writeHead(status)
  res.end(bytes)
}

/** Write an HTML response gated on the request origin (403 when out of policy). */
export function responseHtml(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  html: string,
): void {
  // The widget page must survive the tauri://localhost → 127.0.0.1 top-level
  // navigation, whose Origin is opaque ('null') — the page itself carries no
  // data, only the script that then fetches the gated JSON routes.
  if (!originAllowed(requestHeader(req, 'origin'), requestHeader(req, 'host'), true)) {
    rejectForbidden(res)
    return
  }
  const bytes = Buffer.from(html)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
  res.writeHead(200)
  res.end(bytes)
}

/** Read a JSON request body (bounded; malformed input resolves to null). */
export async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.length
    if (received > MAX_BODY_BYTES) return null
    chunks.push(buffer)
  }
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

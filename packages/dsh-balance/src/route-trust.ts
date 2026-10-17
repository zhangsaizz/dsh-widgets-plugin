/**
 * Authentication gate for this plugin's raw `/_dsh/*` Host routes.
 *
 * The harness fences `/api`, the app index and `/connect` with browser
 * authentication, but a plugin registers raw `webServer` routes that the fence
 * never sees. Harness 0.2.1 makes public deployments (reverse proxy, TLS,
 * `--trusted-host` / `--public-url`) first-class, so a forwarded `/_dsh/...`
 * request would otherwise hand monitor telemetry, the notification inbox or the
 * balance settings document to anyone who can reach the proxy.
 *
 * The split: a loopback authority keeps today's behaviour — that is the local
 * shell, the standalone desktop widget page (`tauri://localhost` → 127.0.0.1,
 * which has no browser session cookie) and development probes. Every other
 * request authority is handed to Connection's own trust + browser-cookie check
 * (`ctx.connection.requestRejection`), the same gate its `/api` route uses.
 * A loopback request that carries a reverse-proxy forwarding marker is NOT
 * trusted implicitly: a proxy that rewrites `Host` to the loopback authority
 * still adds `X-Forwarded-*` (or `Forwarded`), and such traffic must present
 * the browser session exactly like the proxied `/api` route. Compositions
 * without Connection (headless) keep the route ungated.
 *
 * Keep this file byte-identical in every package that publishes a raw
 * `/_dsh/*` route; `scripts/build.mjs` asserts the copies stay in sync.
 *
 * @module route-trust
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** The slice of `ctx.connection` this gate reads. */
interface ConnectionTrust {
  /** Connection's Host/Origin fence plus browser-cookie authentication. */
  requestRejection(request: { headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** Authorities that mean "same machine, no browser session": any port. */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])

/** Headers a reverse proxy adds when it forwards traffic to this listener. */
const FORWARDING_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
] as const

/** Hostname of a request `Host` header, or undefined when it is not a valid authority. */
export function requestHostname(host: string | undefined): string | undefined {
  if (host === undefined || host === '') return undefined
  try {
    // WHATWG URL normalizes `host:port`, bracketed IPv6, octal/zero-padded IPv4
    // and case. Trailing dots are stripped by hand: WHATWG keeps them, so
    // `localhost.` would otherwise miss the loopback set.
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
  } catch {
    return undefined
  }
}

/** Whether a request authority is a loopback host (any port). */
export function isLoopbackHost(host: string | undefined): boolean {
  const name = requestHostname(host)
  return name !== undefined && LOOPBACK_HOSTNAMES.has(name)
}

/** Whether the request was forwarded by a reverse proxy (loopback Host can lie). */
function hasForwardingMarker(headers: IncomingMessage['headers']): boolean {
  for (const name of FORWARDING_HEADERS) {
    const value = headers[name]
    if (value === undefined) continue
    if (Array.isArray(value) ? value.length > 0 : value.length > 0) return true
  }
  return false
}

/** Rejection status for one route request, or undefined when it may proceed. */
export function routeRejection(ctx: Context, req: IncomingMessage): 401 | 403 | undefined {
  const connection = ctx.get('connection') as ConnectionTrust | undefined
  if (connection === undefined) return undefined
  // Loopback + no proxy markers = the local shell / desktop widget page / a dev
  // probe: those cannot carry a browser session and must keep working. Proxied
  // traffic goes through the same cookie fence as the harness's `/api` routes.
  if (isLoopbackHost(req.headers.host) && !hasForwardingMarker(req.headers)) return undefined
  return connection.requestRejection({ headers: req.headers })
}

/** Reject a route request that fails the gate. Returns true when the response is owned. */
export function rejectRouteRequest(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = routeRejection(ctx, req)
  if (rejection === undefined) return false
  res.writeHead(rejection, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

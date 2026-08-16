/**
 * Optional Web-profile Settings route for the balance bindings. Same-origin
 * GET returns a redacted snapshot (inline credential values never reach the
 * browser); POST persists the bindings through the settings seam directly,
 * bypassing the host-apiproxy configuration allowlist.
 * @module @dsh-plugins/balance/web
 */

import { BALANCE_SETTINGS_NS } from './settings.ts'

/** Exact route used by the browser Balance providers page. */
export const SETTINGS_ROUTE = '/_dsh/balance/settings'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function responseJson(res, status, body) {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(status)
  res.end(bytes)
}

function requestError(res, status, code, message) {
  responseJson(res, status, { ok: false, error: { code, message } })
}

async function readJson(req, maxBytes = 64 * 1024) {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new TypeError('Content-Type must be application/json')
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw new RangeError(`request body exceeds ${maxBytes} bytes`)
    chunks.push(part)
  }
  if (chunks.length === 0) throw new TypeError('request body is empty')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function parseRequest(value) {
  if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('request action is required')
  if (value.action === 'save') {
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) {
      throw new TypeError('save.expectedRevision must be a non-negative integer')
    }
    if (!isRecord(value.value)) throw new TypeError('save.value must be an object')
    const bindings = Array.isArray(value.value.bindings) ? value.value.bindings : []
    return { action: 'save', expectedRevision: value.expectedRevision, bindings }
  }
  throw new TypeError(`unsupported action: ${value.action}`)
}

/** Strip inline credential values before they cross the wire. */
function redactBinding(binding) {
  if (!isRecord(binding)) return binding
  const { credential, ...rest } = binding
  return { ...rest, ...(typeof credential === 'string' && credential.length > 0 ? { credentialConfigured: true } : {}) }
}

function publicMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Same-origin Settings handler for the balance bindings document. */
export class BalanceWebBackend {
  constructor(ctx) {
    this.ctx = ctx
  }

  settingsSeam() {
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw new Error('balance settings seam is not mounted')
    return settings
  }

  descriptor() {
    const descriptor = this.settingsSeam().describe().find((row) => row.ns === BALANCE_SETTINGS_NS)
    if (descriptor === undefined) throw new Error('balance Settings namespace is not registered')
    return descriptor
  }

  async snapshot() {
    const descriptor = this.descriptor()
    const raw = descriptor.value
    const bindings = isRecord(raw) && Array.isArray(raw.bindings) ? raw.bindings : []
    return {
      schemaVersion: 1,
      writable: this.settingsSeam().writable,
      settings: {
        bindings: bindings.map(redactBinding),
        revision: descriptor.revision,
        applies: 'live',
      },
    }
  }

  async save(request) {
    const settings = this.settingsSeam()
    if (!settings.writable) throw new Error('settings provider is read-only')
    const previous = this.descriptor().value
    const oldBindings = isRecord(previous) && Array.isArray(previous.bindings) ? previous.bindings : []
    const oldByProvider = new Map(oldBindings.filter(isRecord).map((binding) => [binding.provider, binding]))
    // An inline credential left blank on save means "keep the stored one".
    const merged = request.bindings.filter(isRecord).map((binding) => {
      const previousBinding = oldByProvider.get(binding.provider)
      if ((binding.credential === undefined || binding.credential === '')
        && previousBinding !== undefined
        && typeof previousBinding.credential === 'string'
        && previousBinding.credential.length > 0) {
        return { ...binding, credential: previousBinding.credential }
      }
      return binding
    })
    await settings.replace(BALANCE_SETTINGS_NS, { bindings: merged }, request.expectedRevision)
    return this.snapshot()
  }

  async handle(req, res) {
    if (req.method === 'GET') {
      try {
        responseJson(res, 200, { ok: true, value: await this.snapshot() })
      } catch (error) {
        this.ctx.logger.warn('balance Settings snapshot failed: %s', publicMessage(error))
        requestError(res, 503, 'settings-unavailable', 'Balance Settings are unavailable')
      }
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      requestError(res, 405, 'method-not-allowed', 'Use GET or POST')
      return
    }
    let parsed
    try {
      parsed = parseRequest(await readJson(req))
    } catch (error) {
      requestError(res, error instanceof RangeError ? 413 : 400, 'invalid-request', publicMessage(error))
      return
    }
    try {
      responseJson(res, 200, { ok: true, value: await this.save(parsed) })
    } catch (error) {
      this.ctx.logger.warn('balance Settings save failed: %s', publicMessage(error))
      requestError(res, 400, 'settings-rejected', publicMessage(error))
    }
  }
}

/** Attach the optional Web Settings route whenever a webServer service is present. */
export function installBalanceWeb(ctx, backend) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: SETTINGS_ROUTE,
        handler: (req, res) => backend.handle(req, res),
      })
      return () => dispose()
    }, 'balance: settings web route')
  })
}

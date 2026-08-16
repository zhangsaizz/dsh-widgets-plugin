/**
 * Optional Web-profile Settings route for the balance bindings. Same-origin
 * GET returns a redacted snapshot (inline credential values never reach the
 * browser); POST persists the bindings through the settings seam directly,
 * bypassing the host-apiproxy configuration allowlist.
 * @module @dsh-plugins/balance/web
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `webServer` service merge onto Context (dsh-host-webserver).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { BALANCE_SETTINGS_NS } from './settings.ts'

/** Exact route used by the browser Balance providers page. */
export const SETTINGS_ROUTE = '/_dsh/balance/settings'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function responseJson(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(status)
  res.end(bytes)
}

function requestError(res: ServerResponse, status: number, code: string, message: string): void {
  responseJson(res, status, { ok: false, error: { code, message } })
}

async function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new TypeError('Content-Type must be application/json')
  const chunks: Buffer[] = []
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

/** The one supported POST action, validated by {@link parseRequest}. */
interface SaveRequest {
  action: 'save'
  expectedRevision: number
  bindings: unknown[]
}

function parseRequest(value: unknown): SaveRequest {
  if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('request action is required')
  if (value.action === 'save') {
    if (!Number.isSafeInteger(value.expectedRevision as number) || (value.expectedRevision as number) < 0) {
      throw new TypeError('save.expectedRevision must be a non-negative integer')
    }
    if (!isRecord(value.value)) throw new TypeError('save.value must be an object')
    const bindings = Array.isArray(value.value.bindings) ? value.value.bindings : []
    return { action: 'save', expectedRevision: value.expectedRevision as number, bindings }
  }
  throw new TypeError(`unsupported action: ${value.action}`)
}

/** Strip inline credential values before they cross the wire. */
function redactBinding(binding: unknown): Record<string, unknown> {
  if (!isRecord(binding)) return binding as Record<string, unknown>
  const { credential, ...rest } = binding
  return { ...rest, ...(typeof credential === 'string' && credential.length > 0 ? { credentialConfigured: true } : {}) }
}

function publicMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Same-origin Settings handler for the balance bindings document. */
export class BalanceWebBackend {
  // The settings seam and llm service are injected services reached through
  // the cordis context; typed loosely here (legacy file) — the request/response
  // surface above carries the strict types.
  private readonly ctx: any

  constructor(ctx: any) {
    this.ctx = ctx
  }

  settingsSeam(): any {
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw new Error('balance settings seam is not mounted')
    return settings
  }

  descriptor(): any {
    const descriptor = this.settingsSeam().describe().find((row: { ns: string }) => row.ns === BALANCE_SETTINGS_NS)
    if (descriptor === undefined) throw new Error('balance Settings namespace is not registered')
    return descriptor
  }

  /**
   * The providers that appear in the host's model catalog (the same "model
   * list" the settings models view renders): every registered provider that
   * exposes at least one model, replicating the harness's buildModelCatalog
   * semantics — providers that fail to enumerate or advertise nothing are NOT
   * part of the model list and are not offered here either. The panel's free
   * input still accepts any other route.
   */
  async configuredProviders(): Promise<Array<{ provider: string; displayName?: string }>> {
    const llm = this.ctx.get('llm')
    if (llm === undefined || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return []
    const settled = await Promise.all(llm.listProviders().map(async (provider: unknown) => {
      if (!isRecord(provider) || typeof provider.id !== 'string' || provider.id.length === 0) return null
      try {
        const models = await llm.listModels(provider.id)
        if (!Array.isArray(models) || models.length === 0) return null
        return {
          provider: provider.id,
          ...(typeof provider.name === 'string' && provider.name.length > 0 ? { displayName: provider.name } : {}),
        }
      } catch {
        return null
      }
    }))
    return settled.filter((entry: unknown): entry is { provider: string; displayName?: string } => entry !== null)
  }

  async snapshot(): Promise<unknown> {
    const descriptor = this.descriptor()
    const raw = descriptor.value
    const bindings = isRecord(raw) && Array.isArray(raw.bindings) ? raw.bindings : []
    return {
      schemaVersion: 1,
      writable: this.settingsSeam().writable,
      providers: await this.configuredProviders(),
      settings: {
        bindings: bindings.map(redactBinding),
        revision: descriptor.revision,
        applies: 'live',
      },
    }
  }

  async save(request: SaveRequest): Promise<unknown> {
    const settings = this.settingsSeam()
    if (!settings.writable) throw new Error('settings provider is read-only')
    const previous = this.descriptor().value
    const oldBindings = isRecord(previous) && Array.isArray(previous.bindings) ? previous.bindings : []
    const oldByProvider = new Map<string, Record<string, unknown>>()
    for (const binding of oldBindings) {
      if (isRecord(binding) && typeof binding.provider === 'string') oldByProvider.set(binding.provider, binding)
    }
    // An inline credential left blank on save means "keep the stored one";
    // `credentialClear: true` is the explicit "remove the stored one" (the
    // panel uses it when the user switches a key-bearing binding to env-var
    // reference, or clicks "clear stored key").
    const merged = request.bindings.filter(isRecord).map((binding) => {
      const previousBinding = oldByProvider.get(binding.provider as string)
      if (binding.credentialClear === true) {
        const { credentialClear: _flag, credential: _cred, ...rest } = binding
        return rest
      }
      const { credentialClear: _flag, ...rest } = binding
      if ((binding.credential === undefined || binding.credential === '')
        && previousBinding !== undefined
        && typeof previousBinding.credential === 'string'
        && previousBinding.credential.length > 0) {
        return { ...rest, credential: previousBinding.credential }
      }
      return rest
    })
    await settings.replace(BALANCE_SETTINGS_NS, { bindings: merged }, request.expectedRevision)
    return this.snapshot()
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    let parsed: SaveRequest
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
export function installBalanceWeb(ctx: Context, backend: BalanceWebBackend): void {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: SETTINGS_ROUTE,
        handler: (req, res) => { void backend.handle(req, res) },
      })
      return () => dispose()
    }, 'balance: settings web route')
  })
}

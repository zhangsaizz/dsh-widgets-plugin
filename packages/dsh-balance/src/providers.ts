/**
 * Concrete balance providers for the mainstream vendors that expose a public
 * balance/credit endpoint through their API key, plus explicit "unsupported"
 * bindings for the major vendors that do not (OpenAI, Anthropic, Google, xAI,
 * Mistral), so the dashboard can show a clear state instead of "unbound".
 *
 * Each provider subclasses {@link BalanceProvider}: it declares the LLM
 * provider routes it serves, the credential reference, and one HTTP call whose
 * response it normalizes into {@link BalanceAccountData}. The credential value
 * never enters an error message or log.
 *
 * @module @dsh-plugins/balance
 */

import { BalanceProvider } from './provider.ts'
import type { BalanceAccountData, BalanceProviderInfo } from './provider.ts'

/** Fetch one JSON document with a Bearer key, translating transport failure to a bounded message. */
async function getJson(url: string, credential: string, signal: AbortSignal | undefined): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${credential}` },
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    if (signal?.aborted) throw new Error('request aborted')
    throw error
  }
  if (!res.ok) throw new Error(`balance vendor returned HTTP ${String(res.status)}`)
  return await res.json()
}

/** Coerce a vendor amount (string or number) into a finite number. */
function amount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new Error(`vendor returned a non-finite amount: ${String(value)}`)
  return n
}

/** Read the first balance entry of a DeepSeek-style `balance_infos` list. */
function firstBalanceInfo(json: unknown): Record<string, unknown> {
  if (typeof json !== 'object' || json === null) throw new Error('vendor returned a non-object payload')
  const infos = (json as Record<string, unknown>)['balance_infos']
  if (!Array.isArray(infos) || infos.length === 0) throw new Error('vendor returned no balance_infos')
  const first: unknown = infos[0]
  if (typeof first !== 'object' || first === null) throw new Error('vendor returned a malformed balance_infos entry')
  return first as Record<string, unknown>
}

/**
 * Base for a provider whose endpoint is a fixed path under a fixed base URL.
 * Subclasses only declare facts and normalize the parsed JSON.
 */
abstract class HttpBalanceProvider extends BalanceProvider {
  abstract override readonly info: BalanceProviderInfo

  /** Absolute base URL of the vendor API. */
  protected abstract readonly baseURL: string

  /** Path appended to {@link baseURL}. */
  protected abstract readonly path: string

  /** Normalize the parsed JSON body into detached account data. */
  protected abstract normalize(json: unknown): BalanceAccountData

  override async query(credential: string, signal?: AbortSignal): Promise<BalanceAccountData> {
    const json = await getJson(`${this.baseURL}${this.path}`, credential, signal)
    return this.normalize(json)
  }
}

/** DeepSeek: `GET /user/balance` (amounts may be strings). */
export class DeepSeekBalanceProvider extends HttpBalanceProvider {
  override readonly info: BalanceProviderInfo
  protected override readonly baseURL: string
  protected override readonly path = '/user/balance'

  /**
   * @param options - overrides for the default route binding, credential reference, and endpoint.
   */
  constructor(options: { providers?: readonly string[]; credentialRef?: string; credential?: string; baseURL?: string } = {}) {
    super()
    this.baseURL = options.baseURL ?? 'https://api.deepseek.com'
    this.info = {
      vendor: 'deepseek',
      displayName: 'DeepSeek',
      providers: options.providers ?? ['deepseek-official'],
      credentialRef: options.credentialRef ?? 'DEEPSEEK_API_KEY',
      ...(options.credential === undefined ? {} : { credential: options.credential }),
      supported: true,
    }
  }

  protected override normalize(json: unknown): BalanceAccountData {
    const entry = firstBalanceInfo(json)
    return {
      currency: typeof entry['currency'] === 'string' ? entry['currency'] : 'CNY',
      total: amount(entry['total_balance']),
      ...(entry['granted_balance'] === undefined ? {} : { granted: amount(entry['granted_balance']) }),
      ...(entry['topped_up_balance'] === undefined ? {} : { toppedUp: amount(entry['topped_up_balance']) }),
    }
  }
}

/** Moonshot: `GET /v1/users/me/balance`. */
export class MoonshotBalanceProvider extends HttpBalanceProvider {
  override readonly info: BalanceProviderInfo
  protected override readonly baseURL: string
  protected override readonly path = '/v1/users/me/balance'

  constructor(options: { providers?: readonly string[]; credentialRef?: string; credential?: string; baseURL?: string } = {}) {
    super()
    this.baseURL = options.baseURL ?? 'https://api.moonshot.cn'
    this.info = {
      vendor: 'moonshot',
      displayName: 'Moonshot',
      providers: options.providers ?? ['moonshot'],
      credentialRef: options.credentialRef ?? 'MOONSHOT_API_KEY',
      ...(options.credential === undefined ? {} : { credential: options.credential }),
      supported: true,
    }
  }

  protected override normalize(json: unknown): BalanceAccountData {
    if (typeof json !== 'object' || json === null) throw new Error('vendor returned a non-object payload')
    const data = (json as Record<string, unknown>)['data']
    if (typeof data !== 'object' || data === null) throw new Error('vendor returned no data object')
    const record = data as Record<string, unknown>
    return {
      currency: 'CNY',
      total: amount(record['available_balance']),
      ...(record['voucher_balance'] === undefined ? {} : { granted: amount(record['voucher_balance']) }),
      ...(record['cash_balance'] === undefined ? {} : { toppedUp: amount(record['cash_balance']) }),
    }
  }
}

/** OpenRouter: `GET /api/v1/credits` (USD-denominated credits). */
export class OpenRouterBalanceProvider extends HttpBalanceProvider {
  override readonly info: BalanceProviderInfo
  protected override readonly baseURL: string
  protected override readonly path = '/api/v1/credits'

  constructor(options: { providers?: readonly string[]; credentialRef?: string; credential?: string; baseURL?: string } = {}) {
    super()
    this.baseURL = options.baseURL ?? 'https://openrouter.ai'
    this.info = {
      vendor: 'openrouter',
      displayName: 'OpenRouter',
      providers: options.providers ?? ['openrouter'],
      credentialRef: options.credentialRef ?? 'OPENROUTER_API_KEY',
      ...(options.credential === undefined ? {} : { credential: options.credential }),
      supported: true,
    }
  }

  protected override normalize(json: unknown): BalanceAccountData {
    if (typeof json !== 'object' || json === null) throw new Error('vendor returned a non-object payload')
    const data = (json as Record<string, unknown>)['data']
    if (typeof data !== 'object' || data === null) throw new Error('vendor returned no data object')
    const record = data as Record<string, unknown>
    return {
      currency: 'USD',
      total: amount(record['total_credits']),
    }
  }
}

/** SiliconFlow: `GET /v1/user/info` (balance in CNY). */
export class SiliconFlowBalanceProvider extends HttpBalanceProvider {
  override readonly info: BalanceProviderInfo
  protected override readonly baseURL: string
  protected override readonly path = '/v1/user/info'

  constructor(options: { providers?: readonly string[]; credentialRef?: string; credential?: string; baseURL?: string } = {}) {
    super()
    this.baseURL = options.baseURL ?? 'https://api.siliconflow.cn'
    this.info = {
      vendor: 'siliconflow',
      displayName: 'SiliconFlow',
      providers: options.providers ?? ['siliconflow'],
      credentialRef: options.credentialRef ?? 'SILICONFLOW_API_KEY',
      ...(options.credential === undefined ? {} : { credential: options.credential }),
      supported: true,
    }
  }

  protected override normalize(json: unknown): BalanceAccountData {
    if (typeof json !== 'object' || json === null) throw new Error('vendor returned a non-object payload')
    const data = (json as Record<string, unknown>)['data']
    if (typeof data !== 'object' || data === null) throw new Error('vendor returned no data object')
    const record = data as Record<string, unknown>
    return {
      currency: 'CNY',
      total: amount(record['balance']),
    }
  }
}

/** Quota units per USD in the New API platform (quota = USD x this). */
export const NEW_API_QUOTA_PER_USD = 500_000

/** New API: `GET /api/user/self` (quota in 1/500000 USD units). */
export class NewApiBalanceProvider extends HttpBalanceProvider {
  override readonly info: BalanceProviderInfo
  protected override readonly baseURL: string
  protected override readonly path = '/api/user/self'

  /**
   * @param options - the self-hosted instance origin (trailing slash stripped) and binding overrides.
   */
  constructor(options: { providers?: readonly string[]; credentialRef?: string; credential?: string; baseURL?: string } = {}) {
    super()
    this.baseURL = (options.baseURL ?? 'http://localhost:3000').replace(/\/+$/, '')
    this.info = {
      vendor: 'new-api',
      displayName: 'New API',
      providers: options.providers ?? ['new-api'],
      credentialRef: options.credentialRef ?? 'NEW_API_KEY',
      ...(options.credential === undefined ? {} : { credential: options.credential }),
      supported: true,
    }
  }

  protected override normalize(json: unknown): BalanceAccountData {
    if (typeof json !== 'object' || json === null) throw new Error('vendor returned a non-object payload')
    const data = (json as Record<string, unknown>)['data']
    if (typeof data !== 'object' || data === null) throw new Error('vendor returned no data object')
    const record = data as Record<string, unknown>
    return {
      currency: 'USD',
      total: amount(record['quota']) / NEW_API_QUOTA_PER_USD,
      ...(typeof record['display_name'] === 'string' ? { label: record['display_name'] } : {}),
    }
  }
}

/**
 * A bound-but-unsupported vendor: the LLM provider route resolves to this
 * provider so the dashboard shows "no public balance endpoint" instead of
 * "unbound", and the binding is declarative rather than a runtime special case.
 */
export class UnsupportedBalanceProvider extends BalanceProvider {
  /**
   * @param vendor - vendor id.
   * @param displayName - human vendor name.
   * @param providers - LLM provider routes bound to this unsupported vendor.
   * @param credentialRef - nominal reference (unused while unsupported).
   */
  constructor(
    readonly info: BalanceProviderInfo,
  ) {
    super()
  }

  override query(_credential: string, _signal?: AbortSignal): Promise<BalanceAccountData> {
    return Promise.reject(new Error(`${this.info.vendor} does not expose a public balance endpoint`))
  }
}

/** The unsupported mainstream vendors, bound so their status renders clearly. */
export const UNSUPPORTED_VENDORS: readonly BalanceProviderInfo[] = [
  { vendor: 'openai', displayName: 'OpenAI', providers: ['openai'], credentialRef: 'OPENAI_API_KEY', supported: false },
  { vendor: 'anthropic', displayName: 'Anthropic', providers: ['anthropic'], credentialRef: 'ANTHROPIC_API_KEY', supported: false },
  { vendor: 'google', displayName: 'Google', providers: ['google', 'gemini'], credentialRef: 'GOOGLE_API_KEY', supported: false },
  { vendor: 'xai', displayName: 'xAI', providers: ['xai'], credentialRef: 'XAI_API_KEY', supported: false },
  { vendor: 'mistral', displayName: 'Mistral', providers: ['mistral'], credentialRef: 'MISTRAL_API_KEY', supported: false },
]

/** Every concrete provider this package ships, in registration order. */
export const PROVIDERS: readonly BalanceProvider[] = [
  new DeepSeekBalanceProvider(),
  new MoonshotBalanceProvider(),
  new OpenRouterBalanceProvider(),
  new SiliconFlowBalanceProvider(),
  ...UNSUPPORTED_VENDORS.map(info => new UnsupportedBalanceProvider(info)),
]

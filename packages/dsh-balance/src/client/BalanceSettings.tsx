/**
 * Balance providers settings page: the user-managed bindings from the `balance`
 * settings section. This page talks to the plugin's own same-origin Web route
 * (`/_dsh/balance/settings`) instead of the host api-remotes settings Remote,
 * so it works without the host adding `balance` to its configuration allowlist.
 */

import { useCallback, useEffect, useState } from 'react'
import type { BalanceBindingConfig } from '../types.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BalanceSettings.module.css'

/** Injected business face of the balance settings page. */
export interface BalanceSettingsInjected {
  t: TranslateNS<'balance'>
}

/** The vendor types the settings page offers for a manual binding. */
const VENDOR_TYPES: readonly string[] = ['new-api', 'deepseek', 'moonshot', 'openrouter', 'siliconflow']

/** Same-origin Web route served by the balance plugin. */
const SETTINGS_ROUTE = '/_dsh/balance/settings'

/** One binding as returned by the redacted snapshot (inline credential hidden). */
type BindingRow = BalanceBindingConfig & { credentialConfigured?: boolean }

/** Draft binding form state (not persisted until submit). */
interface BindingForm {
  provider: string
  vendor: string
  credentialRef: string
  credential: string
  baseURL: string
}

const EMPTY_FORM: BindingForm = { provider: '', vendor: 'new-api', credentialRef: '', credential: '', baseURL: '' }

/** The balance providers settings page. */
export function BalanceSettings(props: BalanceSettingsInjected) {
  const { t } = props
  const [bindings, setBindings] = useState<BindingRow[] | null>(null)
  const [revision, setRevision] = useState(0)
  const [form, setForm] = useState<BindingForm>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(SETTINGS_ROUTE)
      const data = await res.json() as { ok: boolean; error?: { message: string }; value?: { settings: { bindings?: BindingRow[]; revision?: number } } }
      if (!data.ok) { setError(data.error?.message ?? 'query failed'); setBindings([]); return }
      setBindings(data.value?.settings.bindings ?? [])
      setRevision(data.value?.settings.revision ?? 0)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBindings([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (next: BalanceBindingConfig[]) => {
    setSaving(true)
    try {
      const res = await fetch(SETTINGS_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', expectedRevision: revision, value: { bindings: next } }),
      })
      const data = await res.json() as { ok: boolean; error?: { message: string }; value?: { settings: { bindings?: BindingRow[]; revision?: number } } }
      if (!data.ok) { setError(data.error?.message ?? 'save failed'); return }
      setBindings(data.value?.settings.bindings ?? [])
      setRevision(data.value?.settings.revision ?? 0)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setSaving(false) }
  }, [revision])

  const add = (): void => {
    const provider = form.provider.trim()
    const credentialRef = form.credentialRef.trim()
    const credential = form.credential.trim()
    if (provider === '' || (credentialRef === '' && credential === '')) {
      setError(t('bindingRequired'))
      return
    }
    const binding: BalanceBindingConfig = {
      provider,
      vendor: form.vendor,
      credentialRef,
      ...(credential === '' ? {} : { credential }),
      ...(form.baseURL.trim() === '' ? {} : { baseURL: form.baseURL.trim() }),
    }
    void save([...strip(bindings ?? []), binding])
    setForm(EMPTY_FORM)
  }

  const remove = (provider: string): void => {
    void save(strip(bindings ?? []).filter(binding => binding.provider !== provider))
  }

  return (
    <div className={css.page}>
      {error !== null && <p className={css.error} role="alert">{error}</p>}
      {bindings !== null && bindings.length === 0
        ? <p className={css.empty}>{t('noBindings')}</p>
        : (
          <ul className={css.list}>
            {(bindings ?? []).map(binding => (
              <li key={binding.provider} className={css.row}>
                <span className={css.provider}>{binding.provider}</span>
                <span className={css.vendor}>{binding.vendor}</span>
                <span className={css.ref}>{binding.credentialConfigured === true ? t('credentialInline') : binding.credentialRef}</span>
                {binding.baseURL !== undefined && <span className={css.base}>{binding.baseURL}</span>}
                <button type="button" className={css.remove} onClick={() => { remove(binding.provider) }}>{t('removeBinding')}</button>
              </li>
            ))}
          </ul>
        )}
      <form className={css.form} onSubmit={(event) => { event.preventDefault(); add() }}>
        <label className={css.field}>
          <span>{t('providerField')}</span>
          <input value={form.provider} onChange={(event) => { setForm({ ...form, provider: event.target.value }) }} placeholder="new-api" />
        </label>
        <label className={css.field}>
          <span>{t('vendorField')}</span>
          <select value={form.vendor} onChange={(event) => { setForm({ ...form, vendor: event.target.value }) }}>
            {VENDOR_TYPES.map(vendor => <option key={vendor} value={vendor}>{vendor}</option>)}
          </select>
        </label>
        <label className={css.field}>
          <span>{t('credentialRefField')}</span>
          <input value={form.credentialRef} onChange={(event) => { setForm({ ...form, credentialRef: event.target.value }) }} placeholder="NEW_API_KEY" />
        </label>
        <label className={css.field}>
          <span>{t('credentialField')}</span>
          <input value={form.credential} onChange={(event) => { setForm({ ...form, credential: event.target.value }) }} placeholder="sk-..." />
        </label>
        <label className={css.field}>
          <span>{t('baseURLField')}</span>
          <input value={form.baseURL} onChange={(event) => { setForm({ ...form, baseURL: event.target.value }) }} placeholder="http://localhost:3000" />
        </label>
        <button type="submit" className={css.submit} disabled={saving}>{t('addBinding')}</button>
      </form>
    </div>
  )
}

/** Drop the redaction marker so a save carries only the persisted fields. */
function strip(rows: BindingRow[]): BalanceBindingConfig[] {
  return rows.map(({ credentialConfigured: _ignored, ...binding }) => binding)
}

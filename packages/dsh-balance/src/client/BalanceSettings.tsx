/**
 * Balance providers settings page: the user-managed bindings from the `balance`
 * settings section. This page talks to the plugin's own same-origin Web route
 * (`/_dsh/balance/settings`) instead of the host api-remotes settings Remote,
 * so it works without the host adding `balance` to its configuration allowlist.
 *
 * Layout: a "configured bindings" list (with inline edit and two-step delete)
 * on top, and a single add/edit form below. The provider route field is a
 * combobox: its dropdown lists the model providers already configured in the
 * host, each labelled with its own display name alongside the route, and free
 * typing is still allowed. The credential source is a segmented choice between
 * "env var reference" and "paste API key" — the two fields are mutually
 * exclusive in the UI, mirroring the fact that an inline key overrides a
 * reference.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { BalanceBindingConfig } from '../types.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BalanceSettings.module.css'

/** Injected business face of the balance settings page. */
export interface BalanceSettingsInjected {
  t: TranslateNS<'balance'>
}

/** The vendor types the settings page offers for a manual binding. */
const VENDOR_TYPES: readonly string[] = ['new-api', 'deepseek', 'moonshot', 'openrouter', 'siliconflow']

/** One provider-route suggestion: the route plus a display name when known. */
export interface ProviderSuggestion {
  provider: string
  displayName?: string
}

/** Same-origin Web route served by the balance plugin. */
const SETTINGS_ROUTE = '/_dsh/balance/settings'

/** One binding as returned by the redacted snapshot (inline credential hidden). */
type BindingRow = BalanceBindingConfig & { credentialConfigured?: boolean }

/** A binding as built by the form: provider + vendor, then the optional
 *  mutable fields (BalanceBindingConfig itself is readonly + fully required,
 *  while this payload is built incrementally). */
type SaveBinding = {
  provider: string
  vendor: string
  credentialRef?: string
  credential?: string
  baseURL?: string
  credentialClear?: boolean
}

/** Which credential source the form is editing. */
type CredMode = 'ref' | 'key'

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
  const [configuredProviders, setConfiguredProviders] = useState<ProviderSuggestion[]>([])
  const [revision, setRevision] = useState(0)
  const [form, setForm] = useState<BindingForm>(EMPTY_FORM)
  const [editing, setEditing] = useState<string | null>(null)
  const [credMode, setCredMode] = useState<CredMode>('ref')
  const [clearCredential, setClearCredential] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(SETTINGS_ROUTE)
      const data = await res.json() as { ok: boolean; error?: { message: string }; value?: { providers?: ProviderSuggestion[]; settings: { bindings?: BindingRow[]; revision?: number } } }
      if (!data.ok) { setError(data.error?.message ?? 'query failed'); setBindings([]); return }
      setBindings(data.value?.settings.bindings ?? [])
      setConfiguredProviders(data.value?.providers ?? [])
      setRevision(data.value?.settings.revision ?? 0)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBindings([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (next: SaveBinding[]): Promise<boolean> => {
    setSaving(true)
    try {
      const res = await fetch(SETTINGS_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', expectedRevision: revision, value: { bindings: next } }),
      })
      const data = await res.json() as { ok: boolean; error?: { message: string }; value?: { settings: { bindings?: BindingRow[]; revision?: number } } }
      if (!data.ok) { setError(data.error?.message ?? 'save failed'); return false }
      setBindings(data.value?.settings.bindings ?? [])
      setRevision(data.value?.settings.revision ?? 0)
      setError(null)
      setSavedAt(Date.now())
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally { setSaving(false) }
  }, [revision])

  /** Drop the redaction marker so a save carries only the persisted fields. */
  const strip = useCallback((rows: BindingRow[]): SaveBinding[] => (
    rows.map(({ credentialConfigured: _ignored, ...binding }) => binding)
  ), [])

  const resetForm = (): void => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setCredMode('ref')
    setClearCredential(false)
    setError(null)
  }

  const startEdit = (row: BindingRow): void => {
    setEditing(row.provider)
    setForm({
      provider: row.provider,
      vendor: row.vendor,
      credentialRef: row.credentialRef ?? '',
      credential: '',
      baseURL: row.baseURL ?? '',
    })
    setCredMode(row.credentialConfigured === true ? 'key' : (row.credentialRef !== '' ? 'ref' : 'key'))
    setClearCredential(false)
    setError(null)
  }

  const remove = (provider: string): void => {
    void save(strip(bindings ?? []).filter(binding => binding.provider !== provider)).then((ok) => {
      if (ok) setConfirmDelete(null)
    })
  }

  const editedRow = editing === null ? undefined : (bindings ?? []).find(row => row.provider === editing)
  const hadStoredCredential = editedRow?.credentialConfigured === true
  // A stored inline key is removed on save when the form switches to the env
  // var reference mode (otherwise the key would keep overriding the reference).
  const willClearCredential = editing !== null && hadStoredCredential && (clearCredential || credMode === 'ref')

  // Provider route suggestions: the model providers already configured in the
  // host (free input still accepts any other route).
  const providerSuggestions: ProviderSuggestion[] = configuredProviders
    .filter(provider => provider.provider !== '')

  const submit = (): void => {
    const provider = form.provider.trim()
    if (provider === '') { setError(t('providerRequired')); return }
    if (credMode === 'ref' && form.credentialRef.trim() === '') { setError(t('credentialRefRequired')); return }
    if (credMode === 'key' && editing === null && form.credential.trim() === '') { setError(t('credentialRequired')); return }

    const binding = buildBinding({ form, credMode, clearCredential, hadStoredCredential })
    const next = editing === null
      ? [...strip(bindings ?? []), binding]
      : strip(bindings ?? []).map(row => (row.provider === editing ? binding : row))
    void save(next).then((ok) => {
      if (ok) resetForm()
    })
  }

  // Fade the "saved" confirmation out after a short while.
  useEffect(() => {
    if (savedAt === null) return
    const id = window.setTimeout(() => { setSavedAt(null) }, 2500)
    return () => { window.clearTimeout(id) }
  }, [savedAt])

  // Auto-cancel a pending delete confirmation.
  useEffect(() => {
    if (confirmDelete === null) return
    const id = window.setTimeout(() => { setConfirmDelete(null) }, 3000)
    return () => { window.clearTimeout(id) }
  }, [confirmDelete])

  return (
    <div className={css.page}>
      {error !== null && <p className={css.error} role="alert">{error}</p>}
      {savedAt !== null && error === null && <p className={css.ok} role="status">{t('saved')}</p>}

      <section className={css.section}>
        <h3 className={css.sectionTitle}>
          {t('sectionBindings')}
          {bindings !== null && <span className={css.count}>{bindings.length}</span>}
        </h3>
        {bindings !== null && bindings.length === 0
          ? <p className={css.empty}>{t('noBindings')}</p>
          : (
            <ul className={css.list}>
              {(bindings ?? []).map(binding => (
                <li key={binding.provider} className={css.row}>
                  <div className={css.rowMain}>
                    <span className={css.provider}>{binding.provider}</span>
                    <span className={css.vendorPill}>{binding.vendor}</span>
                    <span className={css.rowActions}>
                      <button type="button" className={css.action} onClick={() => { startEdit(binding) }}>{t('edit')}</button>
                      {confirmDelete === binding.provider
                        ? (
                          <>
                            <button type="button" className={css.confirmDelete} onClick={() => { remove(binding.provider) }}>{t('confirmDelete')}</button>
                            <button type="button" className={css.action} onClick={() => { setConfirmDelete(null) }}>{t('cancel')}</button>
                          </>
                        )
                        : (
                          <button type="button" className={css.remove} onClick={() => { setConfirmDelete(binding.provider) }}>{t('removeBinding')}</button>
                        )}
                    </span>
                  </div>
                  <div className={css.rowMeta}>
                    {binding.credentialConfigured === true
                      ? <span className={css.credChip}>{t('credentialInline')}</span>
                      : binding.credentialRef !== ''
                        ? <span className={css.credRef}>{binding.credentialRef}</span>
                        : <span className={css.credNone}>{t('noCredential')}</span>}
                    {binding.baseURL !== undefined && <span className={css.base}>{binding.baseURL}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

      <form className={css.form} onSubmit={(event) => { event.preventDefault(); submit() }}>
        <h3 className={css.sectionTitle}>
          {editing === null ? t('addBinding') : `${t('sectionEdit')}: ${editing}`}
        </h3>
        <div className={css.seg} role="group" aria-label={t('credentialField')}>
          <button type="button" className={credMode === 'ref' ? css.segActive : css.segBtn} onClick={() => { setCredMode('ref') }}>{t('credRefMode')}</button>
          <button type="button" className={credMode === 'key' ? css.segActive : css.segBtn} onClick={() => { setCredMode('key') }}>{t('credKeyMode')}</button>
        </div>
        <div className={css.field}>
          <span>{t('providerField')}</span>
          <ProviderCombobox
            value={form.provider}
            onChange={(provider) => { setForm({ ...form, provider }) }}
            suggestions={providerSuggestions}
            disabled={editing !== null}
            placeholder="new-api"
            emptyLabel={t('noMatch')}
          />
          {editing !== null
            ? <p className={css.hint}>{t('providerReadonlyHint')}</p>
            : <p className={css.hint}>{t('providerHint')}</p>}
        </div>
        <label className={css.field}>
          <span>{t('vendorField')}</span>
          <select value={form.vendor} onChange={(event) => { setForm({ ...form, vendor: event.target.value }) }}>
            {VENDOR_TYPES.map(vendor => <option key={vendor} value={vendor}>{vendor}</option>)}
          </select>
        </label>
        {credMode === 'ref'
          ? (
            <label className={css.field}>
              <span>{t('credentialRefField')}</span>
              <input
                value={form.credentialRef}
                onChange={(event) => { setForm({ ...form, credentialRef: event.target.value }) }}
                placeholder="NEW_API_KEY"
                spellCheck={false}
                autoComplete="off"
              />
              {willClearCredential && <p className={css.willClear}>{t('willClearCredential')}</p>}
            </label>
          )
          : (
            <label className={css.field}>
              <span>
                {t('credentialField')}
                {hadStoredCredential && <em className={css.storedChip}>{t('storedCredential')}</em>}
              </span>
              <input
                type="password"
                value={form.credential}
                onChange={(event) => { setForm({ ...form, credential: event.target.value }); setClearCredential(false) }}
                placeholder={hadStoredCredential ? t('keepCredentialHint') : 'sk-...'}
                spellCheck={false}
                autoComplete="new-password"
              />
              {editing !== null && hadStoredCredential && (
                <button
                  type="button"
                  className={clearCredential ? css.clearCredArmed : css.clearCred}
                  onClick={() => { setClearCredential(!clearCredential); setForm({ ...form, credential: '' }) }}
                >
                  {t('clearCredential')}
                </button>
              )}
              {willClearCredential && <p className={css.willClear}>{t('willClearCredential')}</p>}
            </label>
          )}
        <label className={css.field}>
          <span>{t('baseURLField')}</span>
          <input
            value={form.baseURL}
            onChange={(event) => { setForm({ ...form, baseURL: event.target.value }) }}
            placeholder="http://localhost:3000"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className={css.actions}>
          <button type="submit" className={css.submit} disabled={saving || bindings === null}>
            {saving ? t('saving') : editing === null ? t('addBinding') : t('saveChanges')}
          </button>
          {editing !== null && (
            <button type="button" className={css.cancel} onClick={resetForm} disabled={saving}>{t('cancel')}</button>
          )}
        </div>
      </form>
    </div>
  )
}

/** Build the persisted binding object from the current form state. */
function buildBinding(args: {
  form: BindingForm
  credMode: CredMode
  clearCredential: boolean
  hadStoredCredential: boolean
}): SaveBinding {
  const { form, credMode, clearCredential, hadStoredCredential } = args
  const out: SaveBinding = {
    provider: form.provider.trim(),
    vendor: form.vendor,
  }
  const credentialRef = form.credentialRef.trim()
  if (credentialRef !== '') out.credentialRef = credentialRef
  const baseURL = form.baseURL.trim()
  if (baseURL !== '') out.baseURL = baseURL
  // Switching a binding that stores an inline key to "env var reference" must
  // drop the stored key, otherwise the key keeps overriding the reference.
  const mustClear = hadStoredCredential && credMode === 'ref'
  if (mustClear || clearCredential) {
    out.credentialClear = true
  } else if (credMode === 'key') {
    const key = form.credential.trim()
    if (key !== '') out.credential = key
  }
  return out
}

/**
 * Provider route combobox: a text input with a filterable dropdown. Each
 * candidate shows its display name (when known) next to the raw route, so the
 * user sees what they are selecting; typing a route that is not in the list
 * is still allowed (free input). Arrow keys move the highlight, Enter picks,
 * Escape closes.
 */
function ProviderCombobox(props: {
  value: string
  onChange: (provider: string) => void
  suggestions: readonly ProviderSuggestion[]
  disabled?: boolean
  placeholder?: string
  emptyLabel?: string
}) {
  const { value, onChange, suggestions, disabled, placeholder, emptyLabel } = props
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  const query = value.trim().toLowerCase()
  const matches = query === ''
    ? suggestions
    : suggestions.filter(suggestion =>
      suggestion.provider.toLowerCase().includes(query)
      || (suggestion.displayName ?? '').toLowerCase().includes(query))

  // Close when clicking outside the combobox.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => { window.removeEventListener('mousedown', onMouseDown) }
  }, [open])

  // Keep the highlighted item in view while navigating with the keyboard.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const openList = (): void => {
    const current = matches.findIndex(suggestion => suggestion.provider === value)
    setHighlight(current >= 0 ? current : 0)
    setOpen(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) { openList(); return }
      setHighlight(current => Math.min(current + 1, Math.max(matches.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { openList(); return }
      setHighlight(current => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      const picked = matches[Math.min(highlight, matches.length - 1)]
      if (open && picked !== undefined) {
        event.preventDefault()
        onChange(picked.provider)
        setOpen(false)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={css.combobox} ref={rootRef}>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value)
          setHighlight(0)
          setOpen(true)
        }}
        onFocus={() => { if (!disabled) openList() }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      {open && !disabled && matches.length > 0 && (
        <ul className={css.popup} role="listbox" aria-label={placeholder}>
          {matches.map((suggestion, index) => (
            <li key={suggestion.provider} role="presentation">
              <button
                type="button"
                ref={index === highlight ? activeRef : undefined}
                className={index === highlight ? css.popupItemActive : css.popupItem}
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onChange(suggestion.provider)
                  setOpen(false)
                }}
                onMouseEnter={() => { setHighlight(index) }}
              >
                <span className={css.popupDisplay}>{suggestion.displayName !== undefined && suggestion.displayName !== '' ? suggestion.displayName : suggestion.provider}</span>
                {suggestion.displayName !== undefined && suggestion.displayName !== '' && <span className={css.popupRoute}>{suggestion.provider}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !disabled && matches.length === 0 && (
        <div className={css.popupEmpty}>{emptyLabel ?? ''}</div>
      )}
    </div>
  )
}

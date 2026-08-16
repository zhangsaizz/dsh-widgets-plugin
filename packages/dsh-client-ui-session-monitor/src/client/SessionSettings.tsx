/**
 * Configuration panel for the session monitor widget, registered into the
 * widget manager's "Configure" dialog (`widgets.config`, id
 * `session-monitor`). Self-contained: it reads/writes the same localStorage
 * keys as the widget (via ./settings.ts) and announces changes so a mounted
 * widget re-reads them live. Localized through the injected `t` seat.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_SETTINGS, POS_KEY, SCALE_KEY, SETTINGS_CHANGED_EVENT, loadSettings, saveSettings,
} from './settings.ts'
import type { MonitorSettings } from './settings.ts'
import css from './SessionSettings.module.css'

/** Injected face: just the locale seat. */
export interface SessionSettingsInjected {
  t: TranslateNS<'session-monitor'>
}

/** One settings row: label + optional hint + control. */
function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <span className={css.label}>{props.label}</span>
        {props.hint ? <span className={css.hint}>{props.hint}</span> : null}
      </div>
      <div className={css.control}>{props.children}</div>
    </div>
  )
}

export function SessionSettings({ t }: SessionSettingsInjected) {
  const [settings, setSettings] = useState<MonitorSettings>(loadSettings)
  const [perm, setPerm] = useState<'default' | 'granted' | 'denied' | 'unsupported'>(
    () => typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )

  function update(patch: Partial<MonitorSettings>): void {
    const next = { ...settings, ...patch }
    // Clamp on save, not only on load: the number input allows out-of-range
    // values and the panel must not show them until a reload.
    if (patch.autoDismissSec !== undefined) {
      next.autoDismissSec = Math.min(60, Math.max(2, Math.round(next.autoDismissSec)))
    }
    setSettings(next)
    saveSettings(next)
  }

  function resetAll(): void {
    setSettings({ ...DEFAULT_SETTINGS })
    saveSettings({ ...DEFAULT_SETTINGS })
  }

  // Keep the permission line honest when the user changes the permission in
  // the browser's site settings while the panel is open.
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    const refresh = (): void => { setPerm(Notification.permission) }
    const onFocus = (): void => { refresh() }
    window.addEventListener('focus', onFocus)
    let status: PermissionStatus | undefined
    if (navigator.permissions !== undefined) {
      void navigator.permissions.query({ name: 'notifications' as PermissionName })
        .then((s) => { status = s; s.onchange = refresh })
        .catch(() => undefined)
    }
    return () => {
      window.removeEventListener('focus', onFocus)
      if (status !== undefined) status.onchange = null
    }
  }, [])

  return (
    <div className={css.panel}>
      <Row label={t('notifyLabel')} hint={t('notifyDesc')}>
        <input
          type="checkbox"
          checked={settings.notify}
          onChange={(e) => update({ notify: e.target.checked })}
        />
      </Row>
      <Row label={t('notifyModeLabel')}>
        <select
          value={settings.notifyMode}
          onChange={(e) => update({ notifyMode: e.target.value as MonitorSettings['notifyMode'] })}
        >
          <option value="auto">{t('notifyModeAuto')}</option>
          <option value="confirm">{t('notifyModeConfirm')}</option>
        </select>
      </Row>
      {settings.notifyMode === 'auto'
        ? (
          <Row label={t('autoDismissSecLabel')}>
            <input
              type="number"
              min={2}
              max={60}
              step={1}
              value={settings.autoDismissSec}
              onChange={(e) => update({ autoDismissSec: Number(e.target.value) || 8 })}
            />
            <span className={css.unit}>s</span>
          </Row>
          )
        : null}
      <Row label={t('soundLabel')}>
        <input
          type="checkbox"
          checked={settings.sound}
          onChange={(e) => update({ sound: e.target.checked })}
        />
      </Row>
      <Row label={t('browserNotifyLabel')} hint={t('browserNotifyDesc')}>
        <input
          type="checkbox"
          checked={settings.browserNotify}
          onChange={async (e) => {
            const want = e.target.checked
            if (!want) { update({ browserNotify: false }); return }
            if (typeof Notification === 'undefined') { update({ browserNotify: false }); return }
            let permission = Notification.permission
            if (permission === 'default') {
              try { permission = await Notification.requestPermission() } catch { /* denied */ }
            }
            setPerm(permission)
            if (permission === 'granted') update({ browserNotify: true })
            else update({ browserNotify: false })
          }}
        />
      </Row>
      <div className={css.permLine}>
        {perm === 'granted'
          ? <span className={css.permOk}>{t('permGranted')}</span>
          : perm === 'denied'
            ? <span className={css.permBad}>{t('permDenied')}</span>
            : <span className={css.permMuted}>{t('permAsk')}</span>}
      </div>
      <Row label={t('notifyCurrentLabel')} hint={t('notifyCurrentDesc')}>
        <input
          type="checkbox"
          checked={settings.notifyCurrent}
          onChange={(e) => update({ notifyCurrent: e.target.checked })}
        />
      </Row>
      <Row label={t('showSubagentsLabel')} hint={t('showSubagentsDesc')}>
        <input
          type="checkbox"
          checked={settings.showSubagents}
          onChange={(e) => update({ showSubagents: e.target.checked })}
        />
      </Row>
      <Row label={t('runningOnlyLabel')} hint={t('runningOnlyDesc')}>
        <input
          type="checkbox"
          checked={settings.runningOnly}
          onChange={(e) => update({ runningOnly: e.target.checked })}
        />
      </Row>
      <Row
        label={t('timeWindowLabel')}
        hint={settings.runningOnly ? t('timeWindowDisabledHint') : t('timeWindowDesc')}
      >
        <select
          className={settings.runningOnly ? css.inactive : undefined}
          value={settings.timeWindowMin}
          onChange={(e) => update({ timeWindowMin: Number(e.target.value) || 0 })}
        >
          <option value={0}>{t('timeWindowAll')}</option>
          <option value={15}>{t('timeWindow15m')}</option>
          <option value={30}>{t('timeWindow30m')}</option>
          <option value={60}>{t('timeWindow1h')}</option>
          <option value={180}>{t('timeWindow3h')}</option>
          <option value={360}>{t('timeWindow6h')}</option>
          <option value={1440}>{t('timeWindow24h')}</option>
        </select>
      </Row>
      <Row label={t('showDoneLabel')}>
        <input
          type="checkbox"
          checked={settings.showDone}
          onChange={(e) => update({ showDone: e.target.checked })}
        />
      </Row>
      <div className={css.actions}>
        <button
          className={css.resetBtn}
          onClick={() => {
            try {
              window.localStorage.removeItem(POS_KEY)
              window.localStorage.removeItem(SCALE_KEY)
              window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT))
            } catch { /* storage */ }
          }}
        >
          {t('resetPosScale')}
        </button>
        <button className={css.resetBtn} onClick={resetAll}>{t('resetAll')}</button>
      </div>
    </div>
  )
}

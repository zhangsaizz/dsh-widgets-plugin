/**
 * Root-scope `shell.bottom` status bar (harness 0.2.1): a full-width row under
 * the three shell columns showing the current session's cumulative token usage.
 *
 * Data comes from the same `tokenUsage` session projection the floating badge
 * reads (standard `useSessions` prop, reactive — no RPC, no polling); the
 * current session is resolved with the shared `session-selection.ts` because a
 * root-scope slot carries no `sessionId`.
 *
 * Visibility follows the badge's persisted `bottomBar` option: the panel writes
 * the shared blob and fires {@link TOKEN_CRIT_SETTINGS_CHANGED}; this component
 * re-reads it and also listens for cross-tab `storage` events. It renders
 * nothing while disabled or while no session is selected, so the slot reserves
 * no height (`ui-layout`'s row collapses when the slot content is empty).
 *
 * Registration uses `priority: 1`: `shell.bottom` is a single slot and the
 * official experimental inspector registers the same cell at the default
 * priority 0 — a second registration at 0 throws, while 1 lets the inspector
 * own the row when its bundle is enabled and this bar render otherwise.
 *
 * @module @dsh-plugins/client-ui-token-crit/client/BottomMeter
 */

import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `shell.bottom` SlotMap merge declared by ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the `useSessions` standard-prop merge plus the `tokenUsage`
// projection key this bar reads (module augmentation, not a runtime import).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { currentSessionId } from './session-selection.ts'
import { compact } from './format.ts'
import { TOKEN_CRIT_SETTINGS_CHANGED, loadSettings } from './settings.ts'
import css from './BottomMeter.module.css'

/** Full composed props for the bar (root scope: no `sessionId`). */
export type BottomMeterProps = PropsRuntime<'shell.bottom'>

/** Current session id derived from the same list snapshot the bar selects. */
function currentUsage(state: SessionListState): TokenUsageProjection | undefined {
  const current = currentSessionId(state)
  if (current === undefined) return undefined
  return state.byId[current]?.projectionValues?.tokenUsage
}

/** Whether the selected session is running (drives the live dot). */
function currentRunning(state: SessionListState): boolean {
  const current = currentSessionId(state)
  return current === undefined ? false : state.byId[current]?.running === true
}

/** Full-width token usage status bar. */
export function BottomMeter({ useSessions }: BottomMeterProps) {
  const usage = useSessions(currentUsage)
  const running = useSessions(currentRunning)
  const [prefs, setPrefs] = useState(() => {
    const settings = loadSettings()
    return { enabled: settings.bottomBar, lang: settings.lang }
  })

  // Follow the badge's saved options (same tab: custom event; other tabs: storage).
  useEffect(() => {
    const read = (): void => {
      const settings = loadSettings()
      setPrefs({ enabled: settings.bottomBar, lang: settings.lang })
    }
    window.addEventListener(TOKEN_CRIT_SETTINGS_CHANGED, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(TOKEN_CRIT_SETTINGS_CHANGED, read)
      window.removeEventListener('storage', read)
    }
  }, [])

  if (!prefs.enabled || usage === undefined) return null

  const zh = prefs.lang === 'zh'
  const input = (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  const output = usage.outputTokens ?? 0
  const cache = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  return (
    <div className={css.bar} data-token-crit-bottom lang={prefs.lang}>
      <span className={css.dot} data-active={running || undefined} aria-hidden="true" />
      <span className={css.label}>{zh ? '词元' : 'TOKENS'}</span>
      <span className={css.value}>{compact(input + output)}</span>
      <span className={css.breakdown}>
        {zh
          ? `输入 ${compact(input)} · 缓存 ${compact(cache)} · 输出 ${compact(output)}`
          : `Input ${compact(input)} · Cache ${compact(cache)} · Output ${compact(output)}`}
      </span>
      <span className={css.spacer} />
      <span className={css.brand}>{zh ? 'Token 暴击' : 'Token crit'}</span>
    </div>
  )
}

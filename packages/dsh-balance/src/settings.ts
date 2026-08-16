/**
 * Balance settings vocabulary shared by the plugin body and the optional Web
 * settings route: the binding schema, the settings-section schema, and the
 * namespace identity.
 * @module @dsh-plugins/balance/settings
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { BalanceBindingConfig } from './types.ts'

/** One deployment-configured balance binding (filled directly in cordis.patch.yml). */
export const bindingSchema = z.object({
  provider: z.string().required(),
  vendor: z.string().required(),
  credentialRef: z.string().role('credential-ref'),
  credential: z.string().role('secret'),
  baseURL: z.string(),
})

/** The stored shape of the `balance` settings section (mirrors `BalanceBindingConfig`). */
export interface BalanceSettingsShape {
  bindings: BalanceBindingConfig[]
}

/**
 * The `balance` settings-section schema (validates the stored user document).
 * Annotated explicitly: the inferred schemastery type references cosmokit
 * internals, which declaration emit cannot name portably (TS2742).
 */
export const BalanceSettingsSchema: z<BalanceSettingsShape> = z.object({
  bindings: z.array(bindingSchema).default([]),
})

/** Settings namespace owning the user-managed balance bindings. */
export const BALANCE_SETTINGS_NS = settingsNamespace('balance')

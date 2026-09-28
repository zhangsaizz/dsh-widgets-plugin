/**
 * Balance settings vocabulary shared by the plugin body and the optional Web
 * settings route: the binding schema and the default settings-namespace id.
 *
 * Harness 0.1.7 note: the balance settings section is no longer a separately
 * registered `SettingsProvider` namespace — it IS the plugin's Config entry
 * (see `Config` in ./index.ts, whose `bindings` field carries
 * {@link bindingSchema}). The namespace a configuration surface sees is
 * therefore the profile entry id the plugin was mounted under (our bundle uses
 * `balance`), not a name the plugin registers; {@link BALANCE_SETTINGS_NS} is
 * kept as the documented default and as the fallback for an install mounted
 * without a loader entry id.
 *
 * @module @dsh-plugins/balance/settings
 */

import z from '@deepseek-ai/schemastery'

/** One deployment-configured balance binding (filled directly in cordis.patch.yml). */
export const bindingSchema = z.object({
  provider: z.string().required(),
  vendor: z.string().required(),
  credentialRef: z.string().role('credential-ref'),
  credential: z.string().role('secret'),
  baseURL: z.string(),
})

/** Default settings namespace (profile entry id) owning the balance bindings. */
export const BALANCE_SETTINGS_NS = 'balance'

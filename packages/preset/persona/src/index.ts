/**
 * A per-agent persona as a composable row.
 *
 * `fathom-system-prompt` owns the global persona as its own config, and registers
 * that section unconditionally — so this row is **scope-only**. Mounted inside
 * an agent preset it shadows the deployment persona for that one session,
 * exactly like the per-child persona `fathom-subagent` installs; mounted globally
 * it collides with the registry's own registration and fails loud.
 *
 * That constraint is the reason the row exists. An agent preset cannot mount
 * the prompt registry itself, so without a row of its own a preset could
 * change an agent's tools but never its identity.
 * @module @fathom/persona
 */

import type { Context } from '@fathom/cordis'
import z from '@fathom/schemastery'
import type {} from '@fathom/system-prompt'
import { installSettingsSection, settingsNamespace } from '@fathom/settings'

// Imported rather than restated: the registry declares the slot this row
// replaces, and two hardcoded copies would drift into a preset whose persona
// silently lands beside the deployment's instead of shadowing it.
import { PERSONA_ORDER, PERSONA_SECTION } from '@fathom/system-prompt'

export { PERSONA_ORDER, PERSONA_SECTION }

/** Cordis plugin name. */
export const name = 'persona'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  text: string
  /** Make this persona the complete system prompt, suppressing every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
  /**
   * Register the `persona` settings namespace so the settings page can replace
   * the text. Only one mounted row may set this: a namespace registers once.
   */
  settings?: boolean
}

/** Runtime schema for the persona row. */
export const Config: z<Config> = z.object({
  text: z.string().required(),
  complete: z.boolean().default(false),
  includeRuntimeContext: z.boolean().default(true),
  settings: z.boolean().default(false),
})

/** The user-editable part of the configuration. */
export interface PersonaSettings {
  /** See {@link Config.text}. */
  text: string
}

/** Settings namespace the Plugins settings page edits. */
export const PERSONA_SETTINGS_NAMESPACE = settingsNamespace('persona')

/** Schema of the settings namespace. */
export const PERSONA_SETTINGS_SCHEMA: z<PersonaSettings> = z.object({
  text: z.string().required(),
})

/**
 * Register the persona section for the mounting context's scope.
 * @param ctx - an agent scope context; an unscoped context collides with the
 * prompt registry's own persona registration and rejects.
 * @param config - the persona text and complete-prompt policy.
 */
export function apply(ctx: Context, config: Config): void {
  // The section text is read at each prompt assembly, so a saved edit reaches
  // the very next request of every session using this persona.
  const entry: PersonaSettings = { text: config.text }
  let source = (): PersonaSettings => entry
  if (config.settings === true) {
    installSettingsSection(ctx, PERSONA_SETTINGS_NAMESPACE, PERSONA_SETTINGS_SCHEMA, entry, {
      setSource: (current) => { source = current },
      onChange: () => {},
    })
  }
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: PERSONA_ORDER,
    text: () => source().text,
    ...(config.complete ? { complete: true } : {}),
  }), 'persona.section()')
  if (!(config.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext()
}

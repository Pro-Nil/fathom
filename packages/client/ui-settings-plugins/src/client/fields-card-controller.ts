/**
 * A descriptor-driven card over one settings namespace, for plugins whose
 * settings are a handful of plain fields. Each card is a {@link CardDescriptor}
 * (namespace, copy keys, fields); the controller stages edits through the
 * shared {@link CardForm} exactly like the hand-written cards.
 */

import type { SettingsScope, SnapshotStore } from '@pentest-harness/dsh-client-runtime/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldSpec, type CardFieldState, type CardShell,
} from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'

/** How a field's value is edited. */
export type FieldKind = 'number' | 'text' | 'multiline' | 'boolean' | 'numberList' | 'select'

/** One field of a descriptor card. */
export interface FieldDescriptor {
  /** Field name inside the namespace section. */
  field: string
  /** Control and conversion. */
  kind: FieldKind
  /** Locale key of the label. */
  labelKey: PluginsSettingsLocaleKey
  /** Locale key of the hint under the control. */
  hintKey: PluginsSettingsLocaleKey
  /** Choices of a `select` field; the empty value means "use the default". */
  options?: readonly { value: string; label: string }[]
}

/** One descriptor card. */
export interface CardDescriptor {
  /** Settings namespace the card edits; also the slot key. */
  namespace: string
  /** Locale key of the card title. */
  titleKey: PluginsSettingsLocaleKey
  /** Locale key of the card description. */
  descriptionKey: PluginsSettingsLocaleKey
  /** The fields, in display order. */
  fields: FieldDescriptor[]
}

/**
 * An on/off field. The draft is `'true'` or `'false'`; an empty draft clears it.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function booleanField(field: string): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      if (text === 'true' || text === 'false') return { kind: 'set', value: text === 'true' }
      return undefined
    },
  }
}

/**
 * A list of whole numbers typed as `3, 5, 8`. `off` stores an empty list; an
 * empty draft clears the field back to its default.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function numberListField(field: string): CardFieldSpec {
  return {
    field,
    format: value => Array.isArray(value) ? (value.length === 0 ? 'off' : value.join(', ')) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (trimmed.toLowerCase() === 'off') return { kind: 'set', value: [] }
      const parts = trimmed.split(/[\s,]+/).filter(part => part !== '')
      const values = parts.map(Number)
      return values.every(Number.isInteger) ? { kind: 'set', value: values } : undefined
    },
  }
}

/**
 * Multi-line text kept as typed apart from surrounding blank lines. An empty
 * draft clears the field.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function multilineField(field: string): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.replace(/^\s*\n|\n\s*$/g, '')
      return trimmed.trim() === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

function specFor(descriptor: FieldDescriptor): CardFieldSpec {
  switch (descriptor.kind) {
    case 'number': return numberField(descriptor.field)
    case 'text': return textField(descriptor.field)
    case 'select': return textField(descriptor.field)
    case 'multiline': return multilineField(descriptor.field)
    case 'boolean': return booleanField(descriptor.field)
    case 'numberList': return numberListField(descriptor.field)
  }
}

/** What a descriptor card renders. */
export interface FieldsCardState extends CardShell {
  /** The card's copy keys. */
  descriptor: CardDescriptor
  /** Each field's descriptor with its current control state, in display order. */
  fields: { descriptor: FieldDescriptor; state: CardFieldState }[]
}

/** The registration-side face a descriptor card's slot entry injects. */
export interface FieldsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useFieldsCard. */
    fieldsCard: SnapshotStore<FieldsCardState>
  }
}

/** Bridges one namespace scope onto a descriptor card's staged form. */
export class FieldsCardController {
  private readonly form: CardForm<Record<string, unknown>>
  private readonly store: SnapshotStore<FieldsCardState>

  /**
   * @param descriptor - the card to drive.
   * @param scope - the bound settings scope for `descriptor.namespace`.
   */
  constructor(private readonly descriptor: CardDescriptor, scope: SettingsScope<Record<string, unknown>>) {
    this.form = new CardForm(scope, descriptor.fields.map(specFor))
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): FieldsCardState {
    return {
      ...this.form.shell(),
      descriptor: this.descriptor,
      fields: this.descriptor.fields.map(field => ({ descriptor: field, state: this.form.field(field.field) })),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): FieldsCardFace {
    return { hooks: { fieldsCard: this.store }, ...this.form.actions() }
  }
}

/** The cards this package ships for the token, loop-guard, session-folder and persona settings. */
export const FIELD_CARDS: CardDescriptor[] = [
  {
    namespace: 'compaction',
    titleKey: 'compactionTitle',
    descriptionKey: 'compactionDescription',
    fields: [
      { field: 'thresholdRatio', kind: 'number', labelKey: 'compactionThreshold', hintKey: 'compactionThresholdHint' },
      { field: 'retainRatio', kind: 'number', labelKey: 'compactionRetain', hintKey: 'compactionRetainHint' },
      { field: 'maxTokens', kind: 'number', labelKey: 'compactionMaxTokens', hintKey: 'compactionMaxTokensHint' },
    ],
  },
  {
    namespace: 'spill-policy',
    titleKey: 'spillTitle',
    descriptionKey: 'spillDescription',
    fields: [
      { field: 'maxInlineBytes', kind: 'number', labelKey: 'spillMaxInlineBytes', hintKey: 'spillMaxInlineBytesHint' },
    ],
  },
  {
    namespace: 'tool-result-pruner',
    titleKey: 'prunerTitle',
    descriptionKey: 'prunerDescription',
    fields: [
      { field: 'thresholdChars', kind: 'number', labelKey: 'prunerThreshold', hintKey: 'prunerThresholdHint' },
      { field: 'headChars', kind: 'number', labelKey: 'prunerHead', hintKey: 'prunerHeadHint' },
      { field: 'tailChars', kind: 'number', labelKey: 'prunerTail', hintKey: 'prunerTailHint' },
    ],
  },
  {
    namespace: 'repeat-tool-reminder',
    titleKey: 'loopGuardTitle',
    descriptionKey: 'loopGuardDescription',
    fields: [
      { field: 'thresholds', kind: 'numberList', labelKey: 'loopGuardRepeat', hintKey: 'loopGuardRepeatHint' },
      { field: 'failureThresholds', kind: 'numberList', labelKey: 'loopGuardFailure', hintKey: 'loopGuardFailureHint' },
    ],
  },
  {
    namespace: 'session-folders',
    titleKey: 'sessionFoldersTitle',
    descriptionKey: 'sessionFoldersDescription',
    fields: [
      { field: 'enabled', kind: 'boolean', labelKey: 'sessionFoldersEnabled', hintKey: 'sessionFoldersEnabledHint' },
      { field: 'folder', kind: 'text', labelKey: 'sessionFoldersFolder', hintKey: 'sessionFoldersFolderHint' },
    ],
  },
  {
    namespace: 'web-search',
    titleKey: 'webSearchTitle',
    descriptionKey: 'webSearchDescription',
    fields: [
      {
        field: 'searchProvider',
        kind: 'select',
        labelKey: 'webSearchProvider',
        hintKey: 'webSearchProviderHint',
        options: [
          { value: '', label: 'Automatic' },
          { value: 'google', label: 'Google (no key, uses the built-in browser)' },
          { value: 'google-api', label: 'Google API (GOOGLE_API_KEY + GOOGLE_CSE_ID)' },
          { value: 'duckduckgo', label: 'DuckDuckGo (no key)' },
          { value: 'exa', label: 'Exa (EXA_API_KEY)' },
          { value: 'perplexity', label: 'Perplexity (PERPLEXITY_API_KEY)' },
        ],
      },
      { field: 'searchFallback', kind: 'boolean', labelKey: 'webSearchFallback', hintKey: 'webSearchFallbackHint' },
    ],
  },
  {
    namespace: 'persona',
    titleKey: 'personaTitle',
    descriptionKey: 'personaDescription',
    fields: [
      { field: 'text', kind: 'multiline', labelKey: 'personaText', hintKey: 'personaTextHint' },
    ],
  },
]

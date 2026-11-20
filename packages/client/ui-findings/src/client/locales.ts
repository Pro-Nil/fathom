/** `findings` namespace dictionaries. */

/** The findings namespace key union. */
export type FindingsKey = keyof typeof en

/** English dictionary (the key-set source of truth). */
export const en = {
  'title': 'Findings',
  'toggle.open': 'Show findings',
  'toggle.close': 'Hide findings',
  'filter.all': 'All',
  'empty.selected': 'Select a finding to see how it was found, why it happens, and how to fix it.',
  'section.why': 'Why it happens',
  'section.impact': 'Impact',
  'section.reproduce': 'How to reproduce',
  'section.fix': 'How to fix',
  'section.evidence': 'How it was found',
  'label.request': 'request',
  'label.response': 'response',
} satisfies Record<string, string>

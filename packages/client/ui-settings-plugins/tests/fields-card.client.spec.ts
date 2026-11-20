/**
 * Descriptor cards: the extra field kinds (on/off, number lists, multi-line
 * text) and a list value surviving the save read-back.
 */

import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@fathom/client-test-runtime'
import {
  FIELD_CARDS, FieldsCardController, booleanField, multilineField, numberListField,
} from '../src/client/fields-card-controller.ts'

describe('field specs', () => {
  it('reads and writes on/off values', () => {
    const spec = booleanField('enabled')
    expect(spec.format(true)).toBe('true')
    expect(spec.format(undefined)).toBe('')
    expect(spec.parse('false')).toEqual({ kind: 'set', value: false })
    expect(spec.parse('')).toEqual({ kind: 'clear' })
    expect(spec.parse('maybe')).toBeUndefined()
  })

  it('reads and writes number lists, with "off" as an empty list', () => {
    const spec = numberListField('thresholds')
    expect(spec.format([3, 5, 8])).toBe('3, 5, 8')
    expect(spec.format([])).toBe('off')
    expect(spec.parse('4, 7')).toEqual({ kind: 'set', value: [4, 7] })
    expect(spec.parse('4 7')).toEqual({ kind: 'set', value: [4, 7] })
    expect(spec.parse('OFF')).toEqual({ kind: 'set', value: [] })
    expect(spec.parse('')).toEqual({ kind: 'clear' })
    expect(spec.parse('4, x')).toBeUndefined()
    expect(spec.parse('2.5')).toBeUndefined()
  })

  it('keeps multi-line text as typed apart from surrounding blank lines', () => {
    const spec = multilineField('text')
    expect(spec.parse('\nline one\n  line two\n\n')).toEqual({ kind: 'set', value: 'line one\n  line two' })
    expect(spec.parse('  \n ')).toEqual({ kind: 'clear' })
  })
})

describe('FieldsCardController', () => {
  it('saves a list value and reports it as landed', async () => {
    const descriptor = FIELD_CARDS.find(card => card.namespace === 'repeat-tool-reminder')!
    const host = stubSettingsScope<Record<string, unknown>>()
    const controller = new FieldsCardController(descriptor, host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { thresholds: [3, 5, 8], failureThresholds: [4, 7] },
      base: { thresholds: [3, 5, 8], failureThresholds: [4, 7] },
      user: {},
    })
    host.set.mockImplementation((field: string, value: unknown) => {
      const snapshot = host.scope.getSnapshot()
      host.publish({
        value: { ...snapshot.value as object, [field]: value },
        user: { ...snapshot.user as object, [field]: value },
      })
    })
    const face = controller.inject()

    face.edit('failureThresholds', '3, 6')
    face.save()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(host.set).toHaveBeenCalledWith('failureThresholds', [3, 6])
    const state = face.hooks.fieldsCard.getSnapshot()
    expect(state.failed).toBe(false)
    expect(state.dirty).toBe(false)
    expect(state.fields.find(field => field.descriptor.field === 'failureThresholds')?.state.text).toBe('3, 6')
  })

  it('ships one card per namespace, each with at least one field', () => {
    const namespaces = FIELD_CARDS.map(card => card.namespace)
    expect(new Set(namespaces).size).toBe(namespaces.length)
    expect(FIELD_CARDS.every(card => card.fields.length > 0)).toBe(true)
  })
})

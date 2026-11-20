/** A descriptor-driven plugin card: one control per described field. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@fathom/client-ui-slots'
import { ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { FieldsCardFace } from './fields-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for a descriptor card. */
export type FieldsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<FieldsCardFace>

/**
 * Render a descriptor card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function FieldsCard(props: FieldsCardProps) {
  const { t } = props
  const state = props.useFieldsCard(snapshot => snapshot)
  const { descriptor } = state
  return (
    <PluginCard
      t={t}
      titleKey={descriptor.titleKey}
      descriptionKey={descriptor.descriptionKey}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {state.fields.map(({ descriptor: field, state: fieldState }) => {
        const id = `plugin-config-${descriptor.namespace}-${field.field}`
        const common = {
          id,
          label: t(field.labelKey),
          hint: t(field.hintKey),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t(field.kind === 'numberList' ? 'invalidNumberList' : 'invalidNumber'),
          disabled: !state.writable,
          ...fieldState,
          onEdit: (text: string) => { props.edit(field.field, text) },
          onReset: () => { props.resetField(field.field) },
        }
        return field.kind === 'boolean'
          ? <ToggleField key={field.field} {...common} />
          : (
            <ValueField
              key={field.field}
              {...common}
              numeric={field.kind === 'number'}
              multiline={field.kind === 'multiline'}
              {...field.options === undefined ? {} : { options: field.options }}
            />
          )
      })}
    </PluginCard>
  )
}

import { variantLabel, type AttributeKind, type AxisRemoval, type Command, type Id, type InventorySnapshot } from '@graymatter/core'
import { parseNameList } from './lists'

/** The unit of a number attribute is at most this many characters (the same limit as core's). */
export const MAX_UNIT_LENGTH = 16

export interface AttributeFormInput {
  name: string
  kind: AttributeKind
  /** One per line or comma-separated; list attributes only. */
  options: string
  unit: string
  siPrefixes: boolean
}

/** What the attribute form creates; the options, unit and prefixes only count for the kinds that use them. */
export function attributeCreateCommand(input: AttributeFormInput, ids: { id: Id; inventoryId: Id }): Command {
  const number = input.kind === 'number'
  return {
    type: 'attribute.create',
    id: ids.id,
    inventoryId: ids.inventoryId,
    name: input.name.trim(),
    kind: input.kind,
    options: input.kind === 'enum' ? parseNameList(input.options) : [],
    unit: number ? input.unit.trim() : '',
    siPrefixes: number ? input.siPrefixes : false,
  }
}

/** Why the form can't be sent yet, as an i18n key; null when it can. */
export function attributeFormError(input: AttributeFormInput): string | null {
  if (input.kind === 'enum' && parseNameList(input.options).length === 0) return 'attributeForm.optionsRequired'
  if (input.kind === 'number' && input.unit.trim().length > MAX_UNIT_LENGTH) return 'attributeForm.unitTooLong'
  return null
}

/** The heading of the variants section: `by Resistance · Voltage`; nothing without axes. */
export function axesSummary(axes: { name: string }[]): string | null {
  return axes.length === 0 ? null : axes.map((a) => a.name).join(' · ')
}

/** The axis ids after moving one axis a step up or down; the same order when it can't move. */
export function movedAxes(ids: Id[], id: Id, direction: 'up' | 'down'): Id[] {
  const from = ids.indexOf(id)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  next.splice(to, 0, next.splice(from, 1)[0]!)
  return next
}

export type AxisRemovalNotice =
  /** The axis can't go: an error text and, for equal variants, the labels that would collide (one line per group). */
  | { kind: 'blocked'; messageKey: string; groups: string[] }
  /** Values will be deleted: asks first, listing them. */
  | { kind: 'confirm'; values: { variantId: Id; label: string; value: string }[]; sharedValue: string | null }
  | { kind: 'none' }

/** What to show before an axis is made shared or removed, from core's preview. */
export function axisRemovalNotice(s: InventorySnapshot, preview: AxisRemoval): AxisRemovalNotice {
  if (preview.blocked !== null) {
    return {
      kind: 'blocked',
      messageKey: `errors.domain.${preview.blocked}`,
      groups: preview.blocked === 'duplicate_variant' ? preview.collisions.map((g) => g.map((v) => variantLabel(s, v)).join(', ')) : [],
    }
  }
  if (preview.removedValues.length === 0) return { kind: 'none' }
  const byId = new Map(s.variants.map((v) => [v.id, v]))
  return {
    kind: 'confirm',
    sharedValue: preview.sharedValue,
    values: preview.removedValues.map((r) => {
      const v = byId.get(r.variantId)
      return { variantId: r.variantId, label: v ? variantLabel(s, v) : '', value: r.value }
    }),
  }
}

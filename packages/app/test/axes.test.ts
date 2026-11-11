import { axisRemovalPreview } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { attributeCreateCommand, attributeFormError, axesSummary, axisRemovalNotice, movedAxes } from '../app/lib/axes'
import { axisSnapshot } from './fixtures/axis-snapshot'

const ids = { id: 'a1', inventoryId: 'inv' }
const form = { name: ' Resistance ', kind: 'number' as const, options: '', unit: ' Ω ', siPrefixes: true }

describe('attributeCreateCommand', () => {
  it('builds a number attribute with its unit and prefixes', () => {
    expect(attributeCreateCommand(form, ids)).toEqual({
      type: 'attribute.create', id: 'a1', inventoryId: 'inv', name: 'Resistance', kind: 'number', options: [], unit: 'Ω', siPrefixes: true,
    })
  })
  it('keeps options only for a list and unit only for a number', () => {
    expect(attributeCreateCommand({ ...form, kind: 'enum', options: 'DIP-8, SOIC-8' }, ids)).toMatchObject({ options: ['DIP-8', 'SOIC-8'], unit: '', siPrefixes: false })
    expect(attributeCreateCommand({ ...form, kind: 'text', options: 'x' }, ids)).toMatchObject({ options: [], unit: '', siPrefixes: false })
  })
  it('refuses an empty list and a long unit', () => {
    expect(attributeFormError({ ...form, kind: 'enum' })).toBe('attributeForm.optionsRequired')
    expect(attributeFormError({ ...form, unit: 'x'.repeat(17) })).toBe('attributeForm.unitTooLong')
    expect(attributeFormError(form)).toBeNull()
  })
})

describe('axes helpers', () => {
  it('summarizes the axes', () => {
    expect(axesSummary([{ name: 'Resistance' }, { name: 'Voltage' }])).toBe('Resistance · Voltage')
    expect(axesSummary([])).toBeNull()
  })
  it('moves an axis a step', () => {
    expect(movedAxes(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c'])
    expect(movedAxes(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b'])
    expect(movedAxes(['a', 'b'], 'a', 'up')).toEqual(['a', 'b'])
  })
})

describe('axisRemovalNotice', () => {
  it('blocks the last axis of an item with variants', () => {
    const s = axisSnapshot()
    expect(axisRemovalNotice(s, axisRemovalPreview(s, 'R', 'res'))).toEqual({ kind: 'blocked', messageKey: 'errors.domain.axis_required', groups: [] })
  })
  it('lists the variants that would become equal', () => {
    const s = axisSnapshot()
    const n = axisRemovalNotice(s, axisRemovalPreview(s, 'C', 'volt'))
    expect(n).toMatchObject({ kind: 'blocked', messageKey: 'errors.domain.duplicate_variant' })
    expect(n.kind === 'blocked' && n.groups).toHaveLength(1)
  })
  it('asks before deleting values', () => {
    const s = axisSnapshot()
    s.variantAttributeValues.find((x) => x.variantId === 'c16' && x.attributeId === 'cap')!.value = '0.000001'
    const n = axisRemovalNotice(s, axisRemovalPreview(s, 'C', 'volt'))
    expect(n.kind).toBe('confirm')
    expect(n.kind === 'confirm' && n.values.map((v) => v.value)).toEqual(['50'])
  })
  it('says nothing when no value is lost', () => {
    const s = axisSnapshot()
    s.variantAttributeValues = s.variantAttributeValues.filter((x) => x.attributeId !== 'volt' && x.variantId !== 'c16')
    expect(axisRemovalNotice(s, axisRemovalPreview(s, 'C', 'volt'))).toEqual({ kind: 'none' })
  })
})

import { axisRemovalPreview } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { attributeCreateCommand, attributeFormError, axesSummary, axisAddLoss, axisRemovalNotice, movedAxes, prefixExample, variantClash } from '../app/lib/axes'
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

describe('prefixExample', () => {
  // The owner, 2026-11-12: "4700 → 4700" said nothing. The line under the switch always shows what prefixes give.
  it('shows what SI prefixes make of 4k7, with the attribute\'s unit', () => {
    expect(prefixExample('Ω')).toBe('4k7 → 4.7 kΩ')
    expect(prefixExample(' V ')).toBe('4k7 → 4.7 kV')
  })
  it('without a unit: the bare prefix', () => {
    expect(prefixExample('')).toBe('4k7 → 4.7k')
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

describe('axisAddLoss', () => {
  it('names the formatted shared value an axis would drop', () => {
    const s = axisSnapshot()
    // Capacitor has axes and no shared value of its own: give it one, and remove its variants.
    s.attributes.find((a) => a.id === 'res')!.unit = 'Ω'
    s.itemAttributes.push({ itemId: 'C', attributeId: 'res', value: '4700', axisPosition: null })
    s.variants = s.variants.filter((v) => v.itemId !== 'C')
    expect(axisAddLoss(s, 'C', 'res')).toEqual({ name: 'Resistance', value: '4.7 kΩ' })
  })
  it('says nothing when variants take the value or the value becomes the first variant', () => {
    const s = axisSnapshot()
    s.itemAttributes.push({ itemId: 'C', attributeId: 'res', value: '4700', axisPosition: null })
    expect(axisAddLoss(s, 'C', 'res')).toBeNull()
    expect(axisAddLoss(s, 'R', 'pkg')).toBeNull()
    expect(axisAddLoss(s, 'M', 'pkg')).toBeNull()
  })
})

describe('variantClash', () => {
  it('finds an archived variant with the final values, with its archive', () => {
    expect(variantClash(axisSnapshot(), 'R', { res: '4700' }, 'r1k')).toEqual({ variantId: 'r4k7', archived: true, archiveId: 'arch' })
  })
  it('finds an active one, and ignores the variant itself', () => {
    const s = axisSnapshot()
    expect(variantClash(s, 'R', { res: '10000' }, 'r1k')).toMatchObject({ variantId: 'r10k', archived: false })
    expect(variantClash(s, 'R', { res: '10000' }, 'r10k')).toBeNull()
    expect(variantClash(s, 'C', { cap: '0.0000001', volt: null }, 'c50')).toMatchObject({ variantId: 'c16' })
  })
})

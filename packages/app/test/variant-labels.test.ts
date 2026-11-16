import { createSearch } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { archiveEntries } from '../app/lib/archive'
import { itemView, journalRows } from '../app/lib/item-view'
import { searchRows } from '../app/lib/views'
import { axisSnapshot, movement } from './fixtures/axis-snapshot'

describe('itemView with axes', () => {
  it('lists the axes in axis order and the shared attributes apart from them', () => {
    const s = axisSnapshot()
    const v = itemView(s, 'C')!
    expect(v.axes.map((a) => [a.attributeId, a.kind, a.unit, a.siPrefixes])).toEqual([
      ['cap', 'number', 'F', true],
      ['volt', 'number', 'V', true],
    ])
    expect(v.attributes).toEqual([])
    const r = itemView(s, 'R')!
    expect(r.axes.map((a) => a.attributeId)).toEqual(['res'])
    expect(r.attributes).toEqual([
      { attributeId: 'mark', name: 'Marking', kind: 'text', options: [], unit: '', siPrefixes: false, value: null, display: null },
      { attributeId: 'pkg', name: 'Package', kind: 'enum', options: ['0805', 'THT'], unit: '', siPrefixes: false, value: '0805', display: '0805' },
    ])
    expect(itemView(s, 'M')!.axes).toEqual([])
  })

  it('shows a shared number by the attribute rules', () => {
    const s = axisSnapshot()
    s.itemAttributes.push({ itemId: 'M', attributeId: 'res', value: '4700', axisPosition: null })
    expect(itemView(s, 'M')!.attributes[0]).toMatchObject({ value: '4700', display: '4.7 kΩ' })
  })

  it('sorts variants by their axis values, not by creation, and labels them', () => {
    const v = itemView(axisSnapshot(), 'R')!
    expect(v.buckets.map((b) => b.name)).toEqual(['1 kΩ', '10 kΩ'])
    expect(v.buckets[0]).toMatchObject({
      variantId: 'r1k',
      quantity: '2',
      values: [{ attributeId: 'res', name: 'Resistance', value: '1000', display: '1 kΩ' }],
      incomplete: false,
    })
    expect(v.hasVariants).toBe(true)
  })

  it('marks a variant with an empty axis as incomplete', () => {
    const v = itemView(axisSnapshot(), 'C')!
    const byId = Object.fromEntries(v.buckets.map((b) => [b.variantId, b]))
    expect(byId.c50).toMatchObject({ name: '100 nF · 50 V', incomplete: false })
    expect(byId.c16).toMatchObject({ name: '100 nF · —', incomplete: true })
    expect(byId.c16!.values[1]).toEqual({ attributeId: 'volt', name: 'Voltage', value: null, display: '—' })
  })

  it('keeps the no-variant bucket without values', () => {
    expect(itemView(axisSnapshot(), 'M')!.buckets).toMatchObject([{ variantId: null, name: null, values: [], incomplete: false }])
  })
})

describe('variant labels elsewhere', () => {
  it('names variants in the journal, archived ones too, and both sides of a transfer', () => {
    const s = axisSnapshot()
    const rows = journalRows(s, 'R', [
      movement('m1', 'r4k7', { kind: 'usage', quantity: '-1', seq: 4 }),
      movement('m2', 'r1k', { kind: 'transfer', quantity: '-1', transferId: 't', seq: 3 }),
      movement('m3', 'r10k', { kind: 'transfer', quantity: '1', transferId: 't', seq: 3 }),
    ])
    expect(rows[0]).toMatchObject({ variantName: '4.7 kΩ' })
    expect(rows[1]).toMatchObject({ transfer: { from: '1 kΩ', to: '10 kΩ' }, variantName: null })
  })

  it('names the variant in search rows (and so the palette)', () => {
    const s = axisSnapshot()
    const [row] = searchRows(s, [{ itemId: 'R', variantId: 'r10k' }])
    expect(row!.variantName).toBe('10 kΩ')
    expect(createSearch(s)).toBeTruthy()
  })

  it('names an archived variant in the archive', () => {
    const s = axisSnapshot()
    expect(archiveEntries(s)).toMatchObject([{ target: 'variant', id: 'r4k7', name: '4.7 kΩ', itemName: 'R' }])
  })
})

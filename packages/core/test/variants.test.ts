import { describe, expect, it } from 'vitest'
import type { InventorySnapshot, Variant } from '../src/model'
import {
  addAxisPreview,
  axisRemovalPreview,
  compareVariants,
  duplicateOf,
  formatAttributeValue,
  itemAxes,
  sameAxisValue,
  variantLabel,
} from '../src/variants'
import { ARCHIVED, attribute, axis, electronics, item, makeSnapshot, shared, value, variant } from './fixtures'

const v = (s: InventorySnapshot, id: string): Variant => s.variants.find((x) => x.id === id)!
const sorted = (s: InventorySnapshot, itemId: string) =>
  s.variants
    .filter((x) => x.itemId === itemId)
    .sort((a, b) => compareVariants(s, a, b))
    .map((x) => x.id)

/** Capacitor C rebuilt with these variants: [id, capacitance, voltage, over?]. */
function capacitors(rows: [string, string | null, string | null, Partial<Variant>?][]): InventorySnapshot {
  const s = electronics()
  const old = new Set(s.variants.filter((x) => x.itemId === 'C').map((x) => x.id))
  return {
    ...s,
    variants: [...s.variants.filter((x) => x.itemId !== 'C'), ...rows.map(([id, , , over]) => variant(id, 'C', over))],
    variantAttributeValues: [
      ...s.variantAttributeValues.filter((r) => !old.has(r.variantId)),
      ...rows.flatMap(([id, cap, volt]) => [value(id, 'cap', cap), value(id, 'volt', volt)]),
    ],
  }
}

describe('itemAxes', () => {
  it('lists the axes of an item by axis position, not shared attributes', () => {
    const s = electronics()
    expect(itemAxes(s, 'C').map((a) => a.id)).toEqual(['cap', 'volt'])
    expect(itemAxes(s, 'R').map((a) => a.id)).toEqual(['res'])
    expect(itemAxes(s, 'M')).toEqual([])
  })
})

describe('formatAttributeValue', () => {
  it('formats numbers by the attribute rules and leaves other kinds as they are', () => {
    expect(formatAttributeValue(attribute('r', 'R', 'number', { unit: 'Ω', siPrefixes: true }), '4700')).toBe('4.7 kΩ')
    expect(formatAttributeValue(attribute('r', 'R', 'number', { unit: 'Ω', siPrefixes: false }), '4700')).toBe('4700 Ω')
    expect(formatAttributeValue(attribute('t', 'T', 'text'), '4700')).toBe('4700')
    expect(formatAttributeValue(attribute('e', 'E', 'enum', { options: ['DIP'] }), 'DIP')).toBe('DIP')
  })
  it('shows a malformed stored number as it is instead of throwing', () => {
    expect(formatAttributeValue(attribute('r', 'R', 'number', { unit: 'Ω', siPrefixes: true }), '4.7k')).toBe('4.7k')
  })
})

describe('variantLabel', () => {
  it('joins the formatted axis values in axis order', () => {
    const s = electronics()
    expect(variantLabel(s, v(s, 'r4k7'))).toBe('4.7 kΩ')
    expect(variantLabel(s, v(s, 'c50'))).toBe('100 nF · 50 V')
  })
  it('shows an empty axis value as a dash', () => {
    const s = capacitors([['c1', '0.0000001', null]])
    expect(variantLabel(s, v(s, 'c1'))).toBe('100 nF · —')
    const missing = { ...s, variantAttributeValues: s.variantAttributeValues.filter((r) => !(r.variantId === 'c1' && r.attributeId === 'volt')) }
    expect(variantLabel(missing, v(s, 'c1'))).toBe('100 nF · —')
  })
})

describe('compareVariants', () => {
  it('orders number axes by value, not by text', () => {
    expect(sorted(electronics(), 'R')).toEqual(['r1k', 'r4k7', 'r10k'])
  })
  it('orders list axes by the order of the options', () => {
    expect(sorted(electronics(), 'L')).toEqual(['lred', 'lgreen', 'lblue'])
  })
  it('orders by the first axis, then the next', () => {
    const s = capacitors([
      ['c1', '0.00001', '16'],
      ['c2', '0.0000001', '50'],
      ['c3', '0.0000001', '16'],
    ])
    expect(sorted(s, 'C')).toEqual(['c3', 'c2', 'c1'])
  })
  it('puts empty values last', () => {
    const s = capacitors([
      ['c1', null, '16'],
      ['c2', '0.0000001', null],
      ['c3', '0.0000001', '50'],
      ['c4', '0.000001', '16'],
    ])
    expect(sorted(s, 'C')).toEqual(['c3', 'c2', 'c4', 'c1'])
  })
  it('orders text axes naturally', () => {
    const s = makeSnapshot({
      items: [item('B', 'Board')],
      attributes: [attribute('rev', 'Revision', 'text')],
      itemAttributes: [axis('B', 'rev', 0)],
      variants: [variant('b1', 'B'), variant('b2', 'B'), variant('b3', 'B')],
      variantAttributeValues: [value('b1', 'rev', 'rev 10'), value('b2', 'rev', 'Rev 2'), value('b3', 'rev', 'rev 1')],
    })
    expect(sorted(s, 'B')).toEqual(['b3', 'b2', 'b1'])
  })
  it('does not throw on values that do not fit the kind and puts them after the ones that do', () => {
    const r = electronics()
    const badNumber = { ...r, variantAttributeValues: r.variantAttributeValues.map((x) => (x.variantId === 'r1k' ? { ...x, value: '1k' } : x)) }
    expect(sorted(badNumber, 'R')).toEqual(['r4k7', 'r10k', 'r1k'])
    expect(variantLabel(badNumber, v(badNumber, 'r1k'))).toBe('1k')
    const dropped = { ...r, variantAttributeValues: r.variantAttributeValues.map((x) => (x.variantId === 'lred' ? { ...x, value: 'amber' } : x)) }
    expect(sorted(dropped, 'L')).toEqual(['lgreen', 'lblue', 'lred'])
  })
  it('orders variants with equal values by id, whatever the order of the rows (stale duplicates)', () => {
    const s = capacitors([
      ['c2', '0.0000001', '50'],
      ['c1', '0.0000001', '50'],
    ])
    expect(sorted(s, 'C')).toEqual(['c1', 'c2'])
    const reversed = { ...s, variants: [...s.variants].reverse() }
    expect(sorted(reversed, 'C')).toEqual(['c1', 'c2'])
    expect(variantLabel(s, v(s, 'c1'))).toBe(variantLabel(s, v(s, 'c2')))
  })
})

describe('sameAxisValue', () => {
  const text = attribute('t', 'T', 'text')
  const list = attribute('e', 'E', 'enum', { options: ['Red', 'red'] })
  const num = attribute('n', 'N', 'number', { unit: 'Ω', siPrefixes: true })
  it('compares text ignoring case and outer spaces', () => {
    expect(sameAxisValue(text, ' Red ', 'red')).toBe(true)
    expect(sameAxisValue(text, 'Red', 'Rot')).toBe(false)
  })
  it('compares list values exactly', () => {
    expect(sameAxisValue(list, 'Red', 'red')).toBe(false)
    expect(sameAxisValue(list, 'red', 'red')).toBe(true)
  })
  it('compares numbers by their canonical string', () => {
    expect(sameAxisValue(num, '4700', '4700')).toBe(true)
    expect(sameAxisValue(num, '4700', '470')).toBe(false)
  })
  it('treats empty as equal to empty only', () => {
    for (const a of [text, list, num]) {
      expect(sameAxisValue(a, null, null)).toBe(true)
      expect(sameAxisValue(a, null, 'red')).toBe(false)
      expect(sameAxisValue(a, '4700', null)).toBe(false)
    }
  })
})

describe('duplicateOf', () => {
  it('finds a variant with the same axis values, archived ones included', () => {
    const s = electronics()
    expect(duplicateOf(s, 'R', new Map([['res', '10000']]))?.id).toBe('r10k')
    expect(duplicateOf(s, 'R', new Map([['res', '4700']]))?.id).toBe('r4k7')
    expect(duplicateOf(s, 'R', new Map([['res', '2200']]))).toBeNull()
  })
  it('needs every axis to match; a missing value is empty', () => {
    const s = electronics()
    expect(duplicateOf(s, 'C', new Map([['cap', '0.0000001'], ['volt', '50']]))?.id).toBe('c50')
    expect(duplicateOf(s, 'C', new Map([['cap', '0.0000001']]))).toBeNull()
  })
  it('prefers the active variant over an archived one, then the lower id', () => {
    const e = electronics()
    const mk = (rows: [string, Partial<Variant>?][]): InventorySnapshot => ({
      ...e,
      variants: [...e.variants, ...rows.map(([id, o]) => variant(id, 'R', o))],
      variantAttributeValues: [...e.variantAttributeValues, ...rows.map(([id]) => value(id, 'res', '330'))],
    })
    expect(duplicateOf(mk([['a0', ARCHIVED], ['z9']]), 'R', new Map([['res', '330']]))?.id).toBe('z9')
    expect(duplicateOf(mk([['z9'], ['b1']]), 'R', new Map([['res', '330']]))?.id).toBe('b1')
    expect(duplicateOf(mk([['z9', ARCHIVED], ['b1', ARCHIVED]]), 'R', new Map([['res', '330']]))?.id).toBe('b1')
  })
  it('skips the variant being changed', () => {
    const s = electronics()
    expect(duplicateOf(s, 'R', new Map([['res', '10000']]), 'r10k')).toBeNull()
  })
})

describe('axisRemovalPreview', () => {
  it('blocks when the remaining axes no longer tell variants apart, and lists them', () => {
    const s = capacitors([
      ['c3', '0.000001', '16'],
      ['c50', '0.0000001', '50'],
      ['c16', '0.0000001', '16'],
    ])
    const r = axisRemovalPreview(s, 'C', 'volt')
    expect(r.blocked).toBe('duplicate_variant')
    expect(r.collisions.map((g) => g.map((x) => x.id))).toEqual([['c16', 'c50']])
  })
  it('offers the shared value when every variant has the same one, and lists the values it removes', () => {
    const s = capacitors([
      ['c1', '0.0000001', '50'],
      ['c2', '0.00001', '50'],
    ])
    const r = axisRemovalPreview(s, 'C', 'volt')
    expect(r.blocked).toBeNull()
    expect(r.collisions).toEqual([])
    expect(r.sharedValue).toBe('50')
    expect(r.removedValues).toEqual([
      { variantId: 'c1', value: '50' },
      { variantId: 'c2', value: '50' },
    ])
  })
  it('has no shared value when values differ or one is empty', () => {
    expect(axisRemovalPreview(electronics(), 'C', 'volt').sharedValue).toBeNull()
    const s = capacitors([
      ['c1', '0.0000001', '50'],
      ['c2', '0.00001', null],
    ])
    const r = axisRemovalPreview(s, 'C', 'volt')
    expect(r.sharedValue).toBeNull()
    expect(r.removedValues).toEqual([{ variantId: 'c1', value: '50' }])
  })
  it('counts archived variants', () => {
    const s = capacitors([
      ['c1', '0.0000001', '50'],
      ['c2', '0.0000001', '16', ARCHIVED],
    ])
    expect(axisRemovalPreview(s, 'C', 'volt').blocked).toBe('duplicate_variant')
  })
  it('stale duplicates on the other axes block removing an unrelated axis', () => {
    const e = electronics()
    const s: InventorySnapshot = {
      ...e,
      attributes: [...e.attributes, attribute('c', 'Extra', 'text')],
      itemAttributes: [...e.itemAttributes, axis('C', 'c', 2)],
      variants: [...e.variants, variant('d1', 'C'), variant('d2', 'C')],
      variantAttributeValues: [
        ...e.variantAttributeValues,
        ...['d1', 'd2'].flatMap((id) => [value(id, 'cap', '0.001'), value(id, 'volt', '5'), value(id, 'c', id)]),
      ],
    }
    const r = axisRemovalPreview(s, 'C', 'c')
    expect(r.blocked).toBe('duplicate_variant')
    expect(r.collisions.map((g) => g.map((x) => x.id))).toEqual([['d1', 'd2']])
  })
  it('refuses to remove the last axis of an item that has variants, archived ones included', () => {
    const s = electronics()
    const onlyArchived = { ...s, variants: s.variants.filter((x) => x.itemId !== 'R' || x.archivedAt !== null) }
    expect(axisRemovalPreview(onlyArchived, 'R', 'res').blocked).toBe('axis_required')
    const noVariants = { ...s, variants: s.variants.filter((x) => x.itemId !== 'R') }
    expect(axisRemovalPreview(noVariants, 'R', 'res')).toEqual({ blocked: null, collisions: [], sharedValue: null, removedValues: [] })
  })
})

describe('addAxisPreview', () => {
  const base = (over: Partial<InventorySnapshot>) =>
    makeSnapshot({
      items: [item('I', 'Item')],
      attributes: [attribute('a', 'A', 'text'), attribute('b', 'B', 'text')],
      ...over,
    })
  it('makes the first variant from a shared value when the item has no variants and no axis', () => {
    const s = base({ itemAttributes: [shared('I', 'a', 'x')] })
    expect(addAxisPreview(s, 'I', 'a')).toEqual({ createsVariant: true, dropsValue: null })
  })
  it('creates nothing and drops nothing without a shared value', () => {
    expect(addAxisPreview(base({ itemAttributes: [shared('I', 'a', null)] }), 'I', 'a')).toEqual({ createsVariant: false, dropsValue: null })
    expect(addAxisPreview(base({ itemAttributes: [shared('I', 'a', '  ')] }), 'I', 'a')).toEqual({ createsVariant: false, dropsValue: null })
    expect(addAxisPreview(base({}), 'I', 'a')).toEqual({ createsVariant: false, dropsValue: null })
  })
  it('copies the value to existing variants, so nothing is dropped', () => {
    const s = base({ itemAttributes: [axis('I', 'b', 0), shared('I', 'a', 'x')], variants: [variant('v', 'I')], variantAttributeValues: [value('v', 'b', 'y')] })
    expect(addAxisPreview(s, 'I', 'a')).toEqual({ createsVariant: false, dropsValue: null })
    const archived = base({ itemAttributes: [shared('I', 'a', 'x')], variants: [variant('v', 'I', ARCHIVED)] })
    expect(addAxisPreview(archived, 'I', 'a')).toEqual({ createsVariant: false, dropsValue: null })
  })
  it('drops the value when another axis exists and there are no variants', () => {
    const s = base({ itemAttributes: [axis('I', 'b', 0), shared('I', 'a', 'x')] })
    expect(addAxisPreview(s, 'I', 'a')).toEqual({ createsVariant: false, dropsValue: 'x' })
  })
  it('does nothing for an attribute that is already an axis', () => {
    const s = base({ itemAttributes: [axis('I', 'a', 0)] })
    expect(addAxisPreview(s, 'I', 'a')).toEqual({ createsVariant: false, dropsValue: null })
  })
})

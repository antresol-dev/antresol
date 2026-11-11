import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseNumberValue } from '../src/numbers'
import { createSearch } from '../src/search'
import { attribute, axis, item, makeSnapshot, shared, value, variant } from './fixtures'

// The real parser, counted: a separate file, since the mock replaces the module for every import in it.
vi.mock('../src/numbers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/numbers')>()
  return { ...actual, parseNumberValue: vi.fn(actual.parseNumberValue) }
})
const parse = vi.mocked(parseNumberValue)

/** 40 resistor variants on Resistance; 9 caps on Capacitance (other rules); a shared Tolerance with Resistance's rules. */
const ohm = { unit: 'Ω', siPrefixes: true }
const snap = makeSnapshot({
  items: [item('r', 'Resistor'), item('c', 'Capacitor')],
  attributes: [
    attribute('a-res', 'Resistance', 'number', ohm),
    attribute('a-tol', 'Tolerance', 'number', ohm),
    attribute('a-cap', 'Capacitance', 'number', { unit: 'F', siPrefixes: true }),
  ],
  variants: [
    ...Array.from({ length: 40 }, (_, n) => variant(`r${n}`, 'r', { position: n })),
    ...Array.from({ length: 9 }, (_, n) => variant(`c${n}`, 'c', { position: n })),
  ],
  itemAttributes: [axis('r', 'a-res', 0), shared('r', 'a-tol', '5'), axis('c', 'a-cap', 0)],
  variantAttributeValues: [
    ...Array.from({ length: 40 }, (_, n) => value(`r${n}`, 'a-res', String((n + 1) * 100))),
    ...Array.from({ length: 9 }, (_, n) => value(`c${n}`, 'a-cap', `0.00000000${n + 1}`)),
  ],
})

describe('number search', () => {
  beforeEach(() => {
    parse.mockClear()
  })

  it('reads each word once per set of number rules, not once per stored value', () => {
    const { search } = createSearch(snap)
    // Words: "zzz", "4k7", "qq" and the whole query: 4, by two sets of rules (Ω with prefixes, F with prefixes).
    expect(search('zzz 4k7 qq')).toEqual([])
    expect(parse).toHaveBeenCalledTimes(4 * 2)
  })

  it('still finds a value in any notation', () => {
    const { search } = createSearch(snap)
    expect(search('1k2')[0]).toEqual({ itemId: 'r', variantId: 'r11' })
    expect(search('3n')[0]).toEqual({ itemId: 'c', variantId: 'c2' })
    expect(search('5').map((h) => h.itemId)).toContain('r')
  })
})

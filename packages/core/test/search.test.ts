import { describe, expect, it } from 'vitest'
import { createSearch, nearestValues } from '../src/search'
import { attribute, axis, folder, item, makeSnapshot, shared, stockLine, value, variant } from './fixtures'
import type { InventorySnapshot, Tag, Variant } from '../src/model'

const audit = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'test', updatedBy: 'test' }
const tag = (id: string, name: string): Tag => ({ id, inventoryId: 'inv', name, ...audit })

/** Variants told apart by one text axis "Value", so the label is the value as written: [id, itemId, value, over?]. */
function labelled(rows: [string, string, string, Partial<Variant>?][]): Partial<InventorySnapshot> {
  return {
    attributes: [attribute('a-value', 'Value', 'text')],
    itemAttributes: [...new Set(rows.map((r) => r[1]))].map((itemId) => axis(itemId, 'a-value', 0)),
    variants: rows.map(([id, itemId, , over]) => variant(id, itemId, over)),
    variantAttributeValues: rows.map(([id, , v]) => value(id, 'a-value', v)),
  }
}
/** A resistor axis: 1000 is labelled "1 kΩ". */
const resistance = attribute('a-res', 'Resistance', 'number', { unit: 'Ω', siPrefixes: true })

const snap = makeSnapshot({
  items: [
    item('tl072', 'TL072'),
    item('lm13700', 'LM13700', null, { tagIds: ['t-opamp'] }),
    item('res', 'Резистор'),
    item('ne555', 'NE555'),
    item('as3340', 'AS3340', null, { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'a1' }),
  ],
  variants: [variant('v1k', 'res'), variant('v10k', 'res')],
  tags: [tag('t-opamp', 'opamp')],
  attributes: [attribute('a-case', 'Корпус', 'text'), resistance],
  itemAttributes: [shared('ne555', 'a-case', 'DIP-8'), axis('res', 'a-res', 0)],
  variantAttributeValues: [value('v1k', 'a-res', '1000'), value('v10k', 'a-res', '10000')],
})
const { search } = createSearch(snap)

describe('search', () => {
  it.each(['tl072', 'TL-072', 'tl07'])('finds TL072 first for %s', (q) => {
    expect(search(q)[0]?.itemId).toBe('tl072')
  })
  it('tolerates typos', () => {
    expect(search('lm13600').map((h) => h.itemId)).toContain('lm13700')
  })
  it('returns best variant, found by its label', () => {
    expect(search('10k')[0]).toEqual({ itemId: 'res', variantId: 'v10k' })
    expect(search('10 kΩ')[0]).toEqual({ itemId: 'res', variantId: 'v10k' })
    expect(search('1k')[0]).toEqual({ itemId: 'res', variantId: 'v1k' })
  })
  it('finds a resistor variant by item word plus value in any notation', () => {
    expect(search('резистор 10k')[0]).toEqual({ itemId: 'res', variantId: 'v10k' })
    expect(search('резистор 10000')[0]).toEqual({ itemId: 'res', variantId: 'v10k' })
  })
  it('searches tags and attributes', () => {
    expect(search('opamp').map((h) => h.itemId)).toContain('lm13700')
    expect(search('dip-8').map((h) => h.itemId)).toContain('ne555')
  })
  it('finds Cyrillic case-insensitively', () => {
    expect(search('резистор').map((h) => h.itemId)).toContain('res')
    expect(search('РЕЗИСТОР').map((h) => h.itemId)).toContain('res')
  })
  it('excludes archived and empty queries', () => {
    expect(search('as3340')).toEqual([])
    expect(search('   ')).toEqual([])
  })
  it('excludes items in archived folders and archived variants', () => {
    const s = makeSnapshot({
      folders: [folder('f1', 'F', null, { archivedAt: 'x', archiveId: 'a' }), folder('f2', 'G', 'f1')],
      items: [item('i1', 'Widget', 'f2'), item('i2', 'Gadget')],
      ...labelled([['v1', 'i2', 'Blue', { archivedAt: 'x', archiveId: 'a' }]]),
    })
    const r = createSearch(s)
    expect(r.search('widget')).toEqual([])
    expect(r.search('gadget').map((h) => h.itemId)).not.toContain('i1')
    expect(r.search('blue')).toEqual([])
    expect(r.search('gadget')).toEqual([{ itemId: 'i2', variantId: null }])
  })
  it('respects limit', () => {
    expect(search('tl072', 1)).toHaveLength(1)
  })
})

describe('ranking', () => {
  const s = makeSnapshot({
    items: ['TL072', 'TL074', 'TL071', 'TL082', 'TL072CP', 'TLC272', 'LM13700', 'LM386', 'Резистор'].map((n) => item(n, n)),
    // A text axis: matching "10k" against the number 10000 is numeric search, not ranking.
    ...labelled([['v1k', 'Резистор', '1k'], ['v10k', 'Резистор', '10k']]),
  })
  const r = createSearch(s)
  it.each(['tl072', 'TL-072'])('exact then prefix then fuzzy for %s', (q) => {
    const ids = r.search(q).map((h) => h.itemId)
    expect(ids.slice(0, 2)).toEqual(['TL072', 'TL072CP'])
    expect(ids.slice(2).sort()).toEqual(['TL071', 'TL074', 'TL082', 'TLC272'].filter((x) => ids.includes(x)).sort())
  })
  it('without fuzzy keeps exact and prefix hits only', () => {
    expect(r.search('tl072', 50, { fuzzy: false }).map((h) => h.itemId)).toEqual(['TL072', 'TL072CP'])
    expect(r.search('lm13600', 50, { fuzzy: false })).toEqual([])
  })
  it("combineWith 'AND' needs every token of the query in the document", () => {
    expect(r.search('tl072 cp', 50, { fuzzy: false }).map((h) => h.itemId)).toEqual(expect.arrayContaining(['TL072', 'TL072CP']))
    expect(r.search('tl072 lm13700', 50, { fuzzy: false, combineWith: 'AND' })).toEqual([])
    expect(r.search('tl072 lm13700', 50, { fuzzy: false }).length).toBeGreaterThan(0)
  })
  it('keeps one-edit typos but not two-edit neighbours', () => {
    expect(r.search('lm13600').map((h) => h.itemId)).toContain('LM13700')
    expect(r.search('lm358').map((h) => h.itemId)).not.toContain('LM386')
  })
  it('reports the matched variant when the item also matches', () => {
    expect(r.search('резистор 10k')[0]).toEqual({ itemId: 'Резистор', variantId: 'v10k' })
  })
  it('orders ties the same whatever the order of the rows', () => {
    // A fresh load holds rows in SQL order; a patched snapshot holds the rows a write returned at the end.
    const twins = makeSnapshot({
      items: [item('b', 'Resistor'), item('a', 'resistor'), item('c', 'Resistor')],
      ...labelled([['v2', 'b', '1k'], ['v1', 'b', '1k'], ['v3', 'c', '1k', { position: 1 }]]),
    })
    const reversed = {
      ...twins,
      items: [...twins.items].reverse(),
      variants: [...twins.variants].reverse(),
      variantAttributeValues: [...twins.variantAttributeValues].reverse(),
    }
    for (const q of ['resistor', '1k']) expect(createSearch(reversed).search(q)).toEqual(createSearch(twins).search(q))
  })
})

describe('decimal values', () => {
  const { search: s } = createSearch(
    makeSnapshot({
      items: [item('r47', 'Resistor'), item('r4.7', 'Resistor'), item('r4k7', 'Resistor'), item('cap', 'Cap')],
      ...labelled([['v47k', 'r47', '47k'], ['v4.7k', 'r4.7', '4.7k'], ['v4k7', 'r4k7', '4k7'], ['v4n7', 'cap', '4n7']]),
    }),
  )
  const hits = (q: string) => s(q).map((h) => h.itemId)
  it('4.7k ranks the 4.7k variant first and never returns 47k', () => {
    expect(s('4.7k')[0]).toEqual({ itemId: 'r4.7', variantId: 'v4.7k' })
    expect(hits('4.7k')).not.toContain('r47')
  })
  it('4,7k behaves like 4.7k', () => {
    expect(s('4,7k')).toEqual(s('4.7k'))
  })
  it('47k finds 47k, not 4.7k', () => {
    expect(s('47k')[0]).toEqual({ itemId: 'r47', variantId: 'v47k' })
    expect(hits('47k')).not.toContain('r4.7')
  })
  it('4.7k does not return the 4n7 cap; 4k7 stays its own token', () => {
    expect(hits('4.7k')).not.toContain('cap')
    expect(s('4k7')[0]).toEqual({ itemId: 'r4k7', variantId: 'v4k7' })
    expect(hits('4k7')).not.toContain('r4.7')
  })
  it('other punctuation is still ignored', () => {
    for (const q of ['tl-072', 'TL072', 'tl 072']) expect(search(q)[0]?.itemId).toBe('tl072')
  })
  it('"Res 4. 7" is not a 4.7 value', () => {
    const { search: q } = createSearch(
      makeSnapshot({ items: [item('bad', 'Res 4. 7'), item('good', 'Res'), item('g2', 'Other')], ...labelled([['vg', 'good', '4.7']]) }),
    )
    expect(q('4.7').map((h) => h.itemId)).toEqual(['good'])
  })
  it.each([
    ['4,7k', '4.7k'],
    ['3,3V', '3.3v'],
    ['v1.2.3', '1.2.3'],
    ['set 5. 10 pcs', '5.10'],
  ])('indexed "%s" is found by "%s" only where intended', (data, query) => {
    const { search: q } = createSearch(makeSnapshot({ items: [item('x', data)] }))
    const found = q(query).map((h) => h.itemId)
    if (data === 'set 5. 10 pcs') expect(found).toEqual([])
    else expect(found).toEqual(['x'])
  })
  it('odd inputs do not throw and a 4. prefix lists 4.7k', () => {
    expect(() => s('.5')).not.toThrow()
    expect(() => s('1.')).not.toThrow()
    expect(hits('4.')).toContain('r4.7')
  })
})

describe('number search', () => {
  const rules = { unit: 'Ω', siPrefixes: true }
  const s = makeSnapshot({
    items: [item('r', 'Resistor'), item('l', 'Length'), item('n', 'Counter')],
    variants: [variant('v47', 'r'), variant('v1', 'r', { position: 1 })],
    attributes: [
      attribute('a-res', 'Resistance', 'number', rules),
      attribute('a-len', 'Length', 'number', { unit: 'm', siPrefixes: false }),
      attribute('a-cnt', 'Count', 'number', { unit: '', siPrefixes: false }),
    ],
    itemAttributes: [axis('r', 'a-res', 0), shared('l', 'a-len', '5'), shared('n', 'a-cnt', '4700')],
    variantAttributeValues: [value('v47', 'a-res', '4700'), value('v1', 'a-res', '1000')],
  })
  const { search } = createSearch(s)
  it.each(['4k7', '4.7k', '4,7k', '4.7 kΩ'])('%s finds the 4.7 kΩ variant', (q) => {
    expect(search(q)[0]).toEqual({ itemId: 'r', variantId: 'v47' })
  })
  it('4700 finds the variant and the item holding a plain 4700', () => {
    const hits = search('4700')
    expect(hits).toContainEqual({ itemId: 'r', variantId: 'v47' })
    expect(hits.map((h) => h.itemId)).toContain('n')
  })
  it('a prefix is read by the attribute: 5m is 5 m for a length, not 5 mΩ for a resistance', () => {
    // Length has no prefixes: "5m" parses as 5 with unit m -> equal to 5.
    expect(search('5m')[0]).toEqual({ itemId: 'l', variantId: null })
    // Resistance would read it as 5 mΩ = 0.005; no such value, so the resistor is not a hit.
    expect(search('5m').map((h) => h.itemId)).not.toContain('r')
  })
  it('a malformed stored number does not break the search', () => {
    const bad = makeSnapshot({
      items: [item('r', 'Resistor')],
      variants: [variant('vb', 'r')],
      attributes: [attribute('a-res', 'Resistance', 'number', rules)],
      itemAttributes: [axis('r', 'a-res', 0)],
      variantAttributeValues: [value('vb', 'a-res', '4.7k')],
    })
    expect(() => createSearch(bad).search('4k7')).not.toThrow()
  })
  it('without prefixes 4k7 finds nothing in that attribute', () => {
    expect(search('4k7').map((h) => h.itemId)).not.toContain('n')
    expect(search('4k7').map((h) => h.itemId)).not.toContain('l')
  })
  it('a plain number finds a shared value', () => {
    expect(search('4700').map((h) => h.itemId)).toContain('n')
  })
  it('text matching still works', () => {
    expect(search('resistor')[0]?.itemId).toBe('r')
  })
})

describe('nearestValues', () => {
  const res = attribute('a-res', 'Resistance', 'number', { unit: 'Ω', siPrefixes: true })
  const snap = makeSnapshot({
    folders: [folder('old', 'Old', null, { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'f' })],
    items: [
      item('r', 'Resistor'),
      item('s', 'Fixed 4.9k'),
      item('gone', 'Archived', null, { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'a' }),
      item('hid', 'In archived folder', 'old'),
    ],
    attributes: [res],
    variants: [
      variant('r43', 'r'),
      variant('r47', 'r'),
      variant('r51', 'r'),
      variant('r10', 'r'),
      variant('rx', 'r', { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'v' }),
      variant('g1', 'gone'),
      variant('h1', 'hid'),
    ],
    itemAttributes: [axis('r', 'a-res', 0), shared('s', 'a-res', '4900'), axis('gone', 'a-res', 0), axis('hid', 'a-res', 0)],
    variantAttributeValues: [
      value('r43', 'a-res', '4300'),
      value('r47', 'a-res', '4700'),
      value('r51', 'a-res', '5100'),
      value('r10', 'a-res', '100'),
      value('rx', 'a-res', '4650'),
      value('g1', 'a-res', '4690'),
      value('h1', 'a-res', '4710'),
    ],
    stock: [stockLine('r', 'r43', '12'), stockLine('r', 'r51', '40'), stockLine('s', null, '7')],
  })

  it('finds the nearest smaller and larger values, skipping equal, archived and hidden ones', () => {
    expect(nearestValues(snap, res, '4700')).toEqual({
      below: { itemId: 'r', variantId: 'r43', value: '4300', quantity: '12' },
      above: { itemId: 's', variantId: null, value: '4900', quantity: '7' },
    })
  })

  it('has null on a side with no value', () => {
    expect(nearestValues(snap, res, '50').below).toBeNull()
    expect(nearestValues(snap, res, '50').above?.value).toBe('100')
    expect(nearestValues(snap, res, '9000').above).toBeNull()
    expect(nearestValues(snap, res, '5100').above).toBeNull()
  })

  it('compares decimals and ignores other attributes', () => {
    expect(nearestValues(snap, attribute('other', 'Other', 'number'), '1')).toEqual({ below: null, above: null })
    expect(nearestValues(snap, res, '4300.5').below?.value).toBe('4300')
  })

  it('prefers the holder with more stock when values tie', () => {
    const tie = makeSnapshot({
      items: [item('a', 'A'), item('b', 'B')],
      attributes: [res],
      itemAttributes: [shared('a', 'a-res', '100'), shared('b', 'a-res', '100')],
      stock: [stockLine('a', null, '1'), stockLine('b', null, '5')],
    })
    expect(nearestValues(tie, res, '200').below?.itemId).toBe('b')
  })
})

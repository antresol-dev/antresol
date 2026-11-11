import { describe, expect, it } from 'vitest'
import { createSearch } from '../src/search'
import { attribute, axis, folder, item, makeSnapshot, shared, value, variant } from './fixtures'
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

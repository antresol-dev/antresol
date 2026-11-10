import { describe, expect, it } from 'vitest'
import { createSearch } from '../src/search'
import { folder, item, makeSnapshot, variant } from './fixtures'
import type { Tag } from '../src/model'

const audit = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'test', updatedBy: 'test' }
const tag = (id: string, name: string): Tag => ({ id, inventoryId: 'inv', name, ...audit })

const snap = makeSnapshot({
  items: [
    item('tl072', 'TL072'),
    item('lm13700', 'LM13700', null, { tagIds: ['t-opamp'] }),
    item('res', 'Резистор'),
    item('ne555', 'NE555'),
    item('as3340', 'AS3340', null, { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'a1' }),
  ],
  variants: [variant('v1k', 'res', '1k'), variant('v10k', 'res', '10k')],
  tags: [tag('t-opamp', 'opamp')],
  attributes: [
    { id: 'a-case', inventoryId: 'inv', name: 'Корпус', kind: 'text', options: [], ...audit },
  ],
  itemAttributes: [{ itemId: 'ne555', attributeId: 'a-case', value: 'DIP-8' }],
})
const { search } = createSearch(snap)

describe('search', () => {
  it.each(['tl072', 'TL-072', 'tl07'])('finds TL072 first for %s', (q) => {
    expect(search(q)[0]?.itemId).toBe('tl072')
  })
  it('tolerates typos', () => {
    expect(search('lm13600').map((h) => h.itemId)).toContain('lm13700')
  })
  it('returns best variant', () => {
    expect(search('10k')[0]).toEqual({ itemId: 'res', variantId: 'v10k' })
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
      variants: [variant('v1', 'i2', 'Blue', { archivedAt: 'x', archiveId: 'a' })],
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
    variants: [variant('v1k', 'Резистор', '1k'), variant('v10k', 'Резистор', '10k')],
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
})

describe('decimal values', () => {
  const { search: s } = createSearch(
    makeSnapshot({
      items: [item('r47', 'Resistor'), item('r4.7', 'Resistor'), item('r4k7', 'Resistor'), item('cap', 'Cap')],
      variants: [variant('v47k', 'r47', '47k'), variant('v4.7k', 'r4.7', '4.7k'), variant('v4k7', 'r4k7', '4k7'), variant('v4n7', 'cap', '4n7')],
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
  it('other punctuation is still ignored', () => {
    for (const q of ['tl-072', 'TL072', 'tl 072']) expect(search(q)[0]?.itemId).toBe('tl072')
  })
})

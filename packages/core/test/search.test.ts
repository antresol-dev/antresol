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
      items: [item('i1', 'Sprocket', 'f2'), item('i2', 'Gadget')],
      variants: [variant('v1', 'i2', 'Blue', { archivedAt: 'x', archiveId: 'a' })],
    })
    const r = createSearch(s)
    expect(r.search('sprocket')).toEqual([])
    expect(r.search('blue')).toEqual([])
    expect(r.search('gadget')).toEqual([{ itemId: 'i2', variantId: null }])
  })
  it('respects limit', () => {
    expect(search('tl072', 1)).toHaveLength(1)
  })
})

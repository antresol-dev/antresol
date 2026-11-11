import { describe, expect, it } from 'vitest'
import type { Photo, Tag } from '../src/model'
import { patchSnapshot, type SnapshotPatch } from '../src/patch'
import { item, makeSnapshot, stockLine, variant } from './fixtures'

function photo(id: string, itemId: string): Photo {
  return { id, itemId, variantId: null, provider: 'p', fileId: id, url: 'u', position: 0, createdAt: 't', createdBy: 'test' }
}
function emptyPatch(over: Partial<SnapshotPatch> = {}): SnapshotPatch {
  return {
    inventoryId: 'inv',
    itemIds: [],
    items: [],
    variants: [],
    itemAttributes: [],
    variantAttributeValues: [],
    photos: [],
    stock: [],
    ...over,
  }
}
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze)
    Object.freeze(o)
  }
  return o
}
function base() {
  return makeSnapshot({
    items: [item('a', 'A'), item('b', 'B')],
    variants: [variant('a1', 'a', 'A1'), variant('b1', 'b', 'B1')],
    itemAttributes: [
      { itemId: 'a', attributeId: 'x', value: '1' },
      { itemId: 'b', attributeId: 'x', value: '2' },
    ],
    variantAttributeValues: [
      { variantId: 'a1', attributeId: 'y', value: 'old' },
      { variantId: 'b1', attributeId: 'y', value: 'keep' },
    ],
    photos: [photo('pa', 'a'), photo('pb', 'b')],
    stock: [stockLine('a', 'a1', '1'), stockLine('b', 'b1', '2')],
  })
}

describe('patchSnapshot', () => {
  it('replaces the slice of a touched item and keeps other items as they were', () => {
    const s = base()
    const a2 = item('a', 'A renamed')
    const out = patchSnapshot(
      s,
      emptyPatch({
        itemIds: ['a'],
        items: [a2],
        variants: [variant('a2', 'a', 'A2')],
        itemAttributes: [{ itemId: 'a', attributeId: 'x', value: '9' }],
        variantAttributeValues: [{ variantId: 'a2', attributeId: 'y', value: 'new' }],
        photos: [photo('pa2', 'a')],
        stock: [stockLine('a', 'a2', '5')],
      }),
    )
    expect(out.items.map((i) => i.name).sort()).toEqual(['A renamed', 'B'])
    expect(out.items.find((i) => i.id === 'b')).toBe(s.items[1])
    expect(out.variants.map((v) => v.id).sort()).toEqual(['a2', 'b1'])
    expect(out.variants.find((v) => v.id === 'b1')).toBe(s.variants[1])
    expect(out.itemAttributes).toContain(s.itemAttributes[1])
    expect(out.itemAttributes.find((r) => r.itemId === 'a')?.value).toBe('9')
    expect(out.variantAttributeValues).toEqual([s.variantAttributeValues[1], { variantId: 'a2', attributeId: 'y', value: 'new' }])
    expect(out.photos.map((p) => p.id).sort()).toEqual(['pa2', 'pb'])
    expect(out.photos.find((p) => p.id === 'pb')).toBe(s.photos[1])
    expect(out.stock.map((l) => l.variantId).sort()).toEqual(['a2', 'b1'])
    expect(out.stock.find((l) => l.itemId === 'b')).toBe(s.stock[1])
  })

  it('removes an item listed in itemIds but absent from items, with its variants, values, photos and stock', () => {
    const s = base()
    const out = patchSnapshot(s, emptyPatch({ itemIds: ['a'] }))
    expect(out.items.map((i) => i.id)).toEqual(['b'])
    expect(out.variants.map((v) => v.id)).toEqual(['b1'])
    expect(out.itemAttributes.map((r) => r.itemId)).toEqual(['b'])
    expect(out.variantAttributeValues.map((r) => r.variantId)).toEqual(['b1'])
    expect(out.photos.map((p) => p.id)).toEqual(['pb'])
    expect(out.stock.map((l) => l.itemId)).toEqual(['b'])
  })

  it('drops attribute values of a variant the item no longer has', () => {
    const s = base()
    const out = patchSnapshot(s, emptyPatch({ itemIds: ['a'], items: [item('a', 'A')], variants: [variant('a2', 'a', 'A2')] }))
    expect(out.variantAttributeValues.map((r) => r.variantId)).toEqual(['b1'])
  })

  it('replaces a small table only when the patch carries it', () => {
    const s = base()
    const tag: Tag = { id: 't', inventoryId: 'inv', name: 'T', createdAt: 't', updatedAt: 't', createdBy: 'u', updatedBy: 'u' }
    const same = patchSnapshot(s, emptyPatch())
    expect(same.tags).toBe(s.tags)
    expect(same.folders).toBe(s.folders)
    expect(same.inventory).toBe(s.inventory)
    const out = patchSnapshot(s, emptyPatch({ tags: [tag], inventory: { ...s.inventory, name: 'New' } }))
    expect(out.tags).toEqual([tag])
    expect(out.inventory.name).toBe('New')
    expect(out.folders).toBe(s.folders)
    expect(out.attributes).toBe(s.attributes)
    expect(out.units).toBe(s.units)
  })

  it('returns a new object and leaves the input untouched', () => {
    const s = deepFreeze(structuredClone(base()))
    const before = structuredClone(s)
    const out = patchSnapshot(s, emptyPatch({ itemIds: ['a'], items: [item('a', 'Z')] }))
    expect(out).not.toBe(s)
    expect(s).toEqual(before)
  })

  it("throws for another inventory's patch", () => {
    expect(() => patchSnapshot(base(), emptyPatch({ inventoryId: 'other' }))).toThrow()
  })
})

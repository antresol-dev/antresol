import { newId, patchSnapshot, type Command, type Id } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { itemCreate, makeStorage, sizeAxis, sliceOf, TEST_ACTOR, variantsCreate } from './helpers'

describe('photos', () => {
  it('adds at the end, reorders and removes', async () => {
    const storage = await makeStorage()
    const inv = newId()
    const item = newId()
    await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    await storage.apply(
      { type: 'item.create', id: item, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
      TEST_ACTOR,
    )
    const [p1, p2, p3] = [newId(), newId(), newId()]
    for (const id of [p1, p2, p3]) {
      await storage.apply({ type: 'photo.add', id, itemId: item, variantId: null, provider: 'imgbb', fileId: id, url: `https://x/${id}` }, TEST_ACTOR)
    }
    const positions = async () => (await storage.loadInventory(inv)).photos.map((p) => [p.id, p.position])
    expect(await positions()).toEqual([[p1, 0], [p2, 1], [p3, 2]])
    await storage.apply({ type: 'photo.reorder', itemId: item, orderedIds: [p3, p1, p2] }, TEST_ACTOR)
    expect(await positions()).toEqual([[p3, 0], [p1, 1], [p2, 2]])
    await storage.apply({ type: 'photo.remove', id: p1 }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).photos).toHaveLength(2)
  })
})

describe('photo.replace', () => {
  /** An item with two variants; photos: p1 the item's, p2 variant a's, p3 the item's, in that order. */
  async function setup() {
    const storage = await makeStorage()
    const run = (c: Command) => storage.apply(c, TEST_ACTOR)
    const [inv, item, size, a, b] = [newId(), newId(), newId(), newId(), newId()]
    const [p1, p2, p3] = [newId(), newId(), newId()]
    await run({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' })
    await run(itemCreate(inv, item))
    for (const c of sizeAxis(inv, item, size)) await run(c)
    await run(variantsCreate(item, [[a, { [size]: 'S' }], [b, { [size]: 'M' }]]))
    const add = (id: Id, variantId: Id | null): Command => ({
      type: 'photo.add', id, itemId: item, variantId, provider: 'imgbb', fileId: id, url: `https://x/${id}`,
    })
    for (const [id, variantId] of [[p1, null], [p2, a], [p3, null]] as const) await run(add(id, variantId))
    const replace = (variantId: Id, id: Id, replaces: Id | null, itemId: Id = item): Command => ({
      type: 'photo.replace', variantId, id, itemId, replaces, provider: 'uploadcare', fileId: `f-${id}`, url: `https://y/${id}`,
    })
    const photos = async () =>
      (await storage.loadInventory(inv)).photos
        .sort((x, y) => x.position - y.position)
        .map((p) => [p.id, p.variantId, p.position])
    return { storage, run, inv, item, a, b, p1, p2, p3, replace, photos }
  }

  it('puts the new photo in place of the variant’s old one in one write', async () => {
    const { storage, run, inv, item, a, p1, p2, p3, replace, photos } = await setup()
    const p4 = newId()
    const copy = await storage.loadInventory(inv)
    const before = (await storage.listInventories()).rev
    const r = await run(replace(a, p4, p2))
    expect(r.prevRev).toBe(before)
    expect(r.rev).toBe((await storage.listInventories()).rev)
    expect(await photos()).toEqual([[p1, null, 0], [p4, a, 1], [p3, null, 2]])
    const fresh = await storage.loadInventory(inv)
    expect(fresh.photos.find((p) => p.id === p4)).toMatchObject({ itemId: item, provider: 'uploadcare', fileId: `f-${p4}`, url: `https://y/${p4}`, createdBy: TEST_ACTOR.device })
    expect(fresh.photos.map((p) => p.id)).not.toContain(p2)
    expect(sliceOf(patchSnapshot(copy, r.patch!), item)).toEqual(sliceOf(fresh, item))
  })

  it('adds the photo at the end for a variant that has none', async () => {
    const { run, b, p1, p2, p3, replace, photos } = await setup()
    const p4 = newId()
    await run(replace(b, p4, null))
    expect(await photos()).toEqual([[p1, null, 0], [p2, expect.any(String), 1], [p3, null, 2], [p4, b, 3]])
  })

  it('touches nothing for a variant that is not the item’s in the database', async () => {
    const { run, inv, a, p2, replace, photos } = await setup()
    const before = await photos()
    const other = newId()
    await run(itemCreate(inv, other, 'Fuse'))
    // Sent unvalidated, as from a copy that is behind.
    await run(replace(a, newId(), p2, other))
    expect(await photos()).toEqual(before)
  })

  it('a late replay keeps the newer photo: only the photo the command names is replaced', async () => {
    const { storage, run, inv, item, a, p1, p2, p3, replace, photos } = await setup()
    const [p4, p5] = [newId(), newId()]
    const first = replace(a, p4, p2)
    await run(first)
    await run(replace(a, p5, p4))
    const settled = await photos()
    expect(settled).toEqual([[p1, null, 0], [p5, a, 1], [p3, null, 2]])
    // The first write again, long after (a retry whose answer was lost): p2 is gone, so p5 stays and p4 does not return.
    const copy = await storage.loadInventory(inv)
    const r = await run(first)
    expect(await photos()).toEqual(settled)
    expect(sliceOf(patchSnapshot(copy, r.patch!), item)).toEqual(sliceOf(await storage.loadInventory(inv), item))
  })

  it('touches nothing when the variant’s photo is not the one named, or it has one and none is named', async () => {
    const { run, a, b, p2, replace, photos } = await setup()
    const before = await photos()
    // Sent unvalidated, as from a copy that is behind.
    await run(replace(a, newId(), newId()))
    await run(replace(a, newId(), null))
    // b has no photo: a photo named for it is not there.
    await run(replace(b, newId(), p2))
    expect(await photos()).toEqual(before)
  })
})

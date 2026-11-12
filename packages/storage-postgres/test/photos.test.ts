import { newId, patchSnapshot, type Command, type Id, type Photo } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { toStatements } from '../src/commands'
import { sql } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import * as schema4 from './fixtures/schema4-photo-writes'
import {
  itemCreate,
  makeExecutor,
  makeStorage,
  RENDITION_FIELDS,
  sizeAxis,
  sliceOf,
  TEST_ACTOR,
  variantsCreate,
} from './helpers'

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

describe('photo renditions, size and delete handle (schema 5)', () => {
  /** An item with one variant, `a`, and no photo. */
  async function setup() {
    const exec = await makeExecutor()
    const { storage } = await openPostgresStorage(exec)
    const run = (c: Command) => storage.apply(c, TEST_ACTOR)
    const [inv, item, size, a] = [newId(), newId(), newId(), newId()]
    await run({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' })
    await run(itemCreate(inv, item))
    for (const c of sizeAxis(inv, item, size)) await run(c)
    await run(variantsCreate(item, [[a, { [size]: 'S' }]]))
    const photo = async (id: Id) => (await storage.loadInventory(inv)).photos.find((p) => p.id === id)
    return { exec, storage, run, inv, item, a, photo }
  }
  const fields = (p: Photo | undefined) => p && { urls: p.urls, width: p.width, height: p.height, deleteHandle: p.deleteHandle }
  const NONE = { urls: null, width: null, height: null, deleteHandle: null }

  it('photo.add stores them; a load and the write’s own reads give them back, the renditions as a list of objects', async () => {
    const { storage, run, inv, item, photo } = await setup()
    const id = newId()
    const copy = await storage.loadInventory(inv)
    const r = await run({
      type: 'photo.add', id, itemId: item, variantId: null, provider: 'imgbb', fileId: 'abc', url: 'https://i.ibb.co/abc/full.jpg',
      ...RENDITION_FIELDS,
    })
    const stored = await photo(id)
    expect(fields(stored)).toEqual(RENDITION_FIELDS)
    expect(Array.isArray(stored!.urls)).toBe(true)
    expect(typeof stored!.urls![0]).toBe('object')
    expect(sliceOf(patchSnapshot(copy, r.patch!), item)).toEqual(sliceOf(await storage.loadInventory(inv), item))
  })

  it('photo.replace stores them on the new photo', async () => {
    const { storage, run, inv, item, a, photo } = await setup()
    const [old, id] = [newId(), newId()]
    await run({ type: 'photo.add', id: old, itemId: item, variantId: a, provider: 'uploadcare', fileId: 'u1', url: 'https://u.example/u1' })
    const copy = await storage.loadInventory(inv)
    const r = await run({
      type: 'photo.replace', variantId: a, id, itemId: item, replaces: old, provider: 'imgbb', fileId: 'abc',
      url: 'https://i.ibb.co/abc/full.jpg', ...RENDITION_FIELDS,
    })
    expect(await photo(old)).toBeUndefined()
    expect(fields(await photo(id))).toEqual(RENDITION_FIELDS)
    expect(sliceOf(patchSnapshot(copy, r.patch!), item)).toEqual(sliceOf(await storage.loadInventory(inv), item))
  })

  it('a command without them (older app, older queue) reads null in all four and writes schema 4’s statement', async () => {
    const { run, item, a, photo } = await setup()
    const add: Extract<Command, { type: 'photo.add' }> = {
      type: 'photo.add', id: newId(), itemId: item, variantId: null, provider: 'uploadcare', fileId: 'u1', url: 'https://u.example/u1',
    }
    const replace: Extract<Command, { type: 'photo.replace' }> = {
      type: 'photo.replace', variantId: a, id: newId(), itemId: item, replaces: null, provider: 'uploadcare', fileId: 'u2',
      url: 'https://u.example/u2',
    }
    expect(toStatements(add, TEST_ACTOR)).toEqual([schema4.photoAdd(add, TEST_ACTOR)])
    expect(toStatements(replace, TEST_ACTOR)).toEqual([schema4.photoReplace(replace, TEST_ACTOR)])
    // Null fields are the same as absent ones.
    const nulls = { ...add, id: newId(), ...NONE }
    expect(toStatements(nulls, TEST_ACTOR)).toEqual([schema4.photoAdd(nulls, TEST_ACTOR)])
    for (const c of [add, replace, nulls]) await run(c)
    for (const c of [add, replace, nulls]) expect(fields(await photo(c.id))).toEqual(NONE)
  })

  it('reads urls that are not a list (a hand-edited row) as none', async () => {
    const { exec, run, item, photo } = await setup()
    const [x, y] = [newId(), newId()]
    for (const id of [x, y]) {
      await run({ type: 'photo.add', id, itemId: item, variantId: null, provider: 'imgbb', fileId: id, url: `https://i.ibb.co/${id}`, ...RENDITION_FIELDS })
    }
    await exec.batch([
      sql`update photos set urls = '"x"'::jsonb where id = ${x}`,
      sql`update photos set urls = '{"url": "https://i.ibb.co/y"}'::jsonb where id = ${y}`,
    ])
    for (const id of [x, y]) expect(fields(await photo(id))).toEqual({ ...RENDITION_FIELDS, urls: null })
  })

  it('reads a hand-edited row clean: renditions that parse, a size with both sides in range, a delete handle not empty', async () => {
    const { exec, run, item, photo } = await setup()
    const [x, y] = [newId(), newId()]
    for (const id of [x, y]) {
      await run({ type: 'photo.add', id, itemId: item, variantId: null, provider: 'imgbb', fileId: id, url: `https://i.ibb.co/${id}`, ...RENDITION_FIELDS })
    }
    await exec.batch([
      sql`update photos
          set urls = '[null, {"url":"http://x/a.webp","role":"t","width":1,"height":1,"fit":"inside","type":null},
                       {"url":"https://i.ibb.co/a/p.webp","role":"thumb","width":180,"height":180,"fit":"cover"}]'::jsonb,
              width = 0, height = 100, delete_handle = ''
          where id = ${x}`,
      sql`update photos set width = 640, height = 20001, delete_handle = ${'h'.repeat(2049)} where id = ${y}`,
    ])
    expect(fields(await photo(x))).toEqual({
      urls: [{ url: 'https://i.ibb.co/a/p.webp', role: 'thumb', width: 180, height: 180, fit: 'cover', type: null }],
      width: null,
      height: null,
      deleteHandle: null,
    })
    expect(fields(await photo(y))).toEqual({ urls: RENDITION_FIELDS.urls, width: null, height: null, deleteHandle: null })
  })
})

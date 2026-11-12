import { newId, StorageError } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { APP_SCHEMA_VERSION, ensureSchema } from '../src/migrator'
import { sql } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import { makeExecutor, makeStorage, TEST_ACTOR } from './helpers'

describe('inventories', () => {
  it('creates and lists an inventory', async () => {
    const storage = await makeStorage()
    const id = newId()
    await storage.apply({ type: 'inventory.create', id, name: 'Workshop', description: 'Tools', currency: 'USD' }, TEST_ACTOR)
    const [inv] = (await storage.listInventories()).inventories
    expect(inv).toMatchObject({
      id,
      name: 'Workshop',
      description: 'Tools',
      currency: 'USD',
      createdBy: 'Test · Vitest',
      updatedBy: 'Test · Vitest',
      archivedAt: null,
      archiveId: null,
    })
    expect(new Date(inv!.createdAt).toISOString()).toBe(inv!.createdAt)
  })

  it('clears the description with null and keeps untouched fields', async () => {
    const storage = await makeStorage()
    const id = newId()
    await storage.apply({ type: 'inventory.create', id, name: 'A', description: 'd', currency: 'USD' }, TEST_ACTOR)
    await storage.apply({ type: 'inventory.update', id, description: null }, { device: 'Other' })
    const [inv] = (await storage.listInventories()).inventories
    expect(inv).toMatchObject({ name: 'A', description: null, updatedBy: 'Other', createdBy: 'Test · Vitest' })
  })

  it('lists inventories sorted by name', async () => {
    const storage = await makeStorage()
    for (const name of ['B', 'A']) {
      await storage.apply({ type: 'inventory.create', id: newId(), name, description: null, currency: 'EUR' }, TEST_ACTOR)
    }
    expect((await storage.listInventories()).inventories.map((i) => i.name)).toEqual(['A', 'B'])
  })

  it('loads an empty snapshot', async () => {
    const storage = await makeStorage()
    const id = newId()
    await storage.apply({ type: 'inventory.create', id, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    const snap = await storage.loadInventory(id)
    expect(snap.inventory.id).toBe(id)
    expect(snap).toMatchObject({
      folders: [], items: [], variants: [], tags: [], attributes: [], units: [],
      itemAttributes: [], variantAttributeValues: [], photos: [], stock: [],
    })
  })

  it('is read-only when the database needs a newer app to write', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const next = String(APP_SCHEMA_VERSION + 1)
    await exec.batch([sql`update antresol_meta set value = ${next} where key in ('schema_version', 'min_app_schema')`])
    const { storage, status } = await openPostgresStorage(exec)
    expect(status.state).toBe('newer')
    expect(storage.readOnly).toBe(true)
    const err = await storage
      .apply({ type: 'inventory.create', id: newId(), name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageError)
    expect((err as StorageError).code).toBe('read_only')
    expect((await storage.listInventories()).inventories).toEqual([])
  })

  it('wraps driver errors in StorageError(failed) with cause', async () => {
    const storage = await makeStorage()
    const err = await storage
      .apply({ type: 'folder.create', id: newId(), inventoryId: newId(), parentId: null, name: 'x', description: null }, TEST_ACTOR)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageError)
    expect((err as StorageError).code).toBe('failed')
    expect((err as StorageError).cause).toBeDefined()
  })
})

describe('revision', () => {
  it('changes on every apply and is not touched by reads', async () => {
    const storage = await makeStorage()
    const seen = new Set<string>([(await storage.listInventories()).rev])
    const id = newId()
    await storage.apply({ type: 'inventory.create', id, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    seen.add((await storage.listInventories()).rev)
    await storage.apply({ type: 'inventory.update', id, name: 'B' }, TEST_ACTOR)
    const rev = (await storage.listInventories()).rev
    seen.add(rev)
    expect(seen.size).toBe(3)
    await storage.loadInventory(id)
    await storage.loadAllMovements(id)
    await storage.listInventories()
    expect((await storage.listInventories()).rev).toBe(rev)
  })

  it('is not changed by an apply that fails', async () => {
    const storage = await makeStorage()
    const before = (await storage.listInventories()).rev
    await expect(
      storage.apply({ type: 'folder.create', id: newId(), inventoryId: newId(), parentId: null, name: 'F', description: null }, TEST_ACTOR),
    ).rejects.toBeDefined()
    expect((await storage.listInventories()).rev).toBe(before)
  })

  it('is recreated by the next apply when the row is missing, and reads as unknown meanwhile', async () => {
    const exec = await makeExecutor()
    const { storage } = await openPostgresStorage(exec)
    await exec.batch([sql`delete from antresol_meta where key = 'rev'`])
    const a = (await storage.listInventories()).rev
    expect(a).not.toBe((await storage.listInventories()).rev)
    await storage.apply({ type: 'inventory.create', id: newId(), name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    const b = (await storage.listInventories()).rev
    expect(b).toBe((await storage.listInventories()).rev)
    expect(b).not.toMatch(/^unknown:/)
  })

  it('is changed by a migration batch', async () => {
    const exec = await makeExecutor()
    await exec.batch([
      sql`create table antresol_meta (key text primary key, value text not null)`,
      sql`insert into antresol_meta (key, value) values ('rev', 'fixed')`,
    ])
    await ensureSchema(exec)
    const rows = await exec.query<{ value: string }>(sql`select value from antresol_meta where key = 'rev'`)
    expect(rows[0]!.value).not.toBe('fixed')
  })
})

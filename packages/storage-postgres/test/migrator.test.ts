import { newId, normalizeCommand, StorageError, type ApplyResult, type Command, type Id } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { toStatements } from '../src/commands'
import type { PgExecutor } from '../src/executor'
import {
  APP_SCHEMA_VERSION,
  LOCK_REV,
  MIGRATION_LOCK_KEY,
  REV_BUMP,
  SCHEMA_BASE,
  ensureSchema,
  isConcurrentMigration,
} from '../src/migrator'
import { snapshotSql } from '../src/queries'
import { sql, type Statement } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import journal from '../migrations/meta/_journal.json'
import * as schema3 from './fixtures/schema3-reads'
import * as schema6 from './fixtures/schema6-icon-writes'
import * as schema7 from './fixtures/schema7-color-writes'
import { attributeCreate, itemCreate, makeExecutor, sizeAxis, TEST_ACTOR, variantsCreate } from './helpers'

describe('ensureSchema', () => {
  it('migrates an empty database', async () => {
    const exec = await makeExecutor()
    expect(await ensureSchema(exec)).toEqual({
      state: 'ready',
      dbVersion: APP_SCHEMA_VERSION,
      appVersion: APP_SCHEMA_VERSION,
      minAppSchema: 3,
    })
    const rows = await exec.query<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    const names = rows.map((r) => r.table_name)
    expect(names).toContain('items')
    expect(names).toContain('movements')
    expect(names).toContain('intakes')
    expect(APP_SCHEMA_VERSION).toBe(9)
    expect(await exec.query(sql`select 1 from antresol_meta where key = 'rev'`)).toHaveLength(1)
    expect(await exec.query(sql`select 1 from antresol_meta where key = 'intakes_rev'`)).toHaveLength(1)
  })

  it('rejects a pre-release database as outdated and leaves it as it was', async () => {
    const exec = await makeExecutor()
    await exec.batch([
      sql`create table antresol_meta (key text primary key, value text not null)`,
      sql`insert into antresol_meta (key, value) values ('schema_version', '2')`,
    ])
    const err = await ensureSchema(exec).catch((e) => e)
    expect(err).toBeInstanceOf(StorageError)
    expect(err.code).toBe('outdated')
    expect(await exec.query(sql`select value from antresol_meta where key = 'schema_version'`)).toEqual([{ value: '2' }])
    expect(await exec.query(sql`select 1 from information_schema.tables where table_name = 'items'`)).toEqual([])
  })

  it('two devices on an empty database both end ready', async () => {
    const exec = await makeExecutor()
    const results = await Promise.all([ensureSchema(exec), ensureSchema(exec)])
    expect(results.map((r) => r.state)).toEqual(['ready', 'ready'])
  })

  it('is idempotent', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    expect(await ensureSchema(exec)).toEqual({
      state: 'ready',
      dbVersion: APP_SCHEMA_VERSION,
      appVersion: APP_SCHEMA_VERSION,
      minAppSchema: 3,
    })
  })

  it('reports newer when the database needs a newer app to write', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const next = String(APP_SCHEMA_VERSION + 1)
    await exec.batch([
      sql`update antresol_meta set value = ${next} where key = 'schema_version'`,
      sql`update antresol_meta set value = ${next} where key = 'min_app_schema'`,
    ])
    expect(await ensureSchema(exec)).toEqual({
      state: 'newer',
      dbVersion: APP_SCHEMA_VERSION + 1,
      appVersion: APP_SCHEMA_VERSION,
      minAppSchema: APP_SCHEMA_VERSION + 1,
    })
  })
})

/** The executor, recording the text of every batch (and every rejection); `onBatch` runs before each batch is sent. */
function recording(exec: PgExecutor, onBatch?: (seen: number) => Promise<void>) {
  const batches: string[][] = []
  const rejections: unknown[] = []
  const wrapped: PgExecutor = {
    ...exec,
    query: (s) => exec.query(s),
    batch: async (statements) => {
      batches.push(statements.map((s) => s.text))
      if (onBatch) await onBatch(batches.length)
      try {
        return await exec.batch(statements)
      } catch (e) {
        rejections.push(e)
        throw e
      }
    },
  }
  return { wrapped, batches, rejections }
}

describe('ensureSchema concurrency', () => {
  it('creates antresol_meta only after taking the lock', async () => {
    const { wrapped, batches } = recording(await makeExecutor())
    await ensureSchema(wrapped)
    const first = batches[0] as string[]
    expect(first[0]).toBe(`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`)
    expect(first[1]).toContain('create table if not exists antresol_meta')
    for (const b of batches) {
      const touch = b.findIndex((t) => t.includes('antresol_meta'))
      const lock = b.findIndex((t) => t.includes('pg_advisory_xact_lock'))
      expect(lock).toBeGreaterThanOrEqual(0)
      expect(lock).toBeLessThan(touch)
    }
  })

  it('fails clearly on a non-integer schema_version', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    await exec.batch([sql`update antresol_meta set value = 'abc' where key = 'schema_version'`])
    await expect(ensureSchema(exec)).rejects.toThrow('schema_version is not a non-negative integer')
  })

  it('isConcurrentMigration matches precisely', () => {
    const make = (message: string, code?: string) => Object.assign(new Error(message), { code })
    expect(isConcurrentMigration(make('antresol_concurrent_migration', 'AN001'))).toBe(true)
    expect(isConcurrentMigration(make('antresol_concurrent_migration', '23505'))).toBe(false)
    expect(isConcurrentMigration(make('something else', 'AN001'))).toBe(false)
    expect(isConcurrentMigration('antresol_concurrent_migration')).toBe(false)
    expect(isConcurrentMigration(null)).toBe(false)
  })

  it('starts every migration batch with the advisory lock, the revision lock and a version guard', async () => {
    const { wrapped, batches } = recording(await makeExecutor())
    await ensureSchema(wrapped)
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('schema_version')))
    expect(migrationBatches).toHaveLength(APP_SCHEMA_VERSION - SCHEMA_BASE)
    for (const b of migrationBatches) {
      expect(b[0]).toBe(`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`)
      // The lock every write takes first: a write waits for the migration, never holds the row while the migration
      // waits for it with a table locked (Plan 6 carry-over).
      expect(b[1]).toBe(LOCK_REV.text)
      expect(b[2]).toContain('antresol_concurrent_migration')
    }
  })

  it('loser of the race re-reads the version, applies nothing twice and does not throw', async () => {
    const exec = await makeExecutor()
    let raced = false
    // Right before the wrapped device's first migration batch, another device finishes the whole migration.
    const { wrapped, batches, rejections } = recording(exec, async (seen) => {
      if (raced || seen < 2) return
      raced = true
      await ensureSchema(exec)
    })
    expect(await ensureSchema(wrapped)).toEqual({
      state: 'ready',
      dbVersion: APP_SCHEMA_VERSION,
      appVersion: APP_SCHEMA_VERSION,
      minAppSchema: 3,
    })
    expect(raced).toBe(true)
    // antresol_meta create + exactly one rejected migration batch; nothing re-applied.
    expect(batches.filter((b) => b.some((t) => t.includes('antresol_concurrent_migration')))).toHaveLength(1)
    expect(rejections).toHaveLength(1)
    expect(isConcurrentMigration(rejections[0])).toBe(true)
    expect((rejections[0] as { code?: string }).code).toBe('AN001')
    expect(await exec.query(sql`select 1 from antresol_meta where key = 'schema_version'`)).toHaveLength(1)
  })

  it('does not swallow other errors', async () => {
    const exec = await makeExecutor()
    const failing: PgExecutor = {
      ...exec,
      batch: async (s) => {
        if (s[0]?.text.startsWith('select pg_advisory_xact_lock')) throw new Error('boom')
        return exec.batch(s)
      },
    }
    await expect(ensureSchema(failing)).rejects.toThrow('boom')
  })
})

const metaValue = async (exec: PgExecutor, key: string): Promise<string | null> =>
  (await exec.query<{ value: string }>(sql`select value from antresol_meta where key = ${key}`))[0]?.value ?? null

const revOf = async (exec: PgExecutor): Promise<string | null> => metaValue(exec, 'rev')

/** The write statements of a command as an app of schema 7 or older sent them: folder.create and item.create name no
 *  `icon` (frozen in fixtures/schema6-icon-writes.ts), tag.create no `color` (fixtures/schema7-color-writes.ts), every
 *  other command is unchanged since schema 3. */
function statementsOfOldApp(c: Command): Statement[] {
  const n = normalizeCommand(c)
  if (n.type === 'folder.create') return [schema6.folderCreate(n, TEST_ACTOR)]
  if (n.type === 'item.create') return schema6.itemCreate(n, TEST_ACTOR)
  if (n.type === 'tag.create') return [schema7.tagCreate(n, TEST_ACTOR)]
  return toStatements(n, TEST_ACTOR)
}

/** Writes the commands as an app of schema 3 does, without the reads back (those name the new columns): the write
 *  statements of every command without `pinned` are the ones schema 3 sent. */
async function writeAsSchema3(exec: PgExecutor, commands: Command[]): Promise<void> {
  for (const c of commands) await exec.batch([LOCK_REV, ...statementsOfOldApp(c), REV_BUMP])
}

/** An inventory with a folder, a tag, a custom unit, attributes (shared and an axis), items with variants, a photo and
 *  movements of every kind, an archived item. */
function sampleCommands(inv: Id): Command[] {
  const [folder, tag, unit, pkg, size] = [newId(), newId(), newId(), newId(), newId()]
  const [item, other, archived, v1, v2] = [newId(), newId(), newId(), newId(), newId()]
  return [
    { type: 'inventory.create', id: inv, name: 'Lab', description: 'Bench', currency: 'EUR' },
    { type: 'folder.create', id: folder, inventoryId: inv, parentId: null, name: 'Shelf', description: null },
    { type: 'tag.create', id: tag, inventoryId: inv, name: 'smd' },
    { type: 'unit.create', id: unit, inventoryId: inv, name: 'Roll', symbol: 'roll', prefixPowers: [] },
    attributeCreate(inv, pkg, 'Package', 'enum', { options: ['DIP-8', 'SOIC-8'] }),
    { ...(itemCreate(inv, item, 'TL072') as Extract<Command, { type: 'item.create' }>), folderId: folder, tagIds: [tag],
      initialReceipt: { movementId: newId(), quantity: '10', totalPrice: 250, sourceUrl: 'https://shop.example/tl072' } },
    { type: 'item.setAttribute', itemId: item, attributeId: pkg, value: 'DIP-8' },
    itemCreate(inv, other, 'Resistor'),
    ...sizeAxis(inv, other, size),
    variantsCreate(other, [[v1, { [size]: '0805' }], [v2, { [size]: '0603' }]]),
    { type: 'stock.receive', movementId: newId(), itemId: other, variantId: v1, quantity: '100', totalPrice: 90, sourceUrl: null, note: 'reel' },
    { type: 'stock.use', movementId: newId(), itemId: item, variantId: null, quantity: '3', note: null },
    { type: 'stock.set', movementId: newId(), itemId: item, variantId: null, target: '6', note: 'counted' },
    { type: 'stock.transfer', transferId: newId(), outMovementId: newId(), inMovementId: newId(), itemId: other,
      fromVariantId: v1, toVariantId: v2, quantity: '40' },
    { type: 'photo.add', id: newId(), itemId: item, variantId: null, provider: 'fake', fileId: 'f1', url: 'https://cdn.example/f1' },
    { ...(itemCreate(inv, archived, 'Old') as Extract<Command, { type: 'item.create' }>), unitKey: `custom:${unit}` },
    { type: 'archive', target: 'item', id: archived, archiveId: newId() },
  ]
}

/** Every read of `snapshotSql`, filtered to the inventory as loadInventory filters it. */
const snapshotArgs = (inv: Id): Record<keyof typeof schema3.snapshotSql, Statement> => {
  const byInventory = sql`${inv}`
  const ofInventory = sql`i.inventory_id = ${inv}`
  return {
    inventory: byInventory, folders: byInventory, tags: byInventory, attributes: byInventory, units: byInventory,
    items: ofInventory, variants: ofInventory, itemAttributes: ofInventory, variantAttributeValues: ofInventory,
    photos: ofInventory, stock: sql`inventory_id = ${inv}`,
  }
}

describe('schema 4 (migration 0001)', () => {
  it('moves a schema-3 database to 4 by migration 0001 alone, keeping its data', async () => {
    const exec = await makeExecutor()
    expect(await ensureSchema(exec, 3)).toEqual({ state: 'ready', dbVersion: 3, appVersion: 3, minAppSchema: 3 })
    expect(await metaValue(exec, 'min_app_schema')).toBeNull()
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const before = await exec.readBatch(schema3.snapshotStatements(inv))

    const { wrapped, batches } = recording(exec)
    expect(await ensureSchema(wrapped, 4)).toEqual({ state: 'ready', dbVersion: 4, appVersion: 4, minAppSchema: 3 })
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('antresol_concurrent_migration')))
    expect(migrationBatches).toHaveLength(1)
    expect(migrationBatches[0]!.join('\n')).toContain('"pinned"')
    expect(await metaValue(exec, 'schema_version')).toBe('4')
    expect(await metaValue(exec, 'min_app_schema')).toBe('3')
    // Every row as it was; attributes gained `pinned`, off.
    expect(await exec.readBatch(schema3.snapshotStatements(inv))).toEqual(before)
    const { storage } = await openPostgresStorage(exec)
    const attributes = (await storage.loadInventory(inv)).attributes
    expect(attributes.length).toBeGreaterThan(0)
    expect(attributes.map((a) => a.pinned)).toEqual(attributes.map(() => false))
  })

  it('an empty database runs the initial migration, then 0001 to 0006', async () => {
    const { wrapped, batches } = recording(await makeExecutor())
    await ensureSchema(wrapped)
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('antresol_concurrent_migration')))
    expect(migrationBatches).toHaveLength(7)
    expect(migrationBatches[0]!.join('\n')).toContain('CREATE TABLE "attributes"')
    expect(migrationBatches[1]!.join('\n')).toContain('"pinned"')
    expect(migrationBatches[2]!.join('\n')).toContain('"delete_handle"')
    expect(migrationBatches[3]!.join('\n')).toContain('CREATE TABLE "intakes"')
    expect(migrationBatches[4]!.join('\n')).toContain('"icon"')
    expect(migrationBatches[5]!.join('\n')).toContain('"color"')
    expect(migrationBatches[6]!.join('\n')).toContain('"created" jsonb')
    expect(migrationBatches.map((b) => b.at(-1))).toEqual(migrationBatches.map(() => expect.stringContaining('schema_version')))
  })

  it('adds attributes.pinned: boolean, not null, false by default', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const columns = await exec.query(
      sql`select data_type, is_nullable, column_default from information_schema.columns
          where table_name = 'attributes' and column_name = 'pinned'`,
    )
    expect(columns).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }])
  })

  it('refuses to change a movement; deleting an item, a variant or an inventory still takes its movements', async () => {
    const exec = await makeExecutor()
    const { storage } = await openPostgresStorage(exec)
    const [inv, gone] = [newId(), newId()]
    const run = (c: Command) => storage.apply(c, TEST_ACTOR)
    for (const c of sampleCommands(inv)) await run(c)
    for (const c of sampleCommands(gone)) await run(c)
    const journal = sql`select id, kind, quantity::text, note from movements order by seq`
    const before = await exec.query(journal)
    for (const change of [
      sql`update movements set note = 'edited'`,
      sql`update movements set quantity = 0 where inventory_id = ${inv}`,
      sql`update movements set kind = 'usage' where kind = 'receipt'`,
    ]) {
      await expect(exec.batch([change])).rejects.toThrow(/antresol_movements_append_only/)
    }
    expect(await exec.query(journal)).toEqual(before)

    const count = async (where: Statement) =>
      (await exec.query<{ n: number }>(sql`select count(*)::int as n from movements where ${where}`))[0]!.n
    const snapshot = await storage.loadInventory(inv)
    const item = snapshot.items.find((i) => i.name === 'TL072')!.id
    const variant = snapshot.variants.find((v) => snapshot.stock.some((l) => l.variantId === v.id))!.id
    expect(await count(sql`item_id = ${item}`)).toBeGreaterThan(0)
    expect(await count(sql`variant_id = ${variant}`)).toBeGreaterThan(0)
    await run({ type: 'archive', target: 'variant', id: variant, archiveId: newId() })
    await run({ type: 'deletePermanently', target: 'variant', id: variant })
    expect(await count(sql`variant_id = ${variant}`)).toBe(0)
    await run({ type: 'archive', target: 'item', id: item, archiveId: newId() })
    await run({ type: 'deletePermanently', target: 'item', id: item })
    expect(await count(sql`item_id = ${item}`)).toBe(0)
    expect(await count(sql`inventory_id = ${gone}`)).toBeGreaterThan(0)
    await run({ type: 'archive', target: 'inventory', id: gone, archiveId: newId() })
    await run({ type: 'deletePermanently', target: 'inventory', id: gone })
    expect(await count(sql`inventory_id = ${gone}`)).toBe(0)
    expect(await count(sql`inventory_id = ${inv}`)).toBeGreaterThan(0)
  })

  it('a write sent while another device migrates waits for the migration, or goes before it; revisions chain', async () => {
    for (const writeFirst of [false, true]) {
      const exec = await makeExecutor()
      const { storage: old } = await openPostgresStorage(exec, { appVersion: 3 })
      const inv = newId()
      await old.apply({ type: 'inventory.create', id: inv, name: 'Lab', description: null, currency: 'EUR' }, TEST_ACTOR)
      const before = await revOf(exec)
      let write: Promise<ApplyResult> | undefined
      let migrationRev: unknown
      const send = () =>
        old.apply({ type: 'unit.create', id: newId(), inventoryId: inv, name: 'Metre', symbol: 'm', prefixPowers: [] }, TEST_ACTOR)
      // The write is sent just before, or just after, the migration's batch: the transaction sent second waits for the
      // first (on PGlite, its single connection; on Postgres, the revision row both lock first).
      const migrating: PgExecutor = {
        ...exec,
        batch: async (statements) => {
          const migration = statements.some((s) => s.text.includes('antresol_concurrent_migration'))
          if (migration && writeFirst) write = send()
          const pending = exec.batch(statements)
          if (migration && !writeFirst) write = send()
          const rows = await pending
          if (migration) migrationRev = rows[statements.indexOf(REV_BUMP)]?.[0]?.value
          return rows
        },
      }
      expect(await ensureSchema(migrating, 4)).toMatchObject({ state: 'ready', dbVersion: 4 })
      const r = await write!
      expect(typeof migrationRev).toBe('string')
      if (writeFirst) {
        expect(r.prevRev).toBe(before)
        expect(await revOf(exec)).toBe(migrationRev)
      } else {
        expect(r.prevRev).toBe(migrationRev)
        expect(await revOf(exec)).toBe(r.rev)
      }
    }
  })
})

describe('schema 5 (migration 0002)', () => {
  it('moves a schema-4 database to 5 by migration 0002 alone, keeping its data; its photos read null in the new fields', async () => {
    const exec = await makeExecutor()
    expect(await ensureSchema(exec, 4)).toEqual({ state: 'ready', dbVersion: 4, appVersion: 4, minAppSchema: 3 })
    const inv = newId()
    // Commands without the schema-5 fields write what schema 4 (and 3) wrote.
    await writeAsSchema3(exec, sampleCommands(inv))
    const before = await exec.readBatch(schema3.snapshotStatements(inv))

    const { wrapped, batches } = recording(exec)
    expect(await ensureSchema(wrapped, 5)).toEqual({ state: 'ready', dbVersion: 5, appVersion: 5, minAppSchema: 3 })
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('antresol_concurrent_migration')))
    expect(migrationBatches).toHaveLength(1)
    expect(migrationBatches[0]!.join('\n')).toContain('"delete_handle"')
    expect(await metaValue(exec, 'schema_version')).toBe('5')
    expect(await metaValue(exec, 'min_app_schema')).toBe('3')
    expect(await exec.readBatch(schema3.snapshotStatements(inv))).toEqual(before)
    const { storage } = await openPostgresStorage(exec)
    const photos = (await storage.loadInventory(inv)).photos
    expect(photos.length).toBeGreaterThan(0)
    expect(photos.map((p) => [p.urls, p.width, p.height, p.deleteHandle])).toEqual(photos.map(() => [null, null, null, null]))
  })

  it('adds photos.urls jsonb, width and height integer, delete_handle text: nullable, no default', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const columns = await exec.query(
      sql`select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_name = 'photos' and column_name in ('urls', 'width', 'height', 'delete_handle') order by column_name`,
    )
    expect(columns).toEqual([
      { column_name: 'delete_handle', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'height', data_type: 'integer', is_nullable: 'YES', column_default: null },
      { column_name: 'urls', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
      { column_name: 'width', data_type: 'integer', is_nullable: 'YES', column_default: null },
    ])
  })
})

describe('schema 6 (migration 0003)', () => {
  it('moves a schema-5 database to 6, keeping its data: the intakes table, movements.intake_id, intakes_rev', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec, 5)
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const before = await exec.readBatch(schema3.snapshotStatements(inv))
    const journal = await exec.query(schema3.movementsOfInventory(inv))
    expect(await metaValue(exec, 'intakes_rev')).toBeNull()

    const { wrapped, batches } = recording(exec)
    expect(await ensureSchema(wrapped, 6)).toEqual({ state: 'ready', dbVersion: 6, appVersion: 6, minAppSchema: 3 })
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('antresol_concurrent_migration')))
    expect(migrationBatches).toHaveLength(1)
    expect(migrationBatches[0]!.join('\n')).toContain('CREATE TABLE "intakes"')
    expect(await metaValue(exec, 'schema_version')).toBe('6')
    expect(await metaValue(exec, 'min_app_schema')).toBe('3')
    expect(await metaValue(exec, 'intakes_rev')).toEqual(expect.any(String))
    expect(await exec.readBatch(schema3.snapshotStatements(inv))).toEqual(before)
    expect(await exec.query(schema3.movementsOfInventory(inv))).toEqual(journal)
    const { storage } = await openPostgresStorage(exec)
    expect((await storage.loadAllMovements(inv)).map((m) => m.intakeId)).toEqual(journal.map(() => null))
    expect(await storage.listIntakes(inv)).toEqual({ intakes: [], intakesRev: await metaValue(exec, 'intakes_rev') })
  })

  it('an app of schema 4 reads and writes a schema-9 database', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const { storage, status } = await openPostgresStorage(exec, { appVersion: 4 })
    expect(status).toEqual({ state: 'ready', dbVersion: 9, appVersion: 4, minAppSchema: 3 })
    expect(storage.readOnly).toBe(false)
    const inv = newId()
    for (const c of sampleCommands(inv)) await storage.apply(c, TEST_ACTOR)
    // Schema 4's own writes: the commands it sends name no column of schema 5 or 6.
    const more = newId()
    await writeAsSchema3(exec, [itemCreate(inv, more, 'Fuse')])
    const snapshot = await storage.loadInventory(inv)
    expect(snapshot.items.map((i) => i.name)).toContain('Fuse')
    expect(snapshot.items.map((i) => i.name)).toContain('TL072')
  })
})

describe('schema 7 (migration 0004)', () => {
  it('moves a schema-6 database to 7, keeping its data: folders and items gain icon, null', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec, 6)
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const before = await exec.readBatch(schema3.snapshotStatements(inv))

    const { wrapped, batches } = recording(exec)
    expect(await ensureSchema(wrapped, 7)).toEqual({ state: 'ready', dbVersion: 7, appVersion: 7, minAppSchema: 3 })
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('antresol_concurrent_migration')))
    expect(migrationBatches).toHaveLength(1)
    expect(migrationBatches[0]!.join('\n')).toContain('ADD COLUMN "icon"')
    expect(await metaValue(exec, 'schema_version')).toBe('7')
    expect(await metaValue(exec, 'min_app_schema')).toBe('3')
    expect(await exec.readBatch(schema3.snapshotStatements(inv))).toEqual(before)
    const { storage } = await openPostgresStorage(exec)
    const snapshot = await storage.loadInventory(inv)
    expect(snapshot.folders.length).toBeGreaterThan(0)
    expect(snapshot.items.length).toBeGreaterThan(0)
    expect([...snapshot.folders, ...snapshot.items].map((r) => r.icon)).toEqual([...snapshot.folders, ...snapshot.items].map(() => null))
    // The migrated database takes icons.
    await storage.apply({ type: 'item.update', id: snapshot.items[0]!.id, icon: 'microchip' }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).items.find((i) => i.id === snapshot.items[0]!.id)!.icon).toBe('microchip')
  })

  it('adds folders.icon and items.icon: text, nullable, no default', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const columns = await exec.query(
      sql`select table_name, data_type, is_nullable, column_default from information_schema.columns
          where column_name = 'icon' order by table_name`,
    )
    expect(columns).toEqual([
      { table_name: 'folders', data_type: 'text', is_nullable: 'YES', column_default: null },
      { table_name: 'items', data_type: 'text', is_nullable: 'YES', column_default: null },
    ])
  })

  it('an app of schema 6 writes folders and items without the icon column to a schema-7 database', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const { storage } = await openPostgresStorage(exec)
    const snapshot = await storage.loadInventory(inv)
    expect([...snapshot.folders, ...snapshot.items].every((r) => r.icon === null)).toBe(true)
  })
})

describe('schema 8 (migration 0005)', () => {
  it('moves a schema-7 database to 8, keeping its data: items and tags gain color, null', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec, 7)
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const before = await exec.readBatch(schema3.snapshotStatements(inv))

    const { wrapped, batches } = recording(exec)
    expect(await ensureSchema(wrapped, 8)).toEqual({ state: 'ready', dbVersion: 8, appVersion: 8, minAppSchema: 3 })
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('antresol_concurrent_migration')))
    expect(migrationBatches).toHaveLength(1)
    expect(migrationBatches[0]!.join('\n')).toContain('ADD COLUMN "color"')
    expect(await metaValue(exec, 'schema_version')).toBe('8')
    expect(await metaValue(exec, 'min_app_schema')).toBe('3')
    expect(await exec.readBatch(schema3.snapshotStatements(inv))).toEqual(before)
    const { storage } = await openPostgresStorage(exec)
    const snapshot = await storage.loadInventory(inv)
    expect(snapshot.items.length).toBeGreaterThan(0)
    expect(snapshot.tags.length).toBeGreaterThan(0)
    expect([...snapshot.items, ...snapshot.tags].every((r) => r.color === null)).toBe(true)
    await storage.apply({ type: 'item.update', id: snapshot.items[0]!.id, color: '#4F46E5' }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).items.find((i) => i.id === snapshot.items[0]!.id)!.color).toBe('#4F46E5')
  })

  it('adds items.color and tags.color: text, nullable, no default, with a check on the form', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const columns = await exec.query(
      sql`select table_name, data_type, is_nullable, column_default from information_schema.columns
          where column_name = 'color' order by table_name`,
    )
    expect(columns).toEqual([
      { table_name: 'items', data_type: 'text', is_nullable: 'YES', column_default: null },
      { table_name: 'tags', data_type: 'text', is_nullable: 'YES', column_default: null },
    ])
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const updates = (color: string) => [
      sql`update items set color = ${color}`,
      sql`update tags set color = ${color}`,
    ]
    for (const bad of ['#4f46e5', 'red']) for (const u of updates(bad)) await expect(exec.batch([u])).rejects.toThrow()
    for (const u of updates('#4F46E5')) await exec.batch([u])
  })

  it('an app of schema 7 writes tags, items and folders without the color column to a schema-8 database', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const { storage } = await openPostgresStorage(exec)
    const snapshot = await storage.loadInventory(inv)
    expect(snapshot.tags.length).toBeGreaterThan(0)
    expect([...snapshot.items, ...snapshot.tags].every((r) => r.color === null)).toBe(true)
  })
})

describe('schema 9 (migration 0006)', () => {
  it('moves a schema-8 database to 9, keeping its data: intakes gain created, null; min_app_schema stays 3', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec, 8)
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const before = await exec.readBatch(schema3.snapshotStatements(inv))

    const { wrapped, batches } = recording(exec)
    expect(await ensureSchema(wrapped)).toEqual({ state: 'ready', dbVersion: 9, appVersion: 9, minAppSchema: 3 })
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('antresol_concurrent_migration')))
    expect(migrationBatches).toHaveLength(1)
    expect(migrationBatches[0]!.join('\n')).toContain('ADD COLUMN "created" jsonb')
    expect(await metaValue(exec, 'schema_version')).toBe('9')
    expect(await metaValue(exec, 'min_app_schema')).toBe('3')
    expect(await exec.readBatch(schema3.snapshotStatements(inv))).toEqual(before)
    expect(
      await exec.query(sql`select data_type, is_nullable, column_default from information_schema.columns
                           where table_name = 'intakes' and column_name = 'created'`),
    ).toEqual([{ data_type: 'jsonb', is_nullable: 'YES', column_default: null }])
  })
})

describe('soft migrations (min_app_schema)', () => {
  const setMeta = (exec: PgExecutor, key: string, value: number) =>
    exec.batch([sql`update antresol_meta set value = ${String(value)} where key = ${key}`])

  it('an app of schema 3 on a newer database writes while min_app_schema is 3, only reads above', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    expect(await ensureSchema(exec, 3)).toEqual({ state: 'ready', dbVersion: APP_SCHEMA_VERSION, appVersion: 3, minAppSchema: 3 })
    const { storage, status } = await openPostgresStorage(exec, { appVersion: 3 })
    expect(status.state).toBe('ready')
    expect(storage.readOnly).toBe(false)
    await setMeta(exec, 'min_app_schema', 4)
    expect(await ensureSchema(exec, 3)).toEqual({ state: 'newer', dbVersion: APP_SCHEMA_VERSION, appVersion: 3, minAppSchema: 4 })
    const reopened = await openPostgresStorage(exec, { appVersion: 3 })
    expect(reopened.storage.readOnly).toBe(true)
    await expect(
      reopened.storage.apply({ type: 'inventory.create', id: newId(), name: 'X', description: null, currency: 'EUR' }, TEST_ACTOR),
    ).rejects.toMatchObject({ code: 'read_only' })
  })

  it('this app on a newer database writes while min_app_schema allows it', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const next = APP_SCHEMA_VERSION + 1
    await setMeta(exec, 'schema_version', next)
    expect(await ensureSchema(exec)).toEqual({ state: 'ready', dbVersion: next, appVersion: APP_SCHEMA_VERSION, minAppSchema: 3 })
    await setMeta(exec, 'min_app_schema', APP_SCHEMA_VERSION)
    expect((await ensureSchema(exec)).state).toBe('ready')
    await setMeta(exec, 'min_app_schema', next)
    expect((await ensureSchema(exec)).state).toBe('newer')
    // No min_app_schema (made before soft migrations): it takes an app of its own version.
    await exec.batch([sql`delete from antresol_meta where key = 'min_app_schema'`])
    expect(await ensureSchema(exec)).toEqual({ state: 'newer', dbVersion: next, appVersion: APP_SCHEMA_VERSION, minAppSchema: next })
  })

  it('fails clearly on a non-integer min_app_schema', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    await exec.batch([sql`update antresol_meta set value = 'x' where key = 'min_app_schema'`])
    await expect(ensureSchema(exec)).rejects.toThrow('min_app_schema is not a non-negative integer')
  })

  // G3: the version is checked again under the revision lock of every write, not only when the storage opens.
  describe('a write after the database moved past this app (AN003)', () => {
    /** A database this app migrated, opened by an app of `appVersion` (default this one). */
    async function opened(appVersion?: number) {
      const exec = await makeExecutor()
      await ensureSchema(exec)
      const { storage } = await openPostgresStorage(exec, appVersion === undefined ? {} : { appVersion })
      expect(storage.readOnly).toBe(false)
      const inv = newId()
      await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'EUR' }, TEST_ACTOR)
      return { exec, storage, inv }
    }
    const refused = async (storage: Awaited<ReturnType<typeof opened>>['storage'], exec: PgExecutor, inv: Id) => {
      const rev = await revOf(exec)
      const item = newId()
      const error = await storage.apply(itemCreate(inv, item), TEST_ACTOR).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(StorageError)
      expect(error).toMatchObject({ code: 'read_only' })
      // Nothing written: no item, the revision as it was.
      expect(await revOf(exec)).toBe(rev)
      expect(await exec.query(sql`select 1 from items where id = ${item}`)).toEqual([])
    }

    it('is refused with read_only and writes nothing when min_app_schema is above the app', async () => {
      const { exec, storage, inv } = await opened()
      await setMeta(exec, 'min_app_schema', 99)
      await refused(storage, exec, inv)
      // Back within reach: the same storage writes again.
      await setMeta(exec, 'min_app_schema', APP_SCHEMA_VERSION)
      await storage.apply(itemCreate(inv, newId()), TEST_ACTOR)
    })

    it('without min_app_schema the database version decides', async () => {
      const { exec, storage, inv } = await opened()
      await exec.batch([sql`delete from antresol_meta where key = 'min_app_schema'`])
      await storage.apply(itemCreate(inv, newId()), TEST_ACTOR)
      await setMeta(exec, 'schema_version', APP_SCHEMA_VERSION + 1)
      await refused(storage, exec, inv)
    })

    it('an older app compares with its own version', async () => {
      const { exec, storage, inv } = await opened(3)
      await setMeta(exec, 'min_app_schema', 4)
      await refused(storage, exec, inv)
    })

    it('a restore is refused the same way', async () => {
      const { exec, storage } = await opened()
      await setMeta(exec, 'min_app_schema', 99)
      const rev = await revOf(exec)
      const backup = await openPostgresStorage(await makeExecutor())
      const inv = newId()
      await backup.storage.apply({ type: 'inventory.create', id: inv, name: 'B', description: null, currency: 'EUR' }, TEST_ACTOR)
      const entry = await backup.storage.exportInventory(inv)
      await expect(storage.restore({ inventories: [entry] }, 'new-ids', newId())).rejects.toMatchObject({ code: 'read_only' })
      expect(await revOf(exec)).toBe(rev)
    })
  })

  it('refuses an app version it has no migrations for', async () => {
    const exec = await makeExecutor()
    for (const v of [SCHEMA_BASE, APP_SCHEMA_VERSION + 1, 3.5]) await expect(ensureSchema(exec, v)).rejects.toThrow(/app version/)
  })
})

// Review Focus 2: the schema-3 app keeps running its own reads and writes against a database a newer app migrated.
describe('an app of schema 3 on a schema-6 database', () => {
  it('reads every row as before: its frozen selects return what the current ones do, minus the new columns', async () => {
    const exec = await makeExecutor()
    const { storage } = await openPostgresStorage(exec)
    const inv = newId()
    for (const c of sampleCommands(inv)) await storage.apply(c, TEST_ACTOR)
    const attribute = (await storage.loadInventory(inv)).attributes[0]!.id
    await storage.apply({ type: 'attribute.update', id: attribute, pinned: true }, TEST_ACTOR)

    const args = snapshotArgs(inv)
    for (const key of Object.keys(schema3.snapshotSql) as (keyof typeof schema3.snapshotSql)[]) {
      const [then, now] = await exec.readBatch([schema3.snapshotSql[key](args[key]), snapshotSql[key](args[key])])
      expect(then!.length, key).toBeGreaterThan(0)
      const columns = Object.keys(then![0]!)
      expect(then, key).toEqual(now!.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]]))))
    }
    const whole = await exec.readBatch(schema3.snapshotStatements(inv))
    expect(whole.every((rows) => rows.length > 0)).toBe(true)
    const [list, rev] = await exec.readBatch(schema3.listInventories())
    expect(list!.map((r) => r.id)).toEqual([inv])
    expect(rev).toEqual([{ value: await revOf(exec) }])
    const journal = await exec.query(schema3.movementsOfInventory(inv))
    expect(journal.map((m) => m.id)).toEqual((await storage.loadAllMovements(inv)).map((m) => m.id))
  })

  it('writes with min_app_schema 3: new rows take the defaults, its attribute edits keep the pin', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    const inv = newId()
    await writeAsSchema3(exec, sampleCommands(inv))
    const { storage } = await openPostgresStorage(exec)
    const [pkg] = (await storage.loadInventory(inv)).attributes
    await storage.apply({ type: 'attribute.update', id: pkg!.id, pinned: true }, TEST_ACTOR)
    const added = newId()
    await writeAsSchema3(exec, [
      attributeCreate(inv, added, 'Voltage', 'number', { unit: 'V', siPrefixes: true }),
      { type: 'attribute.update', id: pkg!.id, name: 'Case', options: ['DIP-8', 'SOIC-8', 'SOT-23'] },
    ])
    const attributes = (await storage.loadInventory(inv)).attributes
    expect(attributes.find((a) => a.id === pkg!.id)).toMatchObject({ name: 'Case', pinned: true })
    expect(attributes.find((a) => a.id === added)).toMatchObject({ name: 'Voltage', pinned: false })
  })
})

describe('PgExecutor.batch', () => {
  it('is atomic', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    await expect(
      exec.batch([
        sql`insert into antresol_meta (key, value) values ('a', '1')`,
        sql`insert into antresol_meta (key, value) values ('a', '2')`,
      ]),
    ).rejects.toThrow(/duplicate key/)
    expect(await exec.query(sql`select 1 from antresol_meta where key = 'a'`)).toEqual([])
  })
})

describe('migration files', () => {
  it('match the drizzle journal one to one, in order', () => {
    const files = Object.keys(
      import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true }),
    )
      .map((p) => p.replace('../migrations/', '').replace('.sql', ''))
      .sort()
    expect(journal.entries.map((e) => e.tag)).toEqual(files)
    expect(journal.entries.map((e) => e.idx)).toEqual(files.map((_, i) => i))
    expect(APP_SCHEMA_VERSION).toBe(SCHEMA_BASE + files.length)
  })
})

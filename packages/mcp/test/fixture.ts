import { PGlite } from '@electric-sql/pglite'
import { newId, type Actor, type Command, type Id, type InventoryStorage } from '@antresol/core'
import { createPgliteExecutor, openPostgresStorage, type PgExecutor } from '@antresol/storage-postgres'
import { afterEach } from 'vitest'
import { readConfig, type ServerConfig } from '../src/config'
import type { ToolContext } from '../src/context'
import { createSource, type Source, type SourceOptions } from '../src/source'

export const TEST_ACTOR: Actor = { device: 'Test · Vitest' }

// Every database made here belongs to one test: it is closed after that test.
const open: PgExecutor[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((exec) => exec.close().catch(() => {})))
})

export interface FixtureOptions {
  /** Adds the inventory "Workshop". */
  secondInventory?: boolean
  /** Archives it again (needs secondInventory). */
  archiveSecond?: boolean
  source?: SourceOptions
}

export interface Fixture {
  ctx: ToolContext
  storage: InventoryStorage
  source: Source
  inventoryId: Id
  secondInventoryId: Id | null
  ids: { passives: Id; resistors: Id; modules: Id; resistance: Id; power: Id; smd: Id; resistor: Id; esp32: Id; v4k7: Id; v10k: Id }
  apply: (command: Command) => Promise<void>
}

export const CONFIG: ServerConfig = readConfig({ ANTRESOL_PHOTOS_DIR: '/photos' }, 'linux', '/home/test')

/** An in-memory database with the "Electronics" inventory: see the task brief for what it holds. */
export async function makeContext(options: FixtureOptions = {}): Promise<Fixture> {
  const exec = createPgliteExecutor(new PGlite())
  open.push(exec)
  const { storage } = await openPostgresStorage(exec)
  const apply = async (command: Command) => {
    await storage.apply(command, TEST_ACTOR)
  }
  const ids = {
    passives: newId(),
    resistors: newId(),
    modules: newId(),
    resistance: newId(),
    power: newId(),
    smd: newId(),
    resistor: newId(),
    esp32: newId(),
    v4k7: newId(),
    v10k: newId(),
  }
  const inventoryId = newId()
  const commands: Command[] = [
    { type: 'inventory.create', id: inventoryId, name: 'Electronics', description: null, currency: 'RUB' },
    { type: 'folder.create', id: ids.passives, inventoryId, parentId: null, name: 'Passives', description: null },
    { type: 'folder.create', id: ids.resistors, inventoryId, parentId: ids.passives, name: 'Resistors', description: null },
    { type: 'folder.create', id: ids.modules, inventoryId, parentId: null, name: 'Modules', description: null },
    { type: 'attribute.create', id: ids.resistance, inventoryId, name: 'Resistance', kind: 'number', options: [], unit: 'Ω', siPrefixes: true },
    { type: 'attribute.create', id: ids.power, inventoryId, name: 'Power', kind: 'number', options: [], unit: 'W', siPrefixes: false },
    { type: 'tag.create', id: ids.smd, inventoryId, name: 'SMD' },
    {
      type: 'item.create',
      id: ids.resistor,
      inventoryId,
      folderId: ids.resistors,
      name: 'Resistor 0.25 W',
      description: null,
      unitKey: 'pcs',
      tagIds: [],
      initialReceipt: null,
    },
    { type: 'item.addAxis', itemId: ids.resistor, attributeId: ids.resistance, firstVariantId: newId() },
    {
      type: 'variant.createMany',
      itemId: ids.resistor,
      variants: [
        { id: ids.v4k7, values: [{ attributeId: ids.resistance, value: '4700' }], initialReceipt: { movementId: newId(), quantity: '40' } },
        { id: ids.v10k, values: [{ attributeId: ids.resistance, value: '10000' }] },
      ],
    },
    {
      type: 'item.create',
      id: ids.esp32,
      inventoryId,
      folderId: ids.modules,
      name: 'ESP32 DevKit',
      description: null,
      unitKey: 'pcs',
      tagIds: [ids.smd],
      initialReceipt: { movementId: newId(), quantity: '3', totalPrice: 45000, sourceUrl: 'https://example.com/esp32' },
    },
  ]
  for (const command of commands) await apply(command)
  let secondInventoryId: Id | null = null
  if (options.secondInventory) {
    secondInventoryId = newId()
    await apply({ type: 'inventory.create', id: secondInventoryId, name: 'Workshop', description: null, currency: 'USD' })
    if (options.archiveSecond) await apply({ type: 'archive', target: 'inventory', id: secondInventoryId, archiveId: newId() })
  }
  const source = createSource(storage, options.source)
  const ctx: ToolContext = {
    source,
    storage,
    config: CONFIG,
    actor: () => TEST_ACTOR,
    files: null,
    now: () => new Date('2026-11-15T12:00:00Z'),
  }
  return { ctx, storage, source, inventoryId, secondInventoryId, ids, apply }
}

/** A context without a database, as when the connection key is missing. */
export function disconnectedContext(): ToolContext {
  return { source: null, storage: null, config: readConfig({}, 'linux', '/home/test'), actor: () => TEST_ACTOR, files: null, now: () => new Date() }
}

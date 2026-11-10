import { newId, type Actor, type Command, type InventoryStorage } from '@graymatter/core'
import { createPgliteExecutor, inspectSchema, openPostgresStorage, type PgExecutor } from '@graymatter/storage-postgres'
import { probeWithExecutor, type SourceDriver } from '../sources'
import type { SourceConfig } from '../types'

const DEMO_ACTOR: Actor = { device: 'Demo' }

/** Dev only: PGlite in the browser (idb://graymatter-dev-<sourceId>) or in memory when memory=true; seeds demo data on an empty database. */
export function createDemoDriver(options: { memory?: boolean } = {}): SourceDriver {
  // One in-memory database per source id, so probe and connect see the same data.
  const memoryDbs = new Map<string, Promise<PgExecutor>>()
  const open = async (config: SourceConfig): Promise<PgExecutor> => {
    // Imported lazily so production bundles never include PGlite.
    const { PGlite } = await import('@electric-sql/pglite')
    const db = options.memory ? new PGlite() : new PGlite(`idb://graymatter-dev-${config.id}`)
    return createPgliteExecutor(db)
  }
  const memoryExecutor = (config: SourceConfig): Promise<PgExecutor> => {
    let pending = memoryDbs.get(config.id)
    if (!pending) {
      pending = open(config)
      memoryDbs.set(config.id, pending)
    }
    return pending
  }
  const executorFor = (config: SourceConfig): Promise<PgExecutor> =>
    options.memory ? memoryExecutor(config) : open(config)

  return {
    probe: (config) =>
      probeWithExecutor(async () => {
        const exec = await executorFor(config)
        // In memory mode the database must survive the probe.
        return options.memory ? { ...exec, close: async () => {} } : exec
      }, config),
    async connect(config) {
      const exec = await executorFor(config)
      const wasEmpty = (await inspectSchema(exec)).state === 'empty'
      const { storage, status } = await openPostgresStorage(exec)
      if (wasEmpty) await seedDemo(storage, DEMO_ACTOR)
      return {
        storage,
        status,
        close: async () => {
          memoryDbs.delete(config.id)
          await exec.close()
        },
      }
    },
  }
}

export async function seedDemo(storage: InventoryStorage, actor: Actor): Promise<void> {
  const run = (command: Command): Promise<void> => storage.apply(command, actor)

  const inv = newId()
  await run({ type: 'inventory.create', id: inv, name: 'Electronics', description: null, currency: 'USD' })

  const folder = async (name: string, parentId: string | null = null): Promise<string> => {
    const id = newId()
    await run({ type: 'folder.create', id, inventoryId: inv, parentId, name, description: null })
    return id
  }
  const ics = await folder('ICs')
  const opamps = await folder('Op-amps', ics)
  const passive = await folder('Passive components')
  const resistors = await folder('Resistors', passive)
  await folder('Очень длинное название папки для проверки обрезки на узком экране 🧪')

  const item = async (name: string, folderId: string, receipt: { quantity: string; totalPrice: number | null } | null) => {
    const id = newId()
    await run({
      type: 'item.create',
      id,
      inventoryId: inv,
      folderId,
      name,
      description: null,
      unitKey: 'pcs',
      tagIds: [],
      initialReceipt: receipt ? { movementId: newId(), ...receipt, sourceUrl: null } : null,
    })
    return id
  }

  await item('TL072', opamps, { quantity: '37', totalPrice: 230 })
  await item('LM13700', ics, { quantity: '6', totalPrice: null })
  const ne555 = await item('NE555', ics, { quantity: '5', totalPrice: null })
  await run({ type: 'stock.use', movementId: newId(), itemId: ne555, variantId: null, quantity: '5', note: null })

  const resistor = await item('Резистор 0,25 Вт', resistors, null)
  const variants = ['1k', '10k', '100k'].map((name) => ({ id: newId(), name }))
  await run({ type: 'variant.createMany', itemId: resistor, variants })
  await run({
    type: 'stock.receive',
    movementId: newId(),
    itemId: resistor,
    variantId: variants[1]!.id,
    quantity: '100',
    totalPrice: null,
    sourceUrl: null,
    note: null,
  })

  await run({ type: 'inventory.create', id: newId(), name: 'Workshop', description: null, currency: 'EUR' })
}

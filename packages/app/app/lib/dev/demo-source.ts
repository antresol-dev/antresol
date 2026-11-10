import { newId, type Actor, type Command, type InventoryStorage } from '@graymatter/core'
import { createPgliteExecutor, inspectSchema, openPostgresStorage, type PgExecutor } from '@graymatter/storage-postgres'
import { probeWithExecutor, type SourceDriver } from '../sources'
import type { SourceConfig } from '../types'

const DEMO_ACTOR: Actor = { device: 'Demo' }

/** extras (default true): archived records (this task) and tags and attributes (Task 11) on top of the base data.
 *  Dev only: PGlite in the browser (idb://graymatter-dev-<sourceId>) or in memory when memory=true; seeds demo data on an empty database. */
export function createDemoDriver(options: { memory?: boolean; extras?: boolean } = {}): SourceDriver {
  // One database per source id for the lifetime of the page, shared by probe and every connection:
  // closing a connection must not close the database a newer connection uses.
  const dbs = new Map<string, Promise<PgExecutor>>()
  const executorFor = (config: SourceConfig): Promise<PgExecutor> => {
    let pending = dbs.get(config.id)
    if (!pending) {
      // Imported lazily so production bundles never include PGlite.
      pending = import('@electric-sql/pglite').then(({ PGlite }) => {
        const db = options.memory ? new PGlite() : new PGlite(`idb://graymatter-dev-${config.id}`)
        const exec = createPgliteExecutor(db)
        return { ...exec, close: async () => {} }
      })
      dbs.set(config.id, pending)
    }
    return pending
  }

  return {
    probe: (config) => probeWithExecutor(() => executorFor(config), config),
    async connect(config) {
      const exec = await executorFor(config)
      const wasEmpty = (await inspectSchema(exec)).state === 'empty'
      const { storage, status } = await openPostgresStorage(exec)
      if (wasEmpty) await seedDemo(storage, DEMO_ACTOR, { extras: options.extras ?? true })
      return { storage, status, close: async () => {} }
    },
  }
}

export async function seedDemo(storage: InventoryStorage, actor: Actor, options: { extras?: boolean } = {}): Promise<void> {
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

  if (options.extras ?? true) {
    const archive = (target: 'folder' | 'item' | 'variant' | 'inventory', id: string): Promise<void> =>
      run({ type: 'archive', target, id, archiveId: newId() })
    const old = await folder('Old projects')
    await item('LM741', old, { quantity: '2', totalPrice: null })
    await archive('folder', old)
    await archive('item', await item('CD4017', ics, { quantity: '3', totalPrice: null }))
    await archive('variant', variants[2]!.id)
    const spare = newId()
    await run({ type: 'inventory.create', id: spare, name: 'Archive test', description: null, currency: 'USD' })
    await archive('inventory', spare)
  }
}

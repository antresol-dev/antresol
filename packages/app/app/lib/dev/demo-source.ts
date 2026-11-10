import { newId, type Actor, type Command, type InventoryStorage } from '@graymatter/core'
import { createPgliteExecutor, inspectSchema, openPostgresStorage, type PgExecutor } from '@graymatter/storage-postgres'
import { probeWithExecutor, type SourceConnection, type SourceDriver } from '../sources'
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
      const opening = import('@electric-sql/pglite').then(async ({ PGlite }) => {
        const db = options.memory ? new PGlite() : new PGlite(`idb://graymatter-dev-${config.id}`)
        await db.waitReady
        const exec = createPgliteExecutor(db)
        return { ...exec, close: async () => {} }
      })
      // A failed open is not kept: the next connect or probe tries again.
      opening.catch(() => {
        if (dbs.get(config.id) === opening) dbs.delete(config.id)
      })
      dbs.set(config.id, opening)
      pending = opening
    }
    return pending
  }

  async function open(config: SourceConfig): Promise<SourceConnection> {
    const exec = await executorFor(config)
    const wasEmpty = (await inspectSchema(exec)).state === 'empty'
    const { storage, status } = await openPostgresStorage(exec)
    if (wasEmpty) await seedDemo(storage, DEMO_ACTOR, { extras: options.extras ?? true })
    return { storage, status, inspect: () => inspectSchema(exec), close: async () => {} }
  }

  // Connects of one source run one after another: two at once would both find the database empty,
  // then both migrate and seed it.
  const connects = new Map<string, Promise<unknown>>()

  return {
    probe: (config) => probeWithExecutor(() => executorFor(config), config),
    connect(config) {
      const previous = connects.get(config.id) ?? Promise.resolve()
      const run = previous.catch(() => {}).then(() => open(config))
      connects.set(config.id, run)
      const forget = (): void => {
        if (connects.get(config.id) === run) connects.delete(config.id)
      }
      run.then(forget, forget)
      return run
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

  const tl072 = await item('TL072', opamps, { quantity: '37', totalPrice: 230 })
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
    const audio = newId()
    await run({ type: 'tag.create', id: audio, inventoryId: inv, name: 'audio' })
    await run({ type: 'tag.create', id: newId(), inventoryId: inv, name: 'smd' })
    await run({ type: 'item.update', id: tl072, tagIds: [audio] })
    const pkg = newId()
    await run({ type: 'attribute.create', id: pkg, inventoryId: inv, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'] })
    await run({ type: 'item.setAttribute', itemId: tl072, attributeId: pkg, value: 'DIP-8' })
    const resistance = newId()
    await run({ type: 'attribute.create', id: resistance, inventoryId: inv, name: 'Resistance', kind: 'text', options: [] })
    await run({ type: 'item.setAttribute', itemId: resistor, attributeId: resistance, value: null })
    await run({ type: 'variant.setAttribute', variantId: variants[0]!.id, attributeId: resistance, value: '1 kΩ' })
    await run({ type: 'variant.setAttribute', variantId: variants[1]!.id, attributeId: resistance, value: '10 kΩ' })
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

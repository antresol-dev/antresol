import { BUILTIN_UNITS, DomainError, newId, StorageError, type Command, type Id, type InventorySnapshot, type InventoryStorage } from '@graymatter/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyCounts, countChanges, countRows, type CountIds, type CountRow } from '../app/lib/count-folder'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import type { SourceConfig } from '../app/lib/types'

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}

let storage: InventoryStorage
let inventoryId: string
let s: InventorySnapshot

const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  storage = (await driver.connect(cfg)).storage
  inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  s = await storage.loadInventory(inventoryId)
})

const run = async (command: Command): Promise<void> => {
  await storage.apply(command, { device: 'Test' })
  s = await storage.loadInventory(inventoryId)
}

let made = 0
async function newFolder(parentId: string | null = null): Promise<string> {
  const id = newId()
  await run({ type: 'folder.create', id, inventoryId, parentId, name: `Count ${++made}`, description: null })
  return id
}
async function newItem(folderId: string, name: string, options: { unitKey?: string; receipt?: string; variants?: string[] } = {}) {
  const id = newId()
  await run({
    type: 'item.create',
    id,
    inventoryId,
    folderId,
    name,
    description: null,
    unitKey: options.unitKey ?? 'pcs',
    tagIds: [],
    initialReceipt: options.receipt ? { movementId: newId(), quantity: options.receipt, totalPrice: null, sourceUrl: null } : null,
  })
  const variants = (options.variants ?? []).map((label) => ({ id: newId(), label }))
  if (variants.length > 0) {
    const axis = newId()
    await run({ type: 'attribute.create', id: axis, inventoryId, name: `Axis ${++made}`, kind: 'text', options: [], unit: '', siPrefixes: false })
    await run({ type: 'item.addAxis', itemId: id, attributeId: axis, firstVariantId: variants[0]!.id })
    await run({
      type: 'variant.createMany',
      itemId: id,
      variants: variants.map((v) => ({ id: v.id, values: [{ attributeId: axis, value: v.label }] })),
    })
  }
  return { id, v: Object.fromEntries(variants.map((x) => [x.label, x.id])) as Record<string, Id> }
}

describe('countRows', () => {
  it('lists the folder’s items by name, each variant a row, without the items of subfolders', async () => {
    const folder = await newFolder()
    const sub = await newFolder(folder)
    await newItem(sub, 'Hidden', { receipt: '9' })
    const wire = await newItem(folder, 'Wire', { unitKey: 'm', receipt: '2.5' })
    const res = await newItem(folder, 'Resistor', { variants: ['1k', '10k'] })
    await run({ type: 'stock.receive', movementId: newId(), itemId: res.id, variantId: res.v['10k']!, quantity: '40', totalPrice: null, sourceUrl: null, note: null })
    const rows = countRows(s, folder)!
    expect(rows.map((r) => [r.itemName, r.variantName, r.quantity, r.first])).toEqual([
      ['Resistor', '1k', '0', true],
      ['Resistor', '10k', '40', false],
      ['Wire', null, '2.5', true],
    ])
    expect(rows[2]).toMatchObject({ key: `${wire.id}:`, itemId: wire.id, variantId: null, number: '2.5', unit: 'm', hasVariants: false })
    expect(rows[1]).toMatchObject({ key: `${res.id}:${res.v['10k']}`, hasVariants: true })
  })

  it('is null for a missing or archived folder', async () => {
    expect(countRows(s, newId())).toBeNull()
    const folder = await newFolder()
    await run({ type: 'archive', target: 'folder', id: folder, archiveId: newId() })
    expect(countRows(s, folder)).toBeNull()
  })
})

describe('countChanges', () => {
  const row = (key: string, quantity: string): CountRow => ({
    key,
    itemId: key,
    variantId: null,
    itemName: key,
    variantName: null,
    hasVariants: false,
    first: true,
    quantity,
    number: quantity,
    unit: 'pcs',
    unitDef: BUILTIN_UNITS.pcs,
  })

  it('only rows whose entry differs from the stock, in row order; a bad entry has no target', () => {
    const rows = [row('a', '5'), row('b', '7'), row('c', '0'), row('d', '3')]
    const edits = new Map([
      ['d', '4'],
      ['a', '5'],
      ['b', 'lots'],
      ['c', ' 1.5k '],
    ])
    expect(countChanges(rows, edits).map((c) => [c.row.key, c.target])).toEqual([
      ['b', null],
      ['c', '1500'],
      ['d', '4'],
    ])
  })

  it('an empty entry is a bad entry, a negative one too', () => {
    const rows = [row('a', '5'), row('b', '5')]
    expect(countChanges(rows, new Map([['a', ''], ['b', '-1']])).map((c) => c.target)).toEqual([null, null])
  })
})

describe('applyCounts', () => {
  const row = (key: string): CountRow => ({
    key,
    itemId: `item-${key}`,
    variantId: key === 'v' ? 'var-1' : null,
    itemName: key,
    variantName: null,
    hasVariants: false,
    first: true,
    quantity: '1',
    number: '1',
    unit: 'pcs',
    unitDef: BUILTIN_UNITS.pcs,
  })

  it('sends one stock.set per change in order, each with its own id, and renews the ids that landed', async () => {
    const sent: Command[] = []
    const ids: CountIds = new Map()
    const progress: number[] = []
    const result = await applyCounts(
      [{ row: row('a'), target: '3' }, { row: row('v'), target: '0' }],
      ids,
      async (c) => {
        sent.push(c)
      },
      (done) => progress.push(done),
    )
    expect(sent).toEqual([
      { type: 'stock.set', movementId: expect.any(String), itemId: 'item-a', variantId: null, target: '3', note: null },
      { type: 'stock.set', movementId: expect.any(String), itemId: 'item-v', variantId: 'var-1', target: '0', note: null },
    ])
    expect(new Set(sent.map((c) => (c as { movementId: Id }).movementId)).size).toBe(2)
    expect(progress).toEqual([1, 2])
    expect(result).toEqual({ done: 2, failed: null })
    expect(ids.size).toBe(0)
  })

  it('stops at a failure: what landed stays, the failed row keeps its id, and a retry sends it again with it', async () => {
    const sent: Command[] = []
    const ids: CountIds = new Map()
    const failure = new StorageError('unavailable')
    let failOn: string | null = 'item-b'
    const apply = async (c: Command): Promise<void> => {
      sent.push(c)
      if (c.type === 'stock.set' && c.itemId === failOn) throw failure
    }
    const changes = [row('a'), row('b'), row('c')].map((r) => ({ row: r, target: '2' }))
    const first = await applyCounts(changes, ids, apply)
    expect(first).toEqual({ done: 1, failed: { key: 'b', error: failure } })
    expect(sent.map((c) => (c as { itemId: Id }).itemId)).toEqual(['item-a', 'item-b'])
    const failedId = (sent[1] as { movementId: Id }).movementId
    expect(ids.get('b')).toEqual({ target: '2', movementId: failedId })

    failOn = null
    const again = await applyCounts(changes.slice(1), ids, apply)
    expect(again).toEqual({ done: 2, failed: null })
    expect((sent[2] as { movementId: Id }).movementId).toBe(failedId)
    expect(ids.size).toBe(0)
  })

  it('the id follows the target: a row counted again with another number after a failure is a new command', async () => {
    const sent: Command[] = []
    const ids: CountIds = new Map()
    const failure = new StorageError('unavailable')
    let failing = true
    const apply = async (c: Command): Promise<void> => {
      sent.push(c)
      if (failing) throw failure
    }
    const idOf = (c: Command | undefined) => (c as { movementId: Id }).movementId
    await applyCounts([{ row: row('a'), target: '5' }], ids, apply)
    // The same number again: the same command (if the first one landed unseen, the source skips it).
    await applyCounts([{ row: row('a'), target: '5.0' }], ids, apply)
    expect(idOf(sent[1])).toBe(idOf(sent[0]))
    // Another number: a new id, so it is written even if the first count landed (stock.set is absolute).
    failing = false
    expect(await applyCounts([{ row: row('a'), target: '6' }], ids, apply)).toEqual({ done: 1, failed: null })
    expect(idOf(sent[2])).not.toBe(idOf(sent[0]))
    expect(sent[2]).toMatchObject({ type: 'stock.set', target: '6' })
    expect(ids.size).toBe(0)
  })

  it('reports a refusal of the source like any other failure', async () => {
    const refused = new DomainError('not_found')
    const result = await applyCounts([{ row: row('a'), target: '1' }], new Map(), async () => {
      throw refused
    })
    expect(result).toEqual({ done: 0, failed: { key: 'a', error: refused } })
  })
})

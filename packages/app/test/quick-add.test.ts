import { newId, type Command, type Id, type InventorySnapshot, type InventoryStorage } from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { buildQuickAdd, existingMatches, type QuickAddInput } from '../app/lib/quick-add'
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
let snap: InventorySnapshot
let ics: Id

// One database for the file, closed at the end.
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  const conn = await driver.connect(cfg)
  storage = conn.storage
  const id = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  snap = await storage.loadInventory(id)
  ics = snap.folders.find((f) => f.name === 'ICs')!.id
})

const ids = { itemId: newId(), movementId: newId() }
const input = (over: Partial<QuickAddInput> = {}): QuickAddInput => ({
  folderId: ics,
  name: 'TL074',
  unitKey: 'pcs',
  amount: '',
  price: '',
  url: '',
  ...over,
})

describe('buildQuickAdd', () => {
  it('creates an item without a receipt when no amount is given', () => {
    const r = buildQuickAdd(input({ name: '  TL074 ' }), snap, ids)
    expect(r).toHaveProperty('command')
    if (!('command' in r)) return
    expect(r.command).toMatchObject({
      type: 'item.create',
      name: 'TL074',
      folderId: ics,
      unitKey: 'pcs',
      tagIds: [],
      description: null,
      inventoryId: snap.inventory.id,
      initialReceipt: null,
    })
  })

  it('reads expressions in the amount and the price', () => {
    const r = buildQuickAdd(input({ amount: '5x100', price: '10/4' }), snap, ids)
    expect('command' in r && r.command.initialReceipt).toMatchObject({ quantity: '500', totalPrice: 250 })
    expect(buildQuickAdd(input({ amount: '5x' }), snap, ids)).toEqual({ errorKey: 'quickAdd.invalidAmount' })
  })

  it('adds a first receipt with the batch price and link', () => {
    const r = buildQuickAdd(input({ amount: '37', price: '2.30', url: ' https://shop.example/x ' }), snap, ids)
    if (!('command' in r)) throw new Error('expected a command')
    expect(r.command.initialReceipt).toMatchObject({ quantity: '37', totalPrice: 230, sourceUrl: 'https://shop.example/x' })
    expect(r.command.initialReceipt!.movementId).toBeTruthy()
  })

  it('leaves the price and link empty when blank', () => {
    const r = buildQuickAdd(input({ amount: '5', url: '  ' }), snap, ids)
    if (!('command' in r)) throw new Error('expected a command')
    expect(r.command.initialReceipt).toMatchObject({ quantity: '5', totalPrice: null, sourceUrl: null })
  })

  it('reads the amount in the chosen unit with a prefix', () => {
    const r = buildQuickAdd(input({ unitKey: 'm', amount: '50cm' }), snap, ids)
    if (!('command' in r)) throw new Error('expected a command')
    expect(r.command.unitKey).toBe('m')
    expect(r.command.initialReceipt?.quantity).toBe('0.5')
  })

  it('treats 0 as no amount', () => {
    const r = buildQuickAdd(input({ amount: '0' }), snap, ids)
    if (!('command' in r)) throw new Error('expected a command')
    expect(r.command.initialReceipt).toBeNull()
  })

  it('refuses a price or link without an amount', () => {
    expect(buildQuickAdd(input({ price: '2' }), snap, ids)).toEqual({ errorKey: 'quickAdd.needsAmount' })
    expect(buildQuickAdd(input({ url: 'https://x.example' }), snap, ids)).toEqual({ errorKey: 'quickAdd.needsAmount' })
    // A link prefilled from the share sheet and left alone does not demand an amount; one the person edited does.
    const shared = buildQuickAdd(input({ url: 'https://x.example', prefilledUrl: 'https://x.example' }), snap, ids)
    expect('command' in shared && shared.command.initialReceipt).toBeNull()
    expect(buildQuickAdd(input({ url: 'https://y.example', prefilledUrl: 'https://x.example' }), snap, ids)).toEqual({ errorKey: 'quickAdd.needsAmount' })
    expect(buildQuickAdd(input({ price: '2', url: 'https://x.example', prefilledUrl: 'https://x.example' }), snap, ids)).toEqual({ errorKey: 'quickAdd.needsAmount' })
  })

  it('refuses an invalid amount or price', () => {
    expect(buildQuickAdd(input({ amount: 'abc' }), snap, ids)).toEqual({ errorKey: 'quickAdd.invalidAmount' })
    expect(buildQuickAdd(input({ amount: '1', price: '1.234' }), snap, ids)).toEqual({ errorKey: 'quickAdd.invalidPrice' })
  })

  it('refuses an empty name', () => {
    expect(buildQuickAdd(input({ name: '   ' }), snap, ids)).toEqual({ errorKey: 'errors.domain.name_required' })
  })

  it('uses the ids it is given, so a retried Save sends the same command', () => {
    const a = buildQuickAdd(input({ amount: '2' }), snap, ids)
    const b = buildQuickAdd(input({ amount: '2' }), snap, ids)
    expect(a).toEqual(b)
    expect('command' in a && a.command).toMatchObject({ id: ids.itemId, initialReceipt: { movementId: ids.movementId } })
  })

  it('a retried submit after a timeout creates no second item', async () => {
    const retryIds = { itemId: newId(), movementId: newId() }
    const first = buildQuickAdd(input({ name: 'Retry me', amount: '4' }), snap, retryIds)
    const second = buildQuickAdd(input({ name: 'Retry me', amount: '4' }), snap, retryIds)
    if (!('command' in first) || !('command' in second)) throw new Error('expected commands')
    await storage.apply(first.command, { device: 'Test' })
    await storage.apply(second.command, { device: 'Test' })
    const after = await storage.loadInventory(snap.inventory.id)
    expect(after.items.filter((i) => i.name === 'Retry me')).toHaveLength(1)
    const line = after.stock.filter((l) => l.itemId === retryIds.itemId)
    expect(line).toHaveLength(1)
    expect(line[0]!.quantity).toBe('4')
  })

  it('makes commands storage accepts', async () => {
    const r = buildQuickAdd(input({ name: `Quick ${newId()}`, amount: '3', price: '1.50', url: 'https://shop.example/y' }), snap, ids)
    if (!('command' in r)) throw new Error('expected a command')
    await storage.apply(r.command, { device: 'Test' })
    const after = await storage.loadInventory(snap.inventory.id)
    expect(after.items.some((i) => i.id === r.command.id)).toBe(true)
  })
})

describe('existingMatches', () => {
  let s: InventorySnapshot
  const add = (name: string, folderId: Id | null, quantity: string | null): Command => ({
    type: 'item.create',
    id: newId(),
    inventoryId: snap.inventory.id,
    folderId,
    name,
    description: null,
    unitKey: 'pcs',
    tagIds: [],
    initialReceipt: quantity ? { movementId: newId(), quantity, totalPrice: null, sourceUrl: null } : null,
  })

  beforeAll(async () => {
    const opamps = snap.folders.find((f) => f.name === 'Op-amps')!.id
    for (const c of [add('NE5532P', opamps, '4'), add('TL072CP', opamps, '12'), add('TL074', opamps, '3'), { ...add('OPA2134', opamps, '2'), description: 'Dual op amp, DIP-8' } as Command]) {
      await storage.apply(c, { device: 'Test' })
    }
    s = await storage.loadInventory(snap.inventory.id)
  })

  const names = (rows: { name: string; variantName: string | null }[]) =>
    rows.map((r) => (r.variantName ? `${r.name} · ${r.variantName}` : r.name))

  it('finds an item whose name starts with what is typed, with its folder and stock', () => {
    const [row] = existingMatches('ne5532', s)
    expect(row).toMatchObject({ name: 'NE5532P', path: 'ICs / Op-amps', number: '4', unit: 'pcs', amount: '4 pcs' })
  })

  it('finds both ways by the part number: TL072 ↔ TL072CP, but never TL074', () => {
    expect(names(existingMatches('tl072', s))).toEqual(['TL072', 'TL072CP'])
    expect(names(existingMatches('TL072CP', s))).toEqual(['TL072CP', 'TL072'])
    expect(names(existingMatches('TL072CN', s))).toEqual(['TL072', 'TL072CP'])
  })

  it('finds a variant by a value read by its attribute rules', () => {
    const rows = existingMatches('10k', s)
    expect(names(rows)[0]).toBe('Резистор 0,25 Вт · 10 kΩ')
    expect(rows[0]!.number).toBe('100')
    expect(names(existingMatches('10000', s))[0]).toBe('Резистор 0,25 Вт · 10 kΩ')
  })

  it('makes no guesses: no fuzzy hits, nothing for a blank or one-letter name', () => {
    expect(existingMatches('tl073', s)).toEqual([])
    expect(existingMatches('ne5533', s)).toEqual([])
    expect(existingMatches('   ', s)).toEqual([])
    expect(existingMatches('t', s)).toEqual([])
  })

  it('with every word required, finds only items that match all of them', () => {
    const every = { everyWord: true }
    // Not a match that merely shares one word or an attribute value (any-word search does find one).
    expect(existingMatches('LM358 DIP-8', s, 3).length).toBeGreaterThan(0)
    expect(existingMatches('LM358 DIP-8', s, 3, every)).toEqual([])
    expect(names(existingMatches('ne5532', s, 3, every))).toEqual(['NE5532P'])
    expect(names(existingMatches('tl072', s, 3, every))).toEqual(['TL072', 'TL072CP'])
    expect(names(existingMatches('NE5532P Op-amp', s, 3, every))).toEqual([])
    // The share sheet keeps any-word matching for its long titles.
    expect(names(existingMatches('NE5532P DIP-8 lot', s))).toContain('NE5532P')
  })

  it('returns at most `limit` rows', () => {
    expect(existingMatches('tl07', s)).toHaveLength(3)
    expect(existingMatches('tl07', s, 2)).toHaveLength(2)
  })
})

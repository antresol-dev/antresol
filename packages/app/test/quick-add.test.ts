import { newId, type Id, type InventorySnapshot, type InventoryStorage } from '@graymatter/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { buildQuickAdd, type QuickAddInput } from '../app/lib/quick-add'
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

beforeAll(async () => {
  const conn = await createDemoDriver({ memory: true, extras: false }).connect(cfg)
  storage = conn.storage
  const id = (await storage.listInventories()).find((i) => i.name === 'Electronics')!.id
  snap = await storage.loadInventory(id)
  ics = snap.folders.find((f) => f.name === 'ICs')!.id
})

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
    const r = buildQuickAdd(input({ name: '  TL074 ' }), snap)
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

  it('adds a first receipt with the batch price and link', () => {
    const r = buildQuickAdd(input({ amount: '37', price: '2.30', url: ' https://shop.example/x ' }), snap)
    if (!('command' in r)) throw new Error('expected a command')
    expect(r.command.initialReceipt).toMatchObject({ quantity: '37', totalPrice: 230, sourceUrl: 'https://shop.example/x' })
    expect(r.command.initialReceipt!.movementId).toBeTruthy()
  })

  it('leaves the price and link empty when blank', () => {
    const r = buildQuickAdd(input({ amount: '5', url: '  ' }), snap)
    if (!('command' in r)) throw new Error('expected a command')
    expect(r.command.initialReceipt).toMatchObject({ quantity: '5', totalPrice: null, sourceUrl: null })
  })

  it('reads the amount in the chosen unit with a prefix', () => {
    const r = buildQuickAdd(input({ unitKey: 'm', amount: '50cm' }), snap)
    if (!('command' in r)) throw new Error('expected a command')
    expect(r.command.unitKey).toBe('m')
    expect(r.command.initialReceipt?.quantity).toBe('0.5')
  })

  it('treats 0 as no amount', () => {
    const r = buildQuickAdd(input({ amount: '0' }), snap)
    if (!('command' in r)) throw new Error('expected a command')
    expect(r.command.initialReceipt).toBeNull()
  })

  it('refuses a price or link without an amount', () => {
    expect(buildQuickAdd(input({ price: '2' }), snap)).toEqual({ errorKey: 'quickAdd.needsAmount' })
    expect(buildQuickAdd(input({ url: 'https://x.example' }), snap)).toEqual({ errorKey: 'quickAdd.needsAmount' })
  })

  it('refuses an invalid amount or price', () => {
    expect(buildQuickAdd(input({ amount: 'abc' }), snap)).toEqual({ errorKey: 'quickAdd.invalidAmount' })
    expect(buildQuickAdd(input({ amount: '1', price: '1.234' }), snap)).toEqual({ errorKey: 'quickAdd.invalidPrice' })
  })

  it('refuses an empty name', () => {
    expect(buildQuickAdd(input({ name: '   ' }), snap)).toEqual({ errorKey: 'errors.domain.name_required' })
  })

  it('makes commands storage accepts', async () => {
    const r = buildQuickAdd(input({ name: `Quick ${newId()}`, amount: '3', price: '1.50', url: 'https://shop.example/y' }), snap)
    if (!('command' in r)) throw new Error('expected a command')
    await storage.apply(r.command, { device: 'Test' })
    const after = await storage.loadInventory(snap.inventory.id)
    expect(after.items.some((i) => i.id === r.command.id)).toBe(true)
  })
})

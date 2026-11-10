import { itemStock, newId, type Command, type InventorySnapshot, type InventoryStorage } from '@graymatter/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { itemView, journalRows } from '../app/lib/item-view'
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
let tl072: string
let ne555: string
let resistor: string

beforeEach(async () => {
  storage = (await createDemoDriver({ memory: true, extras: false }).connect(cfg)).storage
  inventoryId = (await storage.listInventories()).find((i) => i.name === 'Electronics')!.id
  s = await storage.loadInventory(inventoryId)
  tl072 = itemId('TL072')
  ne555 = itemId('NE555')
  resistor = itemId('Резистор 0,25 Вт')
})

const run = async (command: Command): Promise<void> => {
  await storage.apply(command, { device: 'Test' })
  s = await storage.loadInventory(inventoryId)
}
function itemId(name: string): string {
  return s.items.find((i) => i.name === name)!.id
}
const folderId = (name: string): string => s.folders.find((f) => f.name === name)!.id
const variantId = (name: string): string => s.variants.find((v) => v.itemId === resistor && v.name === name)!.id
const archive = (target: 'folder' | 'item' | 'variant', id: string): Promise<void> => run({ type: 'archive', target, id, archiveId: newId() })
const receive = (itemId: string, variantId: string | null, quantity: string, totalPrice: number | null = null): Promise<void> =>
  run({ type: 'stock.receive', movementId: newId(), itemId, variantId, quantity, totalPrice, sourceUrl: null, note: null })

describe('itemView', () => {
  it('returns null for a missing or archived item, or one under an archived folder', async () => {
    expect(itemView(s, newId())).toBeNull()
    expect(itemView(s, tl072)).not.toBeNull()
    await archive('item', tl072)
    expect(itemView(s, tl072)).toBeNull()
    expect(itemView(s, resistor)).not.toBeNull()
    await archive('folder', folderId('Passive components'))
    expect(itemView(s, resistor)).toBeNull()
  })

  it('describes the item: folder path, unit and currency', async () => {
    const v = itemView(s, resistor)!
    expect(v.item.id).toBe(resistor)
    expect(v.crumbs.map((c) => c.name)).toEqual(['Passive components', 'Resistors'])
    expect(v.crumbs.map((c) => c.id)).toEqual([folderId('Passive components'), folderId('Resistors')])
    expect(v.unit.key).toBe('pcs')
    expect(v.currency).toBe('USD')
    expect(v.hasVariants).toBe(true)
    expect(itemView(s, tl072)!.hasVariants).toBe(false)

    const rootItem = newId()
    await run({
      type: 'item.create',
      id: rootItem,
      inventoryId,
      folderId: null,
      name: 'Solder',
      description: null,
      unitKey: 'g',
      tagIds: [],
      initialReceipt: null,
    })
    expect(itemView(s, rootItem)).toMatchObject({ crumbs: [], unit: { key: 'g' } })
  })

  it('totals match core itemStock for every item, archived variants excluded', async () => {
    await receive(resistor, variantId('1k'), '10', 50)
    await receive(resistor, variantId('100k'), '7', 700)
    await archive('variant', variantId('100k'))
    const r = itemView(s, resistor)!
    expect(r.total).toMatchObject({ quantity: '110', number: '110', unit: 'pcs', outOfStock: false, avgUnitPrice: 5, lastUnitPrice: 5 })
    for (const item of s.items.filter((i) => i.archivedAt === null)) {
      const v = itemView(s, item.id)!
      const core = itemStock(s, item.id)
      expect([v.total.quantity, v.total.avgUnitPrice, v.total.lastUnitPrice]).toEqual([core.quantity, core.avgUnitPrice, core.lastUnitPrice])
    }
    expect(itemView(s, ne555)!.total).toMatchObject({ quantity: '0', number: '0', outOfStock: true, avgUnitPrice: null, lastUnitPrice: null })
    expect(itemView(s, tl072)!.total).toMatchObject({ number: '37', avgUnitPrice: 230 / 37, lastUnitPrice: 230 / 37 })
  })

  it('shows the no-variant stock only without variants or when it is not zero', async () => {
    expect(itemView(s, tl072)!.buckets.map((b) => b.name)).toEqual([null])
    expect(itemView(s, ne555)!.buckets).toMatchObject([{ variantId: null, name: null, quantity: '0', outOfStock: true, values: [] }])
    expect(itemView(s, resistor)!.buckets.map((b) => b.name)).toEqual(['1k', '10k', '100k'])
    await receive(resistor, null, '3', 30)
    expect(itemView(s, resistor)!.buckets.map((b) => b.name)).toEqual([null, '1k', '10k', '100k'])
    await archive('variant', variantId('100k'))
    const buckets = itemView(s, resistor)!.buckets
    expect(buckets.map((b) => b.name)).toEqual([null, '1k', '10k'])
    expect(buckets.map((b) => [b.number, b.outOfStock])).toEqual([['3', false], ['0', true], ['100', false]])
    expect(buckets[0]).toMatchObject({ variantId: null, avgUnitPrice: 10, lastUnitPrice: 10 })
    expect(buckets[2]).toMatchObject({ variantId: variantId('10k'), avgUnitPrice: null, lastUnitPrice: null })
  })

  it('orders variants by position', async () => {
    await run({ type: 'variant.createMany', itemId: resistor, variants: [{ id: newId(), name: '0R' }] })
    expect(itemView(s, resistor)!.buckets.map((b) => b.name)).toEqual(['1k', '10k', '100k', '0R'])
  })

  it('marks an attribute per-variant when the item value is empty and the item has variants', async () => {
    const resistance = newId()
    await run({ type: 'attribute.create', id: resistance, inventoryId, name: 'Resistance', kind: 'text', options: [] })
    await run({ type: 'item.setAttribute', itemId: resistor, attributeId: resistance, value: null })
    await run({ type: 'variant.setAttribute', variantId: variantId('10k'), attributeId: resistance, value: '10 kΩ' })
    expect(itemView(s, resistor)!.attributes).toMatchObject([{ name: 'Resistance', perVariant: true, value: null }])
    const buckets = itemView(s, resistor)!.buckets
    expect(buckets.find((b) => b.name === '10k')!.values).toEqual([{ attributeId: expect.any(String), name: 'Resistance', value: '10 kΩ' }])
    expect(buckets.find((b) => b.name === '1k')!.values).toEqual([{ attributeId: resistance, name: 'Resistance', value: null }])

    // Without variants an empty value is just empty, and a shared value is never per-variant.
    await run({ type: 'item.setAttribute', itemId: tl072, attributeId: resistance, value: null })
    expect(itemView(s, tl072)!.attributes).toMatchObject([{ name: 'Resistance', perVariant: false, value: null }])
    await run({ type: 'item.setAttribute', itemId: resistor, attributeId: resistance, value: 'mixed' })
    const shared = itemView(s, resistor)!
    expect(shared.attributes).toMatchObject([{ perVariant: false, value: 'mixed' }])
    expect(shared.buckets.every((b) => b.values.length === 0)).toBe(true)
  })

  it('sorts attributes by name and keeps the options of a list attribute', async () => {
    const pkg = newId()
    const notes = newId()
    await run({ type: 'attribute.create', id: pkg, inventoryId, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'] })
    await run({ type: 'attribute.create', id: notes, inventoryId, name: 'Notes', kind: 'text', options: [] })
    await run({ type: 'item.setAttribute', itemId: tl072, attributeId: pkg, value: 'DIP-8' })
    await run({ type: 'item.setAttribute', itemId: tl072, attributeId: notes, value: 'dual' })
    expect(itemView(s, tl072)!.attributes).toEqual([
      { attributeId: notes, name: 'Notes', kind: 'text', options: [], value: 'dual', perVariant: false },
      { attributeId: pkg, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'], value: 'DIP-8', perVariant: false },
    ])
  })

  it('resolves tag names in name order', async () => {
    const smd = newId()
    const audio = newId()
    await run({ type: 'tag.create', id: smd, inventoryId, name: 'smd' })
    await run({ type: 'tag.create', id: audio, inventoryId, name: 'audio' })
    await run({ type: 'item.update', id: tl072, tagIds: [smd, audio] })
    expect(itemView(s, tl072)!.tags).toEqual([
      { id: audio, name: 'audio' },
      { id: smd, name: 'smd' },
    ])
    expect(itemView(s, ne555)!.tags).toEqual([])
  })
})

describe('journalRows', () => {
  it('signs journal quantities and keeps newest first', async () => {
    const movements = await storage.loadMovements(ne555)
    const rows = journalRows(s, ne555, movements)
    expect(rows.map((r) => [r.kind, r.number])).toEqual([['usage', '−5'], ['receipt', '+5']])
    expect(rows[0]).toMatchObject({ id: movements[0]!.id, unit: 'pcs', variantName: null, transfer: null, by: 'Demo' })
    expect(rows[0]!.at).toBe(movements[0]!.createdAt)
  })

  it('carries the batch price, link, note and variant name of a movement', async () => {
    await run({
      type: 'stock.receive',
      movementId: newId(),
      itemId: resistor,
      variantId: variantId('1k'),
      quantity: '20',
      totalPrice: 199,
      sourceUrl: 'https://shop.example/r',
      note: 'reel',
    })
    const rows = journalRows(s, resistor, await storage.loadMovements(resistor))
    expect(rows[0]).toMatchObject({
      kind: 'receipt',
      number: '+20',
      variantName: '1k',
      totalPrice: 199,
      sourceUrl: 'https://shop.example/r',
      note: 'reel',
      transfer: null,
    })
  })

  it('joins the two halves of a transfer into one row', async () => {
    await receive(resistor, null, '3')
    await run({
      type: 'stock.transfer',
      transferId: newId(),
      outMovementId: newId(),
      inMovementId: newId(),
      itemId: resistor,
      fromVariantId: null,
      toVariantId: variantId('1k'),
      quantity: '3',
    })
    const movements = await storage.loadMovements(resistor)
    const rows = journalRows(s, resistor, movements)
    const transferId = movements[0]!.transferId
    expect(rows[0]).toMatchObject({ id: transferId, kind: 'transfer', number: '3', transfer: { from: null, to: '1k' } })
    expect(rows.filter((r) => r.kind === 'transfer')).toHaveLength(1)
    expect(rows.map((r) => [r.kind, r.number])).toEqual([['transfer', '3'], ['receipt', '+3'], ['receipt', '+100']])
  })

  it('names both variants of a transfer between variants, archived ones too', async () => {
    await run({
      type: 'stock.transfer',
      transferId: newId(),
      outMovementId: newId(),
      inMovementId: newId(),
      itemId: resistor,
      fromVariantId: variantId('10k'),
      toVariantId: variantId('100k'),
      quantity: '40',
    })
    await archive('variant', variantId('100k'))
    const rows = journalRows(s, resistor, await storage.loadMovements(resistor))
    expect(rows[0]).toMatchObject({ kind: 'transfer', number: '40', transfer: { from: '10k', to: '100k' } })
  })

  it('formats journal amounts with the item unit and its prefixes', async () => {
    const wire = newId()
    await run({
      type: 'item.create',
      id: wire,
      inventoryId,
      folderId: null,
      name: 'Wire',
      description: null,
      unitKey: 'm',
      tagIds: [],
      initialReceipt: { movementId: newId(), quantity: '0.5', totalPrice: null, sourceUrl: null },
    })
    await run({ type: 'stock.use', movementId: newId(), itemId: wire, variantId: null, quantity: '0.25', note: null })
    const rows = journalRows(s, wire, await storage.loadMovements(wire))
    expect(rows.map((r) => [r.number, r.unit])).toEqual([['−25', 'cm'], ['+50', 'cm']])
  })

  it('writes an adjustment of the difference with its sign', async () => {
    await run({ type: 'stock.set', movementId: newId(), itemId: tl072, variantId: null, target: '40', note: null })
    await run({ type: 'stock.set', movementId: newId(), itemId: tl072, variantId: null, target: '35', note: null })
    const rows = journalRows(s, tl072, await storage.loadMovements(tl072))
    expect(rows.map((r) => [r.kind, r.number])).toEqual([['adjustment', '−5'], ['adjustment', '+3'], ['receipt', '+37']])
  })
})

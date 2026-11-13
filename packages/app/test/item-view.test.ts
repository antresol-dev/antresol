import { itemStock, newId, type Command, type InventorySnapshot, type InventoryStorage, type Movement } from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { attributeChoices, bucketDescription, itemView, journalDays, journalRows, looseTransferOffer, type JournalRow } from '../app/lib/item-view'
import type { SourceConfig } from '../app/lib/types'

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}

// One seeded source for the whole file: seeding is the slow part. The demo items are only read;
// every test that writes creates its own items, folders, attributes and tags, so tests stay independent.
let storage: InventoryStorage
let inventoryId: string
let s: InventorySnapshot
let tl072: string
let ne555: string
let resistor: string

const demoItem = (name: string): string => s.items.find((i) => i.name === name)!.id

// One database for the file, closed at the end.
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  storage = (await driver.connect(cfg)).storage
  inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  s = await storage.loadInventory(inventoryId)
  tl072 = demoItem('TL072')
  ne555 = demoItem('NE555')
  resistor = demoItem('Резистор 0,25 Вт')
})

const run = async (command: Command): Promise<void> => {
  await storage.apply(command, { device: 'Test' })
  s = await storage.loadInventory(inventoryId)
}
const archive = (target: 'folder' | 'item' | 'variant', id: string): Promise<void> => run({ type: 'archive', target, id, archiveId: newId() })
const receive = (itemId: string, variantId: string | null, quantity: string, totalPrice: number | null = null): Promise<void> =>
  run({ type: 'stock.receive', movementId: newId(), itemId, variantId, quantity, totalPrice, sourceUrl: null, note: null })
const transfer = (itemId: string, fromVariantId: string | null, toVariantId: string | null, quantity: string): Promise<void> =>
  run({ type: 'stock.transfer', transferId: newId(), outMovementId: newId(), inMovementId: newId(), itemId, fromVariantId, toVariantId, quantity })

let made = 0
async function newFolder(parentId: string | null = null): Promise<string> {
  const id = newId()
  await run({ type: 'folder.create', id, inventoryId, parentId, name: `Folder ${++made}`, description: null })
  return id
}
/** A fresh item with its own variants (label → id); no folder means the inventory root. */
async function newItem(
  options: { folderId?: string | null; unitKey?: string; variants?: string[]; receipt?: string } = {},
): Promise<{ id: string; v: Record<string, string> }> {
  const id = newId()
  await run({
    type: 'item.create',
    id,
    inventoryId,
    folderId: options.folderId ?? null,
    name: `Item ${++made}`,
    description: null,
    unitKey: options.unitKey ?? 'pcs',
    tagIds: [],
    initialReceipt: options.receipt ? { movementId: newId(), quantity: options.receipt, totalPrice: null, sourceUrl: null } : null,
  })
  const names = options.variants ?? []
  const variants = names.map((name) => ({ id: newId(), name }))
  if (variants.length > 0) {
    // The variants differ by one text attribute, so a variant's label is its name.
    const axis = newId()
    await run({ type: 'attribute.create', id: axis, inventoryId, name: `Value ${made}`, kind: 'text', options: [], unit: '', siPrefixes: false })
    await run({ type: 'item.addAxis', itemId: id, attributeId: axis, firstVariantId: variants[0]!.id })
    await run({
      type: 'variant.createMany',
      itemId: id,
      variants: variants.map((x) => ({ id: x.id, values: [{ attributeId: axis, value: x.name }] })),
    })
  }
  return { id, v: Object.fromEntries(variants.map((x) => [x.name, x.id])) }
}

describe('itemView', () => {
  it('returns null for a missing or archived item, or one under an archived folder', async () => {
    expect(itemView(s, newId())).toBeNull()
    const loose = await newItem()
    expect(itemView(s, loose.id)).not.toBeNull()
    await archive('item', loose.id)
    expect(itemView(s, loose.id)).toBeNull()

    const outer = await newFolder()
    const inner = await newFolder(outer)
    const nested = await newItem({ folderId: inner })
    expect(itemView(s, nested.id)).not.toBeNull()
    await archive('folder', outer)
    expect(itemView(s, nested.id)).toBeNull()
  })

  it('describes the item: folder path, unit and currency', async () => {
    const v = itemView(s, resistor)!
    expect(v.item.id).toBe(resistor)
    expect(v.crumbs.map((c) => c.name)).toEqual(['Passive components', 'Resistors'])
    const folder = (name: string): string => s.folders.find((f) => f.name === name)!.id
    expect(v.crumbs.map((c) => c.id)).toEqual([folder('Passive components'), folder('Resistors')])
    expect(v.unit.key).toBe('pcs')
    expect(v.currency).toBe('USD')
    expect(v.hasVariants).toBe(true)
    expect(itemView(s, tl072)!.hasVariants).toBe(false)

    const atRoot = await newItem({ unitKey: 'g' })
    expect(itemView(s, atRoot.id)).toMatchObject({ crumbs: [], unit: { key: 'g' } })
  })

  it('totals match core itemStock for every item, archived variants excluded', async () => {
    const r = await newItem({ variants: ['1k', '10k', '100k'] })
    await receive(r.id, r.v['10k']!, '100')
    await receive(r.id, r.v['1k']!, '10', 50)
    await receive(r.id, r.v['100k']!, '7', 700)
    await archive('variant', r.v['100k']!)
    expect(itemView(s, r.id)!.total).toMatchObject({
      quantity: '110',
      number: '110',
      unit: 'pcs',
      outOfStock: false,
      avgUnitPrice: 5,
      lastUnitPrice: 5,
    })
    for (const item of s.items.filter((i) => i.archivedAt === null)) {
      const v = itemView(s, item.id)
      if (!v) continue // under a folder another test archived
      const core = itemStock(s, item.id)
      expect([v.total.quantity, v.total.avgUnitPrice, v.total.lastUnitPrice]).toEqual([core.quantity, core.avgUnitPrice, core.lastUnitPrice])
    }
    expect(itemView(s, ne555)!.total).toMatchObject({ quantity: '0', number: '0', outOfStock: true, avgUnitPrice: null, lastUnitPrice: null })
    expect(itemView(s, tl072)!.total).toMatchObject({ number: '37', avgUnitPrice: 230 / 37, lastUnitPrice: 230 / 37 })
  })

  it('shows the no-variant stock only without variants or when it is not zero', async () => {
    expect(itemView(s, tl072)!.buckets.map((b) => b.name)).toEqual([null])
    expect(itemView(s, ne555)!.buckets).toMatchObject([{ variantId: null, name: null, quantity: '0', outOfStock: true, values: [] }])
    expect(itemView(s, resistor)!.buckets).toHaveLength(3)

    const r = await newItem({ variants: ['1k', '10k', '100k'] })
    await receive(r.id, r.v['10k']!, '100')
    expect(itemView(s, r.id)!.buckets.map((b) => b.name)).toEqual(['1k', '10k', '100k'])
    await receive(r.id, null, '3', 30)
    expect(itemView(s, r.id)!.buckets.map((b) => b.name)).toEqual([null, '1k', '10k', '100k'])
    await archive('variant', r.v['100k']!)
    const buckets = itemView(s, r.id)!.buckets
    expect(buckets.map((b) => b.name)).toEqual([null, '1k', '10k'])
    expect(buckets.map((b) => [b.number, b.outOfStock])).toEqual([['3', false], ['0', true], ['100', false]])
    expect(buckets[0]).toMatchObject({ variantId: null, avgUnitPrice: 10, lastUnitPrice: 10 })
    expect(buckets[2]).toMatchObject({ variantId: r.v['10k'], avgUnitPrice: null, lastUnitPrice: null })
  })

  it('orders variants by their axis values, not by creation', async () => {
    const r = await newItem({ variants: ['10k', '1k', '100k'] })
    expect(itemView(s, r.id)!.buckets.map((b) => b.name)).toEqual(['1k', '10k', '100k'])
  })

  it('sorts shared attributes by name and keeps the options of a list attribute', async () => {
    const item = await newItem()
    const pkg = newId()
    const notes = newId()
    await run({ type: 'attribute.create', id: pkg, inventoryId, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'], unit: '', siPrefixes: false })
    await run({ type: 'attribute.create', id: notes, inventoryId, name: 'Notes', kind: 'text', options: [], unit: '', siPrefixes: false })
    await run({ type: 'item.setAttribute', itemId: item.id, attributeId: pkg, value: 'DIP-8' })
    await run({ type: 'item.setAttribute', itemId: item.id, attributeId: notes, value: 'dual' })
    expect(itemView(s, item.id)!.attributes).toEqual([
      { attributeId: notes, name: 'Notes', kind: 'text', options: [], unit: '', siPrefixes: false, value: 'dual', display: 'dual' },
      { attributeId: pkg, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'], unit: '', siPrefixes: false, value: 'DIP-8', display: 'DIP-8' },
    ])
  })

  it('resolves tag names in name order', async () => {
    const item = await newItem()
    const smd = newId()
    const audio = newId()
    await run({ type: 'tag.create', id: smd, inventoryId, name: 'smd' })
    await run({ type: 'tag.create', id: audio, inventoryId, name: 'audio' })
    await run({ type: 'item.update', id: item.id, tagIds: [smd, audio] })
    expect(itemView(s, item.id)!.tags).toEqual([
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
    const r = await newItem({ variants: ['1k'] })
    await run({
      type: 'stock.receive',
      movementId: newId(),
      itemId: r.id,
      variantId: r.v['1k']!,
      quantity: '20',
      totalPrice: 199,
      sourceUrl: 'https://shop.example/r',
      note: 'reel',
    })
    const rows = journalRows(s, r.id, await storage.loadMovements(r.id))
    expect(rows[0]).toMatchObject({
      kind: 'receipt',
      number: '+20',
      variantName: '1k',
      totalPrice: 199,
      sourceUrl: 'https://shop.example/r',
      sourceHref: 'https://shop.example/r',
      note: 'reel',
      transfer: null,
    })
  })

  it('links only http and https sources', () => {
    // Core refuses other schemes on write, but a source can be written by other clients: the read side checks again.
    const movement = (sourceUrl: string | null): Movement => ({
      id: newId(),
      seq: 1,
      itemId: tl072,
      variantId: null,
      kind: 'receipt',
      quantity: '1',
      totalPrice: null,
      sourceUrl,
      note: null,
      transferId: null,
      intakeId: null,
      createdAt: '2026-11-10T00:00:00Z',
      createdBy: 'Test',
    })
    const urls = [
      'https://shop.example/x',
      'http://shop.example/y?q=1',
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'not a url',
      'ftp://files.example/a',
      null,
    ]
    const rows = journalRows(s, tl072, urls.map(movement))
    expect(rows.map((r) => r.sourceHref)).toEqual(['https://shop.example/x', 'http://shop.example/y?q=1', null, null, null, null, null, null])
    expect(rows.map((r) => r.sourceUrl)).toEqual(urls)
  })

  it('joins the two halves of a transfer into one row', async () => {
    const r = await newItem({ variants: ['1k', '10k'] })
    await receive(r.id, r.v['10k']!, '100')
    await receive(r.id, null, '3')
    await transfer(r.id, null, r.v['1k']!, '3')
    const movements = await storage.loadMovements(r.id)
    const rows = journalRows(s, r.id, movements)
    const transferId = movements[0]!.transferId
    expect(rows[0]).toMatchObject({ id: transferId, kind: 'transfer', number: '3', transfer: { from: null, to: '1k' } })
    expect(rows.filter((x) => x.kind === 'transfer')).toHaveLength(1)
    expect(rows.map((x) => [x.kind, x.number])).toEqual([['transfer', '3'], ['receipt', '+3'], ['receipt', '+100']])
  })

  it('names both variants of a transfer between variants, archived ones too', async () => {
    const r = await newItem({ variants: ['10k', '100k'] })
    await receive(r.id, r.v['10k']!, '100')
    await transfer(r.id, r.v['10k']!, r.v['100k']!, '40')
    await archive('variant', r.v['100k']!)
    const rows = journalRows(s, r.id, await storage.loadMovements(r.id))
    expect(rows[0]).toMatchObject({ kind: 'transfer', number: '40', transfer: { from: '10k', to: '100k' } })
  })

  it('formats journal amounts with the item unit and its prefixes', async () => {
    const wire = await newItem({ unitKey: 'm', receipt: '0.5' })
    await run({ type: 'stock.use', movementId: newId(), itemId: wire.id, variantId: null, quantity: '0.25', note: null })
    const rows = journalRows(s, wire.id, await storage.loadMovements(wire.id))
    expect(rows.map((r) => [r.number, r.unit])).toEqual([['−25', 'cm'], ['+50', 'cm']])
  })

  it('writes an adjustment of the difference with its sign', async () => {
    const item = await newItem({ receipt: '37' })
    await run({ type: 'stock.set', movementId: newId(), itemId: item.id, variantId: null, target: '40', note: null })
    await run({ type: 'stock.set', movementId: newId(), itemId: item.id, variantId: null, target: '35', note: null })
    const rows = journalRows(s, item.id, await storage.loadMovements(item.id))
    expect(rows.map((r) => [r.kind, r.number])).toEqual([['adjustment', '−5'], ['adjustment', '+3'], ['receipt', '+37']])
  })

  it('carries the running balance of the bucket; a recount that matched reads as counted', async () => {
    const item = await newItem({ receipt: '5' })
    await run({ type: 'stock.use', movementId: newId(), itemId: item.id, variantId: null, quantity: '2', note: null })
    await run({ type: 'stock.set', movementId: newId(), itemId: item.id, variantId: null, target: '10', note: null })
    await run({ type: 'stock.set', movementId: newId(), itemId: item.id, variantId: null, target: '10', note: null })
    const rows = journalRows(s, item.id, await storage.loadMovements(item.id))
    expect(rows.map((r) => [r.kind, r.number, r.balance?.number, r.counted])).toEqual([
      ['adjustment', '0', '10', true],
      ['adjustment', '+7', '10', false],
      ['usage', '−2', '3', false],
      ['receipt', '+5', '5', false],
    ])
    // The balance in the newest row is the stock shown at the top.
    expect(rows[0]!.balance).toEqual({ number: itemView(s, item.id)!.total.number, unit: 'pcs' })
  })

  it('counts an empty bucket confirmed at zero as counted', async () => {
    const item = await newItem()
    await run({ type: 'stock.set', movementId: newId(), itemId: item.id, variantId: null, target: '0', note: null })
    const rows = journalRows(s, item.id, await storage.loadMovements(item.id))
    expect(rows.map((r) => [r.kind, r.number, r.balance?.number, r.counted])).toEqual([['adjustment', '0', '0', true]])
  })

  it('keeps a balance per bucket; a transfer row has none', async () => {
    const r = await newItem({ variants: ['1k', '10k'] })
    await receive(r.id, r.v['1k']!, '100')
    await receive(r.id, r.v['10k']!, '7')
    await transfer(r.id, r.v['1k']!, r.v['10k']!, '30')
    await run({ type: 'stock.use', movementId: newId(), itemId: r.id, variantId: r.v['10k']!, quantity: '5', note: null })
    const rows = journalRows(s, r.id, await storage.loadMovements(r.id))
    expect(rows.map((x) => [x.kind, x.variantName, x.number, x.balance?.number ?? null])).toEqual([
      ['usage', '10k', '−5', '32'],
      ['transfer', null, '30', null],
      ['receipt', '10k', '+7', '7'],
      ['receipt', '1k', '+100', '100'],
    ])
  })

  it('formats the balance with the unit and its prefixes', async () => {
    const wire = await newItem({ unitKey: 'm', receipt: '2' })
    await run({ type: 'stock.use', movementId: newId(), itemId: wire.id, variantId: null, quantity: '1.75', note: null })
    const rows = journalRows(s, wire.id, await storage.loadMovements(wire.id))
    expect(rows.map((r) => r.balance)).toEqual([
      { number: '25', unit: 'cm' },
      { number: '2', unit: 'm' },
    ])
  })
})

describe('journalDays', () => {
  // Local times: the day boundaries are the device's own.
  const now = new Date(2026, 10, 11, 15, 30)
  const at = (day: number, hour: number, minute = 0): string => new Date(2026, 10, day, hour, minute).toISOString()
  const row = (id: string, iso: string): JournalRow => ({
    id,
    kind: 'receipt',
    at: iso,
    by: 'Test',
    number: '+1',
    unit: 'pcs',
    variantName: null,
    transfer: null,
    totalPrice: null,
    sourceUrl: null,
    sourceHref: null,
    note: null,
    balance: null,
    counted: false,
  })

  it('groups rows by local day, newest first: today, yesterday, then dates', () => {
    const rows = [
      row('a', at(11, 14, 5)),
      row('b', at(11, 0, 1)),
      row('c', at(10, 23, 59)),
      row('d', at(10, 8)),
      row('e', at(8, 12)),
      row('f', new Date(2025, 10, 11, 9).toISOString()),
    ]
    const days = journalDays(rows, now)
    expect(days.map((d) => [d.relative, d.day, d.rows.map((r) => r.id)])).toEqual([
      ['today', '2026-11-11', ['a', 'b']],
      ['yesterday', '2026-11-10', ['c', 'd']],
      [null, '2026-11-08', ['e']],
      [null, '2025-11-11', ['f']],
    ])
  })

  it('has no groups without rows', () => {
    expect(journalDays([], now)).toEqual([])
  })

  it('counts yesterday by the calendar across a month boundary', () => {
    const days = journalDays([row('a', new Date(2026, 9, 31, 22).toISOString())], new Date(2026, 10, 1, 1))
    expect(days.map((d) => [d.relative, d.day])).toEqual([['yesterday', '2026-10-31']])
  })
})

describe('looseTransferOffer', () => {
  it('offers nothing for an item with variants', () => {
    expect(looseTransferOffer(s, resistor)).toBeNull()
  })
  it('offers nothing when there is no stock without a variant', () => {
    expect(looseTransferOffer(s, ne555)).toBeNull()
  })
  it('offers the stock of an item without variants', () => {
    expect(looseTransferOffer(s, tl072)).toEqual({ quantity: '37', number: '37', unit: 'pcs' })
  })
  it('offers the loose stock again once the last active variant is archived', async () => {
    const item = await newItem({ variants: ['a'], receipt: '5' })
    expect(looseTransferOffer(s, item.id)).toBeNull()
    await archive('variant', item.v.a!)
    expect(looseTransferOffer(s, item.id)).toEqual({ quantity: '5', number: '5', unit: 'pcs' })
  })
})

describe('attributeChoices', () => {
  it('lists the inventory attributes not yet on the item, sorted by name', async () => {
    const item = await newItem()
    const ids = { size: newId(), color: newId(), weight: newId() }
    await run({ type: 'attribute.create', id: ids.weight, inventoryId, name: 'Weight', kind: 'text', options: [] })
    await run({ type: 'attribute.create', id: ids.size, inventoryId, name: 'Size', kind: 'enum', options: ['S', 'L'] })
    await run({ type: 'attribute.create', id: ids.color, inventoryId, name: 'Color', kind: 'text', options: [] })
    const names = () => attributeChoices(s, item.id).filter((a) => Object.values(ids).includes(a.id)).map((a) => a.name)
    expect(names()).toEqual(['Color', 'Size', 'Weight'])
    await run({ type: 'item.setAttribute', itemId: item.id, attributeId: ids.size, value: null })
    expect(names()).toEqual(['Color', 'Weight'])
    expect(attributeChoices(s, item.id).some((a) => a.id === ids.size)).toBe(false)
    // Another item still sees it.
    expect(attributeChoices(s, ne555).some((a) => a.id === ids.size)).toBe(true)
  })
})

describe('itemView photos', () => {
  const addPhoto = (itemId: string, variantId: string | null, name: string): Promise<void> =>
    run({ type: 'photo.add', id: newId(), itemId, variantId, provider: 'uploadcare', fileId: name, url: `https://ucarecdn.com/${name}/` })

  it('lists the item photos by position, without the variants photos', async () => {
    const it1 = await newItem({ variants: ['A', 'B'] })
    await addPhoto(it1.id, null, 'first')
    await addPhoto(it1.id, it1.v['A']!, 'varA')
    await addPhoto(it1.id, null, 'second')
    let view = itemView(s, it1.id)!
    expect(view.photos.map((p) => p.fileId)).toEqual(['first', 'second'])
    await run({ type: 'photo.reorder', itemId: it1.id, orderedIds: [view.photos[1]!.id, view.photos[0]!.id] })
    view = itemView(s, it1.id)!
    expect(view.photos.map((p) => p.fileId)).toEqual(['second', 'first'])
  })

  it('gives the variant row its photo, and null when it has none', async () => {
    const it1 = await newItem({ variants: ['A', 'B'] })
    await addPhoto(it1.id, it1.v['A']!, 'varA')
    const view = itemView(s, it1.id)!
    expect(view.buckets.find((b) => b.variantId === it1.v['A'])!.photo?.fileId).toBe('varA')
    expect(view.buckets.find((b) => b.variantId === it1.v['B'])!.photo).toBeNull()
    expect(view.photos).toEqual([])
  })
})

describe('bucketDescription', () => {
  it('names the variant, the item and its shared attributes: 10 kΩ · Резистор 0,25 Вт · 5 %', async () => {
    const tolerance = newId()
    await run({ type: 'attribute.create', id: tolerance, inventoryId, name: 'Tolerance', kind: 'number', options: [], unit: '%', siPrefixes: false })
    await run({ type: 'item.setAttribute', itemId: resistor, attributeId: tolerance, value: '5' })
    const v = s.variants.find((x) => x.itemId === resistor && itemView(s, resistor)!.buckets.find((b) => b.variantId === x.id)?.name?.replace(/\s/g, '').toLowerCase().startsWith('10k'))!
    expect(bucketDescription(s, resistor, v.id)).toBe('10 kΩ · Резистор 0,25 Вт · 5 %')
  })

  it('is the item name and its attributes for the item itself, three attributes at most', async () => {
    const item = await newItem()
    const names = ['A', 'B', 'C', 'D']
    for (const n of names) {
      const id = newId()
      await run({ type: 'attribute.create', id, inventoryId, name: `${n}${made}`, kind: 'text', options: [], unit: '', siPrefixes: false })
      await run({ type: 'item.setAttribute', itemId: item.id, attributeId: id, value: `v${n}` })
    }
    const name = s.items.find((i) => i.id === item.id)!.name
    expect(bucketDescription(s, item.id, null)).toBe(`${name} · vA · vB · vC`)
  })

  it('leaves out empty attributes and gives an empty line for a missing item', async () => {
    const item = await newItem({ variants: ['Red'] })
    const attr = newId()
    await run({ type: 'attribute.create', id: attr, inventoryId, name: `Note${made}`, kind: 'text', options: [], unit: '', siPrefixes: false })
    await run({ type: 'item.setAttribute', itemId: item.id, attributeId: attr, value: '  ' })
    const name = s.items.find((i) => i.id === item.id)!.name
    expect(bucketDescription(s, item.id, item.v.Red!)).toBe(`Red · ${name}`)
    expect(bucketDescription(s, newId(), null)).toBe('')
  })
})

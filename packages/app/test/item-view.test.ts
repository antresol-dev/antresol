import { createSearch, itemStock, newId, type Command, type InventorySnapshot, type InventoryStorage, type Movement } from '@graymatter/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { attributeChoices, attributeWrites, itemView, journalRows, looseTransferOffer } from '../app/lib/item-view'
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
/** A fresh item with its own variants (name → id); no folder means the inventory root. */
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
  const variants = (options.variants ?? []).map((name) => ({ id: newId(), name }))
  if (variants.length > 0) await run({ type: 'variant.createMany', itemId: id, variants })
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
    expect(itemView(s, resistor)!.buckets.map((b) => b.name)).toEqual(['1k', '10k', '100k'])

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

  it('orders variants by position', async () => {
    const r = await newItem({ variants: ['1k', '10k', '100k'] })
    await run({ type: 'variant.createMany', itemId: r.id, variants: [{ id: newId(), name: '0R' }] })
    expect(itemView(s, r.id)!.buckets.map((b) => b.name)).toEqual(['1k', '10k', '100k', '0R'])
  })

  it('marks an attribute per-variant when the item value is empty and the item has variants', async () => {
    const r = await newItem({ variants: ['1k', '10k'] })
    const resistance = newId()
    await run({ type: 'attribute.create', id: resistance, inventoryId, name: 'Resistance', kind: 'text', options: [] })
    await run({ type: 'item.setAttribute', itemId: r.id, attributeId: resistance, value: null })
    await run({ type: 'variant.setAttribute', variantId: r.v['10k']!, attributeId: resistance, value: '10 kΩ' })
    expect(itemView(s, r.id)!.attributes).toMatchObject([{ name: 'Resistance', perVariant: true, value: null }])
    const buckets = itemView(s, r.id)!.buckets
    expect(buckets.find((b) => b.name === '10k')!.values).toEqual([{ attributeId: expect.any(String), name: 'Resistance', value: '10 kΩ' }])
    expect(buckets.find((b) => b.name === '1k')!.values).toEqual([{ attributeId: resistance, name: 'Resistance', value: null }])

    // Without variants an empty value is just empty, and a shared value is never per-variant.
    const plain = await newItem()
    await run({ type: 'item.setAttribute', itemId: plain.id, attributeId: resistance, value: null })
    expect(itemView(s, plain.id)!.attributes).toMatchObject([{ name: 'Resistance', perVariant: false, value: null }])
    await run({ type: 'item.setAttribute', itemId: r.id, attributeId: resistance, value: 'mixed' })
    const shared = itemView(s, r.id)!
    expect(shared.attributes).toMatchObject([{ perVariant: false, value: 'mixed' }])
    expect(shared.buckets.every((b) => b.values.length === 0)).toBe(true)
  })

  it('sorts attributes by name and keeps the options of a list attribute', async () => {
    const item = await newItem()
    const pkg = newId()
    const notes = newId()
    await run({ type: 'attribute.create', id: pkg, inventoryId, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'] })
    await run({ type: 'attribute.create', id: notes, inventoryId, name: 'Notes', kind: 'text', options: [] })
    await run({ type: 'item.setAttribute', itemId: item.id, attributeId: pkg, value: 'DIP-8' })
    await run({ type: 'item.setAttribute', itemId: item.id, attributeId: notes, value: 'dual' })
    expect(itemView(s, item.id)!.attributes).toEqual([
      { attributeId: notes, name: 'Notes', kind: 'text', options: [], value: 'dual', perVariant: false },
      { attributeId: pkg, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'], value: 'DIP-8', perVariant: false },
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

describe('attributeWrites', () => {
  const setup = async () => {
    const item = await newItem({ variants: ['ra', 'rb', 'rc'] })
    const attr = newId()
    await run({ type: 'attribute.create', id: attr, inventoryId, name: 'Resistance', kind: 'text', options: [] })
    await run({ type: 'item.setAttribute', itemId: item.id, attributeId: attr, value: null })
    await run({ type: 'variant.setAttribute', variantId: item.v['ra']!, attributeId: attr, value: '1 kΩ' })
    await run({ type: 'variant.setAttribute', variantId: item.v['rb']!, attributeId: attr, value: '10 kΩ' })
    return { item, attr }
  }

  it('per variant: empties the item value and writes only the changed variants, blank as null', async () => {
    const { item, attr } = await setup()
    const writes = attributeWrites(s, item.id, attr, {
      variants: { [item.v['ra']!]: '1 kΩ', [item.v['rb']!]: '', [item.v['rc']!]: ' 100 kΩ ' },
    })
    expect(writes).toEqual([
      { type: 'item.setAttribute', itemId: item.id, attributeId: attr, value: null },
      { type: 'variant.setAttribute', variantId: item.v['rb'], attributeId: attr, value: null },
      { type: 'variant.setAttribute', variantId: item.v['rc'], attributeId: attr, value: '100 kΩ' },
    ])
  })

  it('shared: sets the item value, then clears every variant that has a value', async () => {
    const { item, attr } = await setup()
    expect(attributeWrites(s, item.id, attr, { shared: ' 5 kΩ ' })).toEqual([
      { type: 'item.setAttribute', itemId: item.id, attributeId: attr, value: '5 kΩ' },
      { type: 'variant.setAttribute', variantId: item.v['ra'], attributeId: attr, value: null },
      { type: 'variant.setAttribute', variantId: item.v['rb'], attributeId: attr, value: null },
    ])
    expect(attributeWrites(s, item.id, attr, { shared: '  ' })[0]).toMatchObject({ value: null })
  })

  it('after switching to a shared value search no longer finds the old variant values', async () => {
    const { item, attr } = await setup()
    const found = () => createSearch(s).search('10 kΩ').filter((h) => h.itemId === item.id && h.variantId !== null).map((h) => h.variantId)
    expect(found()).toContain(item.v['rb'])
    for (const c of attributeWrites(s, item.id, attr, { shared: '5 kΩ' })) await run(c)
    expect(found()).toEqual([])
    expect(createSearch(s).search('5 kΩ').some((h) => h.itemId === item.id)).toBe(true)
    // Switching back starts from empty values.
    expect(attributeWrites(s, item.id, attr, { variants: { [item.v['rb']!]: '' } })).toHaveLength(1)
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

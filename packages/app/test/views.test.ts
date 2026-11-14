import {
  createSearch,
  formatAmountParts,
  isOutOfStock,
  itemStock,
  newId,
  resolveUnit,
  variantLabel,
  type InventorySnapshot,
  type InventoryStorage,
  type Photo,
} from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { dictionaryView } from '../app/lib/dictionaries'
import type { SourceConfig } from '../app/lib/types'
import {
  collapseCrumbs,
  folderChoices,
  folderTree,
  folderView,
  indexStats,
  inventoryPieces,
  piecesLabel,
  moveTargets,
  searchRows,
  usedBy,
  usedByArchivedCount,
  type Crumb,
} from '../app/lib/views'

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
let snap: InventorySnapshot

const idOf = (s: InventorySnapshot, name: string): string => s.folders.find((f) => f.name === name)!.id
const names = (xs: { name: string }[]): string[] => xs.map((x) => x.name)

// One database for the file, closed at the end.
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  const conn = await driver.connect(cfg)
  storage = conn.storage
  inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  snap = await storage.loadInventory(inventoryId)
})

/** A demo resistor's variant by its value (`10k` finds `10 kΩ`): variants have no names, only labels. */
const byValue = (s: InventorySnapshot, itemId: string, value: string) =>
  s.variants.find((v) => v.itemId === itemId && variantLabel(s, v).replace(/\s/g, '').toLowerCase().startsWith(value))!

describe('folderView', () => {
  it('lists root folders by name with subtree piece sums', () => {
    const v = folderView(snap, null)!
    expect(v.folder).toBeNull()
    expect(v.crumbs).toEqual([])
    expect(names(v.folders)).toEqual(['ICs', 'Passive components', expect.stringContaining('Очень длинное')])
    expect(v.folders.map((f) => f.pieces)).toEqual(['43', '100', null])
  })

  it('builds crumbs and item rows', () => {
    const v = folderView(snap, idOf(snap, 'Op-amps'))!
    expect(names(v.crumbs)).toEqual(['ICs', 'Op-amps'])
    const tl = v.items.find((i) => i.name === 'TL072')!
    expect(tl.number).toBe('37')
    expect(tl.unit).toBe('')
    expect(tl.outOfStock).toBe(false)
    expect(tl.cover).toBeNull()
  })

  it('flags out-of-stock items', () => {
    const ne = folderView(snap, idOf(snap, 'ICs'))!.items.find((i) => i.name === 'NE555')!
    expect(ne.outOfStock).toBe(true)
  })

  it('counts variants', () => {
    const r = folderView(snap, idOf(snap, 'Resistors'))!.items[0]!
    expect(r.variantCount).toBe(3)
  })

  it('returns null for a missing folder', () => {
    expect(folderView(snap, newId())).toBeNull()
  })

  it('hides an archived subtree', async () => {
    await storage.apply({ type: 'archive', target: 'folder', id: idOf(snap, 'ICs'), archiveId: newId() }, { device: 'Test' })
    const after = await storage.loadInventory(inventoryId)
    expect(folderView(after, idOf(after, 'Op-amps'))).toBeNull()
    expect(folderView(after, idOf(after, 'ICs'))).toBeNull()
    expect(names(folderView(after, null)!.folders)).not.toContain('ICs')
    expect(JSON.stringify(folderTree(after))).not.toContain('ICs')
    expect(JSON.stringify(folderTree(after))).not.toContain('Op-amps')
  })
})

describe('collapseCrumbs', () => {
  const crumbs: Crumb[] = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `f${i}`, name: `c${i}` }))
  it('collapses the middle of long paths', () => {
    expect(collapseCrumbs(crumbs)).toEqual([crumbs[0], 'ellipsis', crumbs[4], crumbs[5]])
  })
  it('keeps short paths', () => {
    expect(collapseCrumbs(crumbs.slice(0, 4))).toEqual(crumbs.slice(0, 4))
  })
  it('works with any crumb type', () => {
    expect(collapseCrumbs(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'ellipsis', 'd', 'e'])
    expect(collapseCrumbs(['a', 'b', 'c'], 2)).toEqual(['a', 'ellipsis', 'b', 'c'])
    expect(collapseCrumbs(['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('searchRows', () => {
  it('describes a variant hit with its path', () => {
    const hits = createSearch(snap).search('10k')
    const rows = searchRows(snap, hits)
    const row = rows.find((r) => r.variantName === variantLabel(snap, byValue(snap, snap.items.find((i) => i.name === 'Резистор 0,25 Вт')!.id, '10k')))!
    expect(row.number).toBe('100')
    expect(row.path).toBe('Passive components / Resistors')
  })
})

describe('folderTree', () => {
  it('nests active folders', () => {
    const tree = folderTree(snap)
    expect(names(tree)).toEqual(['ICs', 'Passive components', expect.stringContaining('Очень длинное')])
    expect(names(tree[0]!.children)).toEqual(['Op-amps'])
  })

  it('sums pieces in each subtree, like the folder list', () => {
    const tree = folderTree(snap)
    expect(tree.map((n) => n.pieces)).toEqual(folderView(snap, null)!.folders.map((f) => f.pieces))
    expect(tree[0]!.children.map((n) => n.pieces)).toEqual(folderView(snap, idOf(snap, 'ICs'))!.folders.map((f) => f.pieces))
  })
})

describe('piece sums', () => {
  const at = '2026-11-10T00:00:00Z'
  const folder = (s: InventorySnapshot, id: string, parentId: string | null = null) =>
    s.folders.push({ id, inventoryId: s.inventory.id, parentId, name: id, description: null, archivedAt: null, archiveId: null } as never)
  const item = (s: InventorySnapshot, id: string, folderId: string | null, unitKey: string, quantity: string, extra: { archived?: boolean } = {}) => {
    s.items.push({ id, inventoryId: s.inventory.id, folderId, name: id, unitKey, description: null, tagIds: [], archivedAt: extra.archived ? at : null, archiveId: null } as never)
    s.stock.push({ itemId: id, variantId: null, quantity, pricedQuantity: '0', pricedTotal: 0, lastPriced: null } as never)
  }
  const fresh = (): InventorySnapshot => {
    const s = structuredClone(snap)
    s.folders = []
    s.items = []
    s.stock = []
    s.variants = []
    return s
  }

  it('adds up pcs items over the subtree and leaves out other units and archived items', () => {
    const s = fresh()
    folder(s, 'A')
    folder(s, 'B', 'A')
    folder(s, 'Wire')
    folder(s, 'Zero')
    item(s, 'resistors', 'A', 'pcs', '10')
    item(s, 'caps', 'B', 'pcs', '5')
    item(s, 'cable', 'A', 'm', '100')
    item(s, 'old', 'A', 'pcs', '7', { archived: true })
    item(s, 'cable2', 'Wire', 'm', '50')
    item(s, 'zero', 'Zero', 'pcs', '0')
    const [a, wire, zero] = folderView(s, null)!.folders
    expect(a!.pieces).toBe('15')
    expect(folderView(s, 'A')!.folders[0]!.pieces).toBe('5')
    expect(wire!.pieces).toBeNull() // only metres: no number
    expect(zero!.pieces).toBe('0') // pieces, none in stock: still a number
    expect(inventoryPieces(s)).toBe('15')
    expect(folderTree(s).map((n) => n.pieces)).toEqual(['15', null, '0'])
  })

  it('has no number when no item counts in pieces, and skips archived variants', () => {
    expect(inventoryPieces(fresh())).toBeNull()
    const s = fresh()
    folder(s, 'A')
    item(s, 'x', 'A', 'pcs', '4')
    s.variants.push({ id: 'v1', itemId: 'x', archivedAt: at } as never)
    s.stock.push({ itemId: 'x', variantId: 'v1', quantity: '9', pricedQuantity: '0', pricedTotal: 0, lastPriced: null } as never)
    expect(inventoryPieces(s)).toBe('4')
  })

  it('shows k and M prefixes as a bare prefix', () => {
    expect(piecesLabel('5')).toBe('5')
    expect(piecesLabel('1200')).toBe('1.2k')
    expect(piecesLabel('2000000')).toBe('2M')
  })

  it('keeps at most three significant digits of a big sum', () => {
    expect(piecesLabel('999')).toBe('999')
    expect(piecesLabel('1653')).toBe('1.65k')
    expect(piecesLabel('12345')).toBe('12.3k')
    expect(piecesLabel('123456')).toBe('123k')
    expect(piecesLabel('1200000')).toBe('1.2M')
    expect(piecesLabel('1000')).toBe('1k')
    expect(piecesLabel('999900')).toBe('1M')
    expect(piecesLabel('100000')).toBe('100k')
  })
})

describe('index and edge cases', () => {
  const photo = (itemId: string, variantId: string | null, position: number, url: string): Photo => ({
    id: newId(),
    itemId,
    variantId,
    provider: 'test',
    fileId: url,
    url,
    position,
    createdAt: '2026-11-10T00:00:00Z',
    createdBy: 'Test',
  })
  const clone = (): InventorySnapshot => structuredClone(snap)

  it('builds the index once per snapshot object', () => {
    const s = clone()
    const before = indexStats.builds
    folderView(s, null)
    folderView(s, idOf(s, 'ICs'))
    searchRows(s, createSearch(s).search('tl072'))
    folderTree(s)
    expect(indexStats.builds).toBe(before + 1)
    folderView(clone(), null)
    expect(indexStats.builds).toBe(before + 2)
  })

  it('agrees with core itemStock for every item, with stock in an archived variant', async () => {
    // Its own source: the shared one has ICs archived by an earlier test.
    const own = (await driver.connect({ ...cfg, id: 'agree' })).storage
    const inv = (await own.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
    let s = await own.loadInventory(inv)
    const resistor = s.items.find((i) => i.name === 'Резистор 0,25 Вт')!.id
    const v100k = byValue(s, resistor, '100k').id
    await own.apply(
      { type: 'stock.receive', movementId: newId(), itemId: resistor, variantId: v100k, quantity: '7', totalPrice: null, sourceUrl: null, note: null },
      { device: 'Test' },
    )
    await own.apply({ type: 'archive', target: 'variant', id: v100k, archiveId: newId() }, { device: 'Test' })
    s = await own.loadInventory(inv)

    const seen: string[] = []
    for (const f of [null, ...s.folders.map((x) => x.id)]) {
      for (const row of folderView(s, f)?.items ?? []) {
        const stock = itemStock(s, row.id)
        const unit = resolveUnit(s.items.find((i) => i.id === row.id)!.unitKey, s.units)!
        const parts = formatAmountParts(stock.quantity, unit)
        expect([row.number, row.unit]).toEqual([parts.number, unit.key === 'pcs' && parts.unit === 'pcs' ? '' : parts.unit])
        expect(row.outOfStock).toBe(isOutOfStock(stock))
        seen.push(`${row.name} ${row.number}`)
      }
    }
    expect(seen).toContain('Резистор 0,25 Вт 100')
    expect(seen).toHaveLength(5)
  })

  it('uses the lowest-position item photo and ignores variant photos', () => {
    const s = clone()
    const item = s.items.find((i) => i.name === 'Резистор 0,25 Вт')!
    const variant = s.variants.find((v) => v.itemId === item.id)!
    s.photos = [
      photo(item.id, variant.id, 0, 'variant.jpg'),
      photo(item.id, null, 2, 'second.jpg'),
      photo(item.id, null, 1, 'first.jpg'),
    ]
    expect(folderView(s, idOf(s, 'Resistors'))!.items[0]!.cover?.url).toBe('first.jpg')
    const onlyVariant = clone()
    onlyVariant.photos = [photo(item.id, variant.id, 0, 'variant.jpg')]
    expect(folderView(onlyVariant, idOf(onlyVariant, 'Resistors'))!.items[0]!.cover).toBeNull()
  })

  it('gives search rows the cover, and the variant photo when a variant matched', () => {
    const s = clone()
    const item = s.items.find((i) => i.name === 'Резистор 0,25 Вт')!
    const variant = byValue(s, item.id, '10k')
    s.photos = [
      photo(item.id, null, 0, 'cover.jpg'),
      photo(item.id, variant.id, 3, 'v-late.jpg'),
      photo(item.id, variant.id, 1, 'v-early.jpg'),
    ]
    const rows = searchRows(s, [
      { itemId: item.id, variantId: variant.id },
      { itemId: item.id, variantId: null },
    ])
    expect(rows.map((r) => r.cover?.url)).toEqual(['v-early.jpg', 'cover.jpg'])
    expect(rows[0]!.variantName).not.toBeNull()
    expect(rows.map((r) => r.folderName)).toEqual(['Resistors', 'Resistors'])
    // Snapshots are indexed once, so each case gets its own.
    const coverOnly = clone()
    coverOnly.photos = [photo(item.id, null, 0, 'cover.jpg')]
    expect(searchRows(coverOnly, [{ itemId: item.id, variantId: variant.id }])[0]!.cover?.url).toBe('cover.jpg')
    const none = clone()
    none.photos = []
    expect(searchRows(none, [{ itemId: item.id, variantId: null }])[0]!.cover).toBeNull()
  })

  it('falls back to pcs for an unknown unit', () => {
    const s = clone()
    s.items.find((i) => i.name === 'TL072')!.unitKey = 'custom:gone'
    const row = folderView(s, idOf(s, 'Op-amps'))!.items[0]!
    expect(row.unit).toBe('')
    expect(row.number).toBe('37')
  })

  it('uses item stock for an item-level hit and an empty path for a root item', () => {
    const s = clone()
    const resistor = s.items.find((i) => i.name === 'Резистор 0,25 Вт')!
    const [row] = searchRows(s, [{ itemId: resistor.id, variantId: null }])
    expect(row!.variantName).toBeNull()
    expect(row!.number).toBe('100')
    expect(row!.path).toBe('Passive components / Resistors')
    const tl = s.items.find((i) => i.name === 'TL072')!
    tl.folderId = null
    const [root] = searchRows(s, [{ itemId: tl.id, variantId: null }])
    expect(root!.path).toBe('')
    expect(root!.folderName).toBeNull()
    expect(row!.folderName).toBe('Resistors')
  })

  it('gives item rows the name of their folder, null in the root', () => {
    const s = clone()
    const tl = s.items.find((i) => i.name === 'TL072')!
    const folder = s.folders.find((f) => f.id === tl.folderId)!
    expect(folderView(s, folder.id)!.items.find((r) => r.id === tl.id)!.folderName).toBe(folder.name)
    const moved = clone()
    moved.items.find((i) => i.id === tl.id)!.folderId = null
    expect(folderView(moved, null)!.items.find((r) => r.id === tl.id)!.folderName).toBeNull()
  })

  it('gives rows the item icon and the folder icon, from the snapshot index; null when unset', () => {
    const s = clone()
    const tl = s.items.find((i) => i.name === 'TL072')!
    const folder = s.folders.find((f) => f.id === tl.folderId)!
    tl.icon = 'microchip'
    folder.icon = 'cpu'
    const row = folderView(s, folder.id)!.items.find((r) => r.id === tl.id)!
    expect([row.icon, row.folderIcon]).toEqual(['microchip', 'cpu'])
    expect(folderView(s, folder.parentId)!.folders.find((f) => f.id === folder.id)!.icon).toBe('cpu')
    const [hit] = searchRows(s, [{ itemId: tl.id, variantId: null }])
    expect([hit!.icon, hit!.folderIcon]).toEqual(['microchip', 'cpu'])
    const bare = clone()
    const other = bare.items.find((i) => i.name === 'TL072')!
    other.icon = null
    const [none] = searchRows(bare, [{ itemId: other.id, variantId: null }])
    expect(none!.icon).toBeNull()
    expect(none!.folderIcon).toBeNull()
    const root = clone()
    root.items.find((i) => i.id === other.id)!.folderId = null
    expect(folderView(root, null)!.items.find((r) => r.id === other.id)!.folderIcon).toBeNull()
  })
})

describe('moveTargets', () => {
  it('puts the root first and excludes the folder and its subtree', () => {
    const t = moveTargets(snap, idOf(snap, 'ICs'))
    expect(t[0]).toEqual({ id: null, name: snap.inventory.name, depth: 0, current: true })
    expect(names(t)).not.toContain('ICs')
    expect(names(t)).not.toContain('Op-amps')
    const passive = t.find((x) => x.name === 'Passive components')!
    expect(passive.depth).toBe(1)
    expect(passive.current).toBe(false)
    expect(t.find((x) => x.name === 'Resistors')!.depth).toBe(2)
    expect(t.map((x) => x.name).slice(1, 3)).toEqual(['Passive components', 'Resistors'])
  })

  it('marks the present parent as current', () => {
    const t = moveTargets(snap, idOf(snap, 'Op-amps'))
    expect(t.filter((x) => x.current).map((x) => x.name)).toEqual(['ICs'])
    expect(t[0]!.current).toBe(false)
  })

  it('does not offer the moved folder\'s descendants', () => {
    const t = moveTargets(snap, idOf(snap, 'Passive components'))
    expect(names(t)).not.toContain('Resistors')
  })
})

describe('folderChoices', () => {
  it('lists the root and every active folder depth-first, marking the selected one', () => {
    const opamps = idOf(snap, 'Op-amps')
    const c = folderChoices(snap, opamps)
    expect(c.map((t) => [t.name, t.depth, t.current]).slice(0, 4)).toEqual([
      [snap.inventory.name, 0, false],
      ['ICs', 1, false],
      ['Op-amps', 2, true],
      ['Passive components', 1, false],
    ])
    expect(c[0]!.id).toBeNull()
    expect(c).toHaveLength(snap.folders.filter((f) => f.archivedAt === null).length + 1)
  })

  it('marks the root when nothing is selected', () => {
    const c = folderChoices(snap, null)
    expect(c.filter((t) => t.current).map((t) => t.id)).toEqual([null])
  })
})

describe('list rows', () => {
  const clone = (): InventorySnapshot => structuredClone(snap)
  const itemOf = (s: InventorySnapshot, name: string) => s.items.find((i) => i.name === name)!
  const rowOf = (s: InventorySnapshot, name: string) => {
    const item = itemOf(s, name)
    return folderView(s, item.folderId)!.items.find((i) => i.id === item.id)!
  }
  const line = (row: { buckets: { label: string | null; number: string; empty: boolean }[]; moreBuckets: number }) =>
    [...row.buckets.map((b) => `${b.label ?? 'none'} ${b.empty ? '—' : b.number}`), ...(row.moreBuckets ? [`+${row.moreBuckets}`] : [])].join(' · ')

  it('shows a resistor by its buckets, in variant order', () => {
    const row = rowOf(snap, 'Резистор 0,25 Вт')
    expect(line(row)).toBe('1 kΩ — · 10 kΩ 100 · 100 kΩ —')
    expect(row.buckets[0]).toEqual({ label: '1 kΩ', number: '0', empty: true })
    expect(row.moreBuckets).toBe(0)
  })

  it('shows four buckets at most and counts the rest; the no-variant bucket only when it is not zero', async () => {
    const own = (await driver.connect({ ...cfg, id: 'rows' })).storage
    const inv = (await own.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
    let s = await own.loadInventory(inv)
    const resistor = itemOf(s, 'Резистор 0,25 Вт').id
    const resistance = s.attributes.find((a) => a.name === 'Resistance')!.id
    await own.apply(
      {
        type: 'variant.createMany',
        itemId: resistor,
        variants: ['2200', '4700', '47000'].map((value) => ({ id: newId(), values: [{ attributeId: resistance, value }] })),
      },
      { device: 'Test' },
    )
    s = await own.loadInventory(inv)
    expect(line(rowOf(s, 'Резистор 0,25 Вт'))).toBe('1 kΩ — · 2.2 kΩ — · 4.7 kΩ — · 10 kΩ 100 · +2')
    const loose = structuredClone(s)
    loose.stock.push({ itemId: resistor, variantId: null, quantity: '5', pricedQuantity: '0', pricedTotal: 0, lastPriced: null, lastCountedAt: null } as never)
    expect(line(rowOf(loose, 'Резистор 0,25 Вт'))).toBe('none 5 · 1 kΩ — · 2.2 kΩ — · 4.7 kΩ — · +3')
  })

  it('joins the axes of a bucket by a slash, leaving the dot between buckets', () => {
    const row = rowOf(snap, 'Конденсатор керамический')
    expect(line(row)).toBe('10 nF / 50 V — · 100 nF / 16 V — · 100 nF / 50 V —')
  })

  it('has no buckets for an item without variants', () => {
    const row = rowOf(snap, 'TL072')
    expect(row.buckets).toEqual([])
    expect(row.moreBuckets).toBe(0)
  })

  it('writes the unit as a suffix: none for pieces, a prefix for many pieces, the symbol otherwise', () => {
    const s = clone()
    const tl = itemOf(s, 'TL072')
    s.stock.find((l) => l.itemId === tl.id)!.quantity = '1500'
    const lm = itemOf(s, 'LM13700')
    lm.unitKey = 'm'
    s.stock.find((l) => l.itemId === lm.id)!.quantity = '3'
    expect([rowOf(s, 'TL072').number, rowOf(s, 'TL072').unit]).toEqual(['1.5', 'k'])
    expect([rowOf(s, 'LM13700').number, rowOf(s, 'LM13700').unit]).toEqual(['3', 'm'])
    expect([rowOf(snap, 'TL072').number, rowOf(snap, 'TL072').unit]).toEqual(['37', ''])
  })

  it('writes the bucket amounts the same way', () => {
    const s = clone()
    const resistor = itemOf(s, 'Резистор 0,25 Вт')
    s.stock.find((l) => l.itemId === resistor.id && l.variantId !== null)!.quantity = '2000'
    expect(rowOf(s, 'Резистор 0,25 Вт').buckets.find((b) => !b.empty)!.number).toBe('2k')
    resistor.unitKey = 'm'
    const metres = structuredClone(s)
    expect(rowOf(metres, 'Резистор 0,25 Вт').buckets.find((b) => !b.empty)!.number).toBe('2 km')
  })

  it('shows the values of pinned attributes, by attribute name, numbers in their format', () => {
    const s = clone()
    const at = '2026-11-10T00:00:00Z'
    const attr = (id: string, name: string, kind: 'text' | 'enum' | 'number', pinned: boolean, extra: object = {}) =>
      s.attributes.push({ id, inventoryId: s.inventory.id, name, kind, options: [], unit: '', siPrefixes: false, pinned, createdAt: at, updatedAt: at, createdBy: 'T', updatedBy: 'T', ...extra })
    attr('a-place', 'Place', 'text', true)
    attr('a-pkg', 'Package', 'enum', true, { options: ['DIP-8'] })
    attr('a-note', 'Note', 'text', false)
    const tl = itemOf(s, 'TL072').id
    const lm = itemOf(s, 'LM13700').id
    const voltage = s.attributes.find((a) => a.name === 'Voltage')!
    voltage.pinned = true
    s.itemAttributes.push(
      { itemId: tl, attributeId: 'a-place', value: 'B4', axisPosition: null },
      { itemId: tl, attributeId: 'a-pkg', value: 'DIP-8', axisPosition: null },
      { itemId: tl, attributeId: 'a-note', value: 'spare', axisPosition: null },
      { itemId: lm, attributeId: 'a-place', value: '  ', axisPosition: null },
      { itemId: lm, attributeId: voltage.id, value: '0.5', axisPosition: null },
    )
    expect(rowOf(s, 'TL072').pinned).toEqual(['DIP-8', 'B4'])
    expect(rowOf(s, 'LM13700').pinned).toEqual(['500 mV'])
    expect(rowOf(s, 'NE555').pinned).toEqual([])
    // Search rows carry the same chips, a variant hit its item's.
    const [row] = searchRows(s, [{ itemId: tl, variantId: null }])
    expect(row!.pinned).toEqual(['DIP-8', 'B4'])
  })
})

describe('usedBy', () => {
  const item = (id: string, name: string, over: Record<string, unknown> = {}) =>
    ({ id, name, folderId: null, tagIds: [], unitKey: 'pcs', archivedAt: null, ...over }) as unknown as InventorySnapshot['items'][number]
  const base = { photos: [], folders: [], variants: [], itemAttributes: [], variantAttributeValues: [] }
  const make = (over: Record<string, unknown>) => ({ ...snap, ...base, ...over }) as InventorySnapshot

  it('lists active items with the tag, by name, skipping archived ones', () => {
    const s = make({
      items: [item('b', 'beta', { tagIds: ['t1'] }), item('a', 'Alpha', { tagIds: ['t1', 't2'] }), item('c', 'Gamma'), item('d', 'Dead', { tagIds: ['t1'], archivedAt: 'x' })],
    })
    expect(usedBy(s, { kind: 'tag', id: 't1' }).map((r) => r.name)).toEqual(['Alpha', 'beta'])
    expect(usedBy(s, { kind: 'tag', id: 'none' })).toEqual([])
  })

  it('matches the unit key', () => {
    const s = make({ items: [item('a', 'Wire', { unitKey: 'm' }), item('b', 'Chip')] })
    expect(usedBy(s, { kind: 'unit', id: 'm' }).map((r) => r.name)).toEqual(['Wire'])
  })

  it('finds an attribute on an item that has a row for it, even an empty one, once per item', () => {
    const s = make({
      items: [item('a', 'A'), item('b', 'B'), item('c', 'C'), item('d', 'D'), item('e', 'E')],
      itemAttributes: [
        { itemId: 'a', attributeId: 'x', value: '1', axisPosition: null },
        { itemId: 'b', attributeId: 'x', value: null, axisPosition: 0 },
        { itemId: 'c', attributeId: 'x', value: ' ', axisPosition: null },
        { itemId: 'd', attributeId: 'x', value: '', axisPosition: null },
        { itemId: 'e', attributeId: 'y', value: '1', axisPosition: null },
      ],
    })
    expect(usedBy(s, { kind: 'attribute', id: 'x' }).map((r) => r.name)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('counts archived users apart, so active plus archived is the dictionary count', () => {
    const s = make({
      folders: [{ id: 'f', name: 'Old', parentId: null, archivedAt: 'x' }],
      tags: [{ id: 't', name: 'T' }],
      attributes: [{ id: 'x', name: 'X' }],
      units: [],
      items: [
        item('a', 'A', { tagIds: ['t'] }),
        item('b', 'B', { tagIds: ['t'], archivedAt: 'x' }),
        item('c', 'C', { tagIds: ['t'], folderId: 'f' }),
        item('d', 'D'),
      ],
      itemAttributes: [
        { itemId: 'a', attributeId: 'x', value: '', axisPosition: null },
        { itemId: 'b', attributeId: 'x', value: '1', axisPosition: null },
        { itemId: 'c', attributeId: 'x', value: null, axisPosition: 0 },
      ],
    })
    const dv = dictionaryView(s)
    const counts = {
      tag: dv.tags.find((t) => t.tag.id === 't'),
      attribute: dv.attributes.find((x) => x.attribute.id === 'x'),
      unit: dv.units.find((u) => u.unit.key === 'pcs'),
    }
    for (const kind of ['tag', 'attribute', 'unit'] as const) {
      const id = kind === 'tag' ? 't' : kind === 'attribute' ? 'x' : 'pcs'
      const target = { kind, id }
      expect(usedBy(s, target).length + usedByArchivedCount(s, target)).toBe(counts[kind]?.itemCount)
      expect(usedByArchivedCount(s, target)).toBe(2)
    }
  })

  it('gives the folder path, the folder name and drops items under an archived folder', () => {
    const folder = (id: string, name: string, parentId: string | null, archivedAt: string | null = null) => ({ id, name, parentId, archivedAt })
    const s = make({
      folders: [folder('f1', 'ICs', null), folder('f2', 'Op-amps', 'f1'), folder('f3', 'Old', null, 'x')],
      items: [item('a', 'TL072', { folderId: 'f2', tagIds: ['t'] }), item('b', 'Root', { tagIds: ['t'] }), item('c', 'Gone', { folderId: 'f3', tagIds: ['t'] })],
    })
    const rows = usedBy(s, { kind: 'tag', id: 't' })
    expect(rows.map((r) => [r.name, r.path, r.folderName])).toEqual([
      ['Root', '', null],
      ['TL072', 'ICs / Op-amps', 'Op-amps'],
    ])
  })
})

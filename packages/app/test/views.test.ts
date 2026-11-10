import {
  createSearch,
  formatAmountParts,
  isOutOfStock,
  itemStock,
  newId,
  resolveUnit,
  type InventorySnapshot,
  type InventoryStorage,
  type Photo,
} from '@graymatter/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import type { SourceConfig } from '../app/lib/types'
import {
  collapseCrumbs,
  folderTree,
  folderView,
  indexStats,
  inventoryItemCount,
  moveTargets,
  searchRows,
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

beforeAll(async () => {
  const conn = await createDemoDriver({ memory: true, extras: false }).connect(cfg)
  storage = conn.storage
  inventoryId = (await storage.listInventories()).find((i) => i.name === 'Electronics')!.id
  snap = await storage.loadInventory(inventoryId)
})

describe('folderView', () => {
  it('lists root folders by name with subtree item counts', () => {
    const v = folderView(snap, null)!
    expect(v.folder).toBeNull()
    expect(v.crumbs).toEqual([])
    expect(names(v.folders)).toEqual(['ICs', 'Passive components', expect.stringContaining('Очень длинное')])
    expect(v.folders.map((f) => f.itemCount)).toEqual([3, 1, 0])
  })

  it('builds crumbs and item rows', () => {
    const v = folderView(snap, idOf(snap, 'Op-amps'))!
    expect(names(v.crumbs)).toEqual(['ICs', 'Op-amps'])
    const tl = v.items.find((i) => i.name === 'TL072')!
    expect(tl.number).toBe('37')
    expect(tl.unit).toBe('pcs')
    expect(tl.outOfStock).toBe(false)
    expect(tl.coverUrl).toBeNull()
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
    const row = rows.find((r) => r.variantName === '10k')!
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

  it('counts active items in each subtree, like the folder list', () => {
    const tree = folderTree(snap)
    expect(tree.map((n) => n.itemCount)).toEqual([3, 1, 0])
    expect(tree[0]!.children.map((n) => n.itemCount)).toEqual([1])
    expect(tree[1]!.children.map((n) => [n.name, n.itemCount])).toEqual([['Resistors', 1]])
    expect(tree.map((n) => n.itemCount)).toEqual(folderView(snap, null)!.folders.map((f) => f.itemCount))
  })
})

describe('inventoryItemCount', () => {
  it('counts active items in the whole inventory', () => {
    expect(inventoryItemCount(snap)).toBe(4)
    const s = structuredClone(snap)
    s.items.find((i) => i.name === 'TL072')!.archivedAt = '2026-11-10T00:00:00Z'
    expect(inventoryItemCount(s)).toBe(3)
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
    const own = (await createDemoDriver({ memory: true, extras: false }).connect({ ...cfg, id: 'agree' })).storage
    const inv = (await own.listInventories()).find((i) => i.name === 'Electronics')!.id
    let s = await own.loadInventory(inv)
    const resistor = s.items.find((i) => i.name === 'Резистор 0,25 Вт')!.id
    const v100k = s.variants.find((v) => v.itemId === resistor && v.name === '100k')!.id
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
        expect([row.number, row.unit]).toEqual(Object.values(formatAmountParts(stock.quantity, unit)))
        expect(row.outOfStock).toBe(isOutOfStock(stock))
        seen.push(`${row.name} ${row.number}`)
      }
    }
    expect(seen).toContain('Резистор 0,25 Вт 100')
    expect(seen).toHaveLength(4)
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
    expect(folderView(s, idOf(s, 'Resistors'))!.items[0]!.coverUrl).toBe('first.jpg')
    const onlyVariant = clone()
    onlyVariant.photos = [photo(item.id, variant.id, 0, 'variant.jpg')]
    expect(folderView(onlyVariant, idOf(onlyVariant, 'Resistors'))!.items[0]!.coverUrl).toBeNull()
  })

  it('falls back to pcs for an unknown unit', () => {
    const s = clone()
    s.items.find((i) => i.name === 'TL072')!.unitKey = 'custom:gone'
    const row = folderView(s, idOf(s, 'Op-amps'))!.items[0]!
    expect(row.unit).toBe('pcs')
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

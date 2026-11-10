import { createSearch, newId, type InventorySnapshot, type InventoryStorage } from '@graymatter/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import type { SourceConfig } from '../app/lib/types'
import { collapseCrumbs, folderTree, folderView, searchRows, type Crumb } from '../app/lib/views'

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
  const conn = await createDemoDriver({ memory: true }).connect(cfg)
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
})

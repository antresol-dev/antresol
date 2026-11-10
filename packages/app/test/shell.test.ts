import { newId, type InventorySnapshot } from '@graymatter/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { inventoryScoped, NAV_SECTIONS, sectionOf, showsTree, treeCurrent } from '../app/lib/shell'
import type { SourceConfig } from '../app/lib/types'

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}

let snap: InventorySnapshot
let opamps: string
let tl072: string

beforeAll(async () => {
  const { storage } = await createDemoDriver({ memory: true }).connect(cfg)
  const inventoryId = (await storage.listInventories()).find((i) => i.name === 'Electronics')!.id
  snap = await storage.loadInventory(inventoryId)
  opamps = snap.folders.find((f) => f.name === 'Op-amps')!.id
  tl072 = snap.items.find((i) => i.name === 'TL072')!.id
})

describe('shell', () => {
  it('lists the sections of the app panel', () => {
    expect(NAV_SECTIONS).toEqual([{ key: 'items', to: '/' }])
  })

  it('maps routes to sections', () => {
    expect(['index', 'folder-id', 'item-id'].map(sectionOf)).toEqual(['items', 'items', 'items'])
    expect(['archive', 'dictionaries', 'settings', 'settings-sources-id', 'settings-sources-new'].map(sectionOf))
      .toEqual(['archive', 'dictionaries', 'settings', 'settings', 'settings'])
    expect([sectionOf('welcome'), sectionOf(null), sectionOf(undefined)]).toEqual([null, null, null])
    expect(['index', 'item-id', 'archive', 'settings'].map(showsTree)).toEqual([true, true, false, false])
    expect([showsTree('folder-id'), showsTree('welcome'), showsTree(null)]).toEqual([true, false, false])
  })

  it('tells inventory screens from the rest', () => {
    expect(['index', 'folder-id', 'item-id', 'archive', 'dictionaries'].map(inventoryScoped)).toEqual([true, true, true, true, true])
    expect(['settings', 'settings-sources-id', 'settings-sources-new', 'welcome'].map(inventoryScoped))
      .toEqual([false, false, false, false])
    expect([inventoryScoped(null), inventoryScoped(undefined)]).toEqual([false, false])
  })

  it('finds the current tree row', () => {
    expect(treeCurrent(snap, 'index', {})).toBe('root')
    expect(treeCurrent(snap, 'folder-id', { id: opamps })).toBe(opamps)
    expect(treeCurrent(snap, 'item-id', { id: tl072 })).toBe(opamps)
    expect(treeCurrent(snap, 'item-id', { id: newId() })).toBeNull()
    expect(treeCurrent(null, 'index', {})).toBeNull()
    expect(treeCurrent(snap, 'archive', {})).toBeNull()
    expect(treeCurrent(snap, 'folder-id', {})).toBeNull()
  })

  it('puts an item without a folder on the root row', () => {
    const s = structuredClone(snap)
    s.items.find((i) => i.id === tl072)!.folderId = null
    expect(treeCurrent(s, 'item-id', { id: tl072 })).toBe('root')
  })
})

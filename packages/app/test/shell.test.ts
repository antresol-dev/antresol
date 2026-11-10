import { newId, type InventorySnapshot } from '@graymatter/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import {
  currentInventoryName,
  inventoryScoped,
  NAV_SECTIONS,
  sectionOf,
  showsInside,
  showsTree,
  treeAriaCurrent,
  treeCurrent,
} from '../app/lib/shell'
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
let ics: string
let resistors: string
let tl072: string

beforeAll(async () => {
  const { storage } = await createDemoDriver({ memory: true, extras: false }).connect(cfg)
  const inventoryId = (await storage.listInventories()).find((i) => i.name === 'Electronics')!.id
  snap = await storage.loadInventory(inventoryId)
  opamps = snap.folders.find((f) => f.name === 'Op-amps')!.id
  ics = snap.folders.find((f) => f.name === 'ICs')!.id
  resistors = snap.folders.find((f) => f.name === 'Resistors')!.id
  tl072 = snap.items.find((i) => i.name === 'TL072')!.id
})

describe('shell', () => {
  it('lists the sections of the app panel', () => {
    expect(NAV_SECTIONS.map((s) => s.key)).toEqual(['items', 'dictionaries', 'archive'])
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

  it('marks the current tree row as the page only on its own screen', () => {
    expect(treeAriaCurrent('root', true, 'index', {})).toBe('page')
    expect(treeAriaCurrent(opamps, true, 'folder-id', { id: opamps })).toBe('page')
    // On an item card its folder (or the root) is current, but it isn't the page.
    expect(treeAriaCurrent(opamps, true, 'item-id', { id: tl072 })).toBe('true')
    expect(treeAriaCurrent('root', true, 'item-id', { id: tl072 })).toBe('true')
    expect(treeAriaCurrent(ics, false, 'folder-id', { id: opamps })).toBeUndefined()
  })

  it('puts an item without a folder on the root row', () => {
    const s = structuredClone(snap)
    s.items.find((i) => i.id === tl072)!.folderId = null
    expect(treeCurrent(s, 'item-id', { id: tl072 })).toBe('root')
  })

  it('tells whether the open screen is inside a folder', () => {
    // The folder itself, a folder below it, an item below it.
    expect(showsInside(snap, 'folder-id', { id: ics }, ics)).toBe(true)
    expect(showsInside(snap, 'folder-id', { id: opamps }, ics)).toBe(true)
    expect(showsInside(snap, 'item-id', { id: tl072 }, ics)).toBe(true)
    // The parent, a sibling branch, the root and screens outside the tree.
    expect(showsInside(snap, 'folder-id', { id: ics }, opamps)).toBe(false)
    expect(showsInside(snap, 'folder-id', { id: resistors }, ics)).toBe(false)
    expect(showsInside(snap, 'index', {}, ics)).toBe(false)
    expect(showsInside(snap, 'archive', {}, ics)).toBe(false)
    expect(showsInside(null, 'folder-id', { id: ics }, ics)).toBe(false)
    expect(showsInside(snap, 'folder-id', { id: newId() }, ics)).toBe(false)
  })

  it('names the current inventory', () => {
    const electronics = { sourceId: 'demo', inventoryId: snap.inventory.id }
    const workshop = { sourceId: 'demo', inventoryId: newId() }
    const listed = [
      { ref: electronics, inventory: { ...snap.inventory, name: 'Electronics (listed)' }, sourceName: 'Demo' },
      { ref: workshop, inventory: { ...snap.inventory, id: workshop.inventoryId, name: 'Workshop' }, sourceName: 'Demo' },
    ]
    // The snapshot's name once it is the current inventory's, also before the list arrives.
    expect(currentInventoryName({ snapshot: snap, current: electronics, inventories: listed })).toBe('Electronics')
    expect(currentInventoryName({ snapshot: snap, current: electronics, inventories: [] })).toBe('Electronics')
    // Switching: the snapshot is still the old inventory's.
    expect(currentInventoryName({ snapshot: snap, current: workshop, inventories: listed })).toBe('Workshop')
    expect(currentInventoryName({ snapshot: null, current: workshop, inventories: [] })).toBe('')
    expect(currentInventoryName({ snapshot: snap, current: null, inventories: listed })).toBe('')
  })
})

import { newId, type InventorySnapshot } from '@graymatter/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import {
  currentInventoryName,
  inventoryScoped,
  launchAction,
  launchReady,
  themeColorMeta,
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

// One database for the file, closed at the end.
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  const { storage } = await driver.connect(cfg)
  const inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
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

describe('launchAction', () => {
  it('reads the PWA shortcut from the query', () => {
    expect(launchAction({ action: 'add' })).toBe('add')
    expect(launchAction({ action: 'search' })).toBe('search')
  })
  it('ignores anything else', () => {
    expect(launchAction({})).toBeNull()
    expect(launchAction({ action: 'nope' })).toBeNull()
    expect(launchAction({ action: ['add', 'search'] })).toBeNull()
    expect(launchAction({ action: null })).toBeNull()
  })
})

describe('launchReady', () => {
  const src = (status: string) => [{ config: { id: 's1' }, status }]
  const cur = { sourceId: 's1', inventoryId: 'i1' }
  it('waits for a current inventory whose source has left connecting', () => {
    expect(launchReady({ current: null, sources: src('ready') })).toBe(false)
    expect(launchReady({ current: cur, sources: src('connecting') })).toBe(false)
    expect(launchReady({ current: cur, sources: src('ready') })).toBe(true)
    expect(launchReady({ current: cur, sources: src('unreachable') })).toBe(true)
  })
})

describe('themeColorMeta', () => {
  it('system: one tag per colour scheme', () => {
    expect(themeColorMeta('system', 'dark')).toEqual([
      { key: 'theme-color-light', name: 'theme-color', content: '#EDEFF3', media: '(prefers-color-scheme: light)' },
      { key: 'theme-color-dark', name: 'theme-color', content: '#2A2E37', media: '(prefers-color-scheme: dark)' },
    ])
  })
  it('manual choice: a single tag without media', () => {
    expect(themeColorMeta('dark', 'dark')).toEqual([{ key: 'theme-color', name: 'theme-color', content: '#2A2E37' }])
    expect(themeColorMeta('light', 'light')).toEqual([{ key: 'theme-color', name: 'theme-color', content: '#EDEFF3' }])
  })
})

describe('themeColorMeta tokens', () => {
  it('matches the --background tokens of both themes', async () => {
    const { default: css } = await import('../app/assets/css/main.css?raw')
    const bg = [...css.matchAll(/--background:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!.toUpperCase())
    expect(themeColorMeta('system', 'light').map((m) => m.content)).toEqual(bg)
  })
})

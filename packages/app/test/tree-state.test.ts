import { newId, type InventorySnapshot, type InventoryStorage } from '@antresol/core'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { collapseAll, expandAll, loadTreeItems, longPressExpands, loadTreeOpen, openPath, rootItemRows, rowClickAction, saveTreeItems, saveTreeOpen, toggleOpen, treeRows } from '../app/lib/tree-state'
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
let snap: InventorySnapshot
let ics: string
let opamps: string
let passive: string
let resistors: string

// One database for the file, closed at the end.
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  storage = (await driver.connect(cfg)).storage
  inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  snap = await storage.loadInventory(inventoryId)
  const idOf = (name: string): string => snap.folders.find((f) => f.name === name)!.id
  ics = idOf('ICs')
  opamps = idOf('Op-amps')
  passive = idOf('Passive components')
  resistors = idOf('Resistors')
})

/** A Map-backed stand-in for window.localStorage; the test environment has none. */
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rowClickAction', () => {
  it('selects a folder that is not open, toggles the one whose screen is open', () => {
    expect(rowClickAction(false)).toBe('select')
    expect(rowClickAction(true)).toBe('toggle')
  })
})

describe('treeRows', () => {
  it('starts collapsed with subtree piece sums', () => {
    expect(treeRows(snap, {}, 'root').map((r) => [r.name, r.pieces, r.hasChildren, r.open, r.children.length]))
      .toEqual([['ICs', '43', true, false, 0], ['Passive components', '100', true, false, 0], [expect.stringContaining('Очень длинное'), null, false, false, 0]])
    expect(treeRows(snap, {}, 'root').some((r) => r.current)).toBe(false)
  })

  it('opens the path to the current folder and marks it', () => {
    const open = openPath(snap, {}, opamps)
    expect(open).toEqual({ [ics]: true })
    const rows = treeRows(snap, open, opamps)
    expect(rows[0]!.open).toBe(true)
    expect(rows[0]!.current).toBe(false)
    expect(rows[0]!.children.map((r) => [r.name, r.current])).toEqual([['Op-amps', true]])
    expect(openPath(snap, open, opamps)).toBe(open)
  })

  it('opens every ancestor but not the folder itself, and keeps what was open', () => {
    const open = openPath(snap, { [ics]: true }, resistors)
    expect(open).toEqual({ [ics]: true, [passive]: true })
    expect(openPath(snap, open, passive)).toBe(open)
    expect(openPath(snap, open, null)).toBe(open)
    expect(openPath(snap, open, newId())).toBe(open)
  })

  it('does not report a folder without children as open', () => {
    const rows = treeRows(snap, { [opamps]: true, [ics]: true }, null)
    expect(rows[0]!.children[0]!.hasChildren).toBe(false)
    expect(rows[0]!.children[0]!.open).toBe(false)
  })

  it('a long press expands only a closed folder with children', () => {
    expect(longPressExpands(true, false)).toBe(true)
    expect(longPressExpands(true, true)).toBe(false)
    expect(longPressExpands(false, false)).toBe(false)
  })

  it('collapseAll closes everything, expandAll opens every folder with children', () => {
    expect(collapseAll()).toEqual({})
    const all = expandAll(snap)
    expect(all[ics]).toBe(true)
    expect(all[passive]).toBe(true)
    expect(all[opamps]).toBeUndefined()
    const rows = treeRows(snap, all, null)
    const walk = (rs: ReturnType<typeof treeRows>): boolean => rs.every((r) => (!r.hasChildren || r.open) && walk(r.children))
    expect(walk(rows)).toBe(true)
  })

  it('collapseAll and expandAll persist like toggles', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    saveTreeOpen(inventoryId, expandAll(snap))
    expect(Object.keys(loadTreeOpen(inventoryId)).length).toBeGreaterThan(0)
    saveTreeOpen(inventoryId, collapseAll())
    expect(loadTreeOpen(inventoryId)).toEqual({})
  })

  it('toggles a folder open and closed', () => {
    expect(toggleOpen({}, ics)).toEqual({ [ics]: true })
    expect(toggleOpen(toggleOpen({}, ics), ics)).toEqual({})
    const open = { [ics]: true as const }
    toggleOpen(open, passive)
    expect(open).toEqual({ [ics]: true })
  })

  it('skips archived folders and folders under them', async () => {
    await storage.apply({ type: 'archive', target: 'folder', id: ics, archiveId: newId() }, { device: 'Test' })
    const after = await storage.loadInventory(inventoryId)
    const rows = treeRows(after, { [ics]: true, [passive]: true }, opamps)
    const names = JSON.stringify(rows.map(function flat(r): unknown { return [r.name, r.children.map(flat)] }))
    expect(names).not.toContain('ICs')
    expect(names).not.toContain('Op-amps')
    expect(rows.map((r) => r.name)).toEqual(['Passive components', expect.stringContaining('Очень длинное')])
    expect(rows[0]!.children.map((r) => r.name)).toEqual(['Resistors'])
    expect(rows.some((r) => r.current)).toBe(false)
    const open = {}
    expect(openPath(after, open, opamps)).toBe(open)
  })
})

describe('tree state on the device', () => {
  it('keeps the tree state per inventory and survives a broken storage', () => {
    const store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    saveTreeOpen('inv-a', { [ics]: true })
    expect(store.getItem('antresol-tree:inv-a')).not.toBeNull()
    expect(loadTreeOpen('inv-a')).toEqual({ [ics]: true })
    expect(loadTreeOpen('inv-b')).toEqual({})

    store.setItem('antresol-tree:inv-c', 'not json')
    expect(loadTreeOpen('inv-c')).toEqual({})
    store.setItem('antresol-tree:inv-d', JSON.stringify([ics]))
    expect(loadTreeOpen('inv-d')).toEqual({})
    store.setItem('antresol-tree:inv-e', JSON.stringify({ [ics]: true, [opamps]: 'yes', [passive]: false }))
    expect(loadTreeOpen('inv-e')).toEqual({ [ics]: true })

    vi.stubGlobal('localStorage', {
      ...store,
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(loadTreeOpen('inv-a')).toEqual({})
    expect(() => saveTreeOpen('inv-a', { [ics]: true })).not.toThrow()
  })

  it('reads nothing and writes nowhere without a storage', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadTreeOpen('inv-a')).toEqual({})
    expect(() => saveTreeOpen('inv-a', {})).not.toThrow()
  })
})

describe('items in the tree ("Show items")', () => {
  const active = (folderId: string | null) =>
    snap.items
      .filter((i) => i.folderId === folderId && i.archivedAt === null)
      .map((i) => i.name)
      .sort((a, b) => a.localeCompare(b, 'en'))

  it('without the option the rows carry no items and a folder of items only has no chevron', () => {
    const rows = treeRows(snap, { [ics]: true }, null)
    const op = rows.find((r) => r.id === ics)!.children.find((r) => r.id === opamps)!
    expect(op.items).toEqual([])
    expect(op.hasChildren).toBe(false)
  })

  it('a folder with items opens on them: its items by name after its folders, the current item marked', () => {
    const itemId = snap.items.find((i) => i.folderId === opamps && i.archivedAt === null)!.id
    const closed = treeRows(snap, { [ics]: true }, null, { currentItem: null })
    const op = closed.find((r) => r.id === ics)!.children.find((r) => r.id === opamps)!
    expect([op.hasChildren, op.items]).toEqual([true, []])
    const rows = treeRows(snap, { [ics]: true, [opamps]: true }, opamps, { currentItem: itemId })
    const open = rows.find((r) => r.id === ics)!.children.find((r) => r.id === opamps)!
    expect(open.items.map((i) => i.name)).toEqual(active(opamps))
    expect(open.items.filter((i) => i.current).map((i) => i.id)).toEqual([itemId])
  })

  it('items at the root come by name; expand all opens folders that hold only items', () => {
    expect(rootItemRows(snap, null).map((i) => i.name)).toEqual(active(null))
    expect(expandAll(snap)[opamps]).toBeUndefined()
    expect(expandAll(snap, true)[opamps]).toBe(true)
  })

  it('the option is kept on the device, and off when the storage is empty, broken or throws', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadTreeItems()).toBe(false)
    saveTreeItems(true)
    expect(loadTreeItems()).toBe(true)
    saveTreeItems(false)
    expect(loadTreeItems()).toBe(false)
    localStorage.setItem('antresol-tree-items', 'yes')
    expect(loadTreeItems()).toBe(false)
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(loadTreeItems()).toBe(false)
    expect(() => saveTreeItems(true)).not.toThrow()
  })
})

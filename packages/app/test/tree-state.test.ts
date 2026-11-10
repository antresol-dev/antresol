import { newId, type InventorySnapshot, type InventoryStorage } from '@graymatter/core'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { loadTreeOpen, openPath, saveTreeOpen, toggleOpen, treeRows } from '../app/lib/tree-state'
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

describe('treeRows', () => {
  it('starts collapsed with subtree counts', () => {
    expect(treeRows(snap, {}, 'root').map((r) => [r.name, r.itemCount, r.hasChildren, r.open, r.children.length]))
      .toEqual([['ICs', 3, true, false, 0], ['Passive components', 1, true, false, 0], [expect.stringContaining('Очень длинное'), 0, false, false, 0]])
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
    expect(store.getItem('gm-tree:inv-a')).not.toBeNull()
    expect(loadTreeOpen('inv-a')).toEqual({ [ics]: true })
    expect(loadTreeOpen('inv-b')).toEqual({})

    store.setItem('gm-tree:inv-c', 'not json')
    expect(loadTreeOpen('inv-c')).toEqual({})
    store.setItem('gm-tree:inv-d', JSON.stringify([ics]))
    expect(loadTreeOpen('inv-d')).toEqual({})
    store.setItem('gm-tree:inv-e', JSON.stringify({ [ics]: true, [opamps]: 'yes', [passive]: false }))
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

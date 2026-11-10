import { createSearch, newId, type Actor, type Id, type InventorySnapshot, type InventoryStorage } from '@graymatter/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import {
  bottomUp,
  compactText,
  highlightParts,
  matchFolders,
  paletteActions,
  paletteResults,
  stepSelection,
  type PaletteAction,
  type PaletteContext,
  type PaletteGroup,
} from '../app/lib/palette'
import type { InventoryRef, SourceConfig } from '../app/lib/types'
import type { InventoryEntry } from '../app/lib/workspace'

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}
const actor: Actor = { device: 'Test' }

let storage: InventoryStorage
let inventoryId: Id
let snap: InventorySnapshot
let inventories: InventoryEntry[]
let electronics: InventoryRef
let workshop: InventoryRef
let ics: Id
let opamps: Id

const folderId = (s: InventorySnapshot, name: string): Id => s.folders.find((f) => f.name === name)!.id

async function createFolder(name: string, parentId: Id | null = null): Promise<Id> {
  const id = newId()
  await storage.apply({ type: 'folder.create', id, inventoryId, parentId, name, description: null }, actor)
  return id
}

// One database for the file, closed at the end.
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  const conn = await driver.connect(cfg)
  storage = conn.storage
  inventories = (await storage.listInventories()).map((inventory) => ({
    ref: { sourceId: cfg.id, inventoryId: inventory.id },
    inventory,
    sourceName: cfg.name,
  }))
  electronics = inventories.find((e) => e.inventory.name === 'Electronics')!.ref
  workshop = inventories.find((e) => e.inventory.name === 'Workshop')!.ref
  inventoryId = electronics.inventoryId
  snap = await storage.loadInventory(inventoryId)
  ics = folderId(snap, 'ICs')
  opamps = folderId(snap, 'Op-amps')
})

describe('palette', () => {
  it('compacts like core search', () => {
    expect(compactText(' TL-072 ')).toBe('tl072')
    expect(compactText('Резистор 0,25 Вт')).toBe('резистор025вт')
    expect(compactText(' - ')).toBe('')
  })

  it('highlights the matched part of a name', () => {
    expect(highlightParts('Electrolytic capacitor', 'cap')).toEqual([
      { text: 'Electrolytic ', match: false },
      { text: 'cap', match: true },
      { text: 'acitor', match: false },
    ])
    expect(highlightParts('TL-072 op-amp', 'tl072')).toEqual([
      { text: 'TL-072', match: true },
      { text: ' op-amp', match: false },
    ])
    expect(highlightParts('NE555', 'tl072')).toEqual([{ text: 'NE555', match: false }])
    expect(highlightParts('NE555', ' - ')).toEqual([{ text: 'NE555', match: false }])
  })

  it('keeps separators inside the match and finds the first occurrence', () => {
    expect(highlightParts('Резистор 0,25 Вт', '025')).toEqual([
      { text: 'Резистор ', match: false },
      { text: '0,25', match: true },
      { text: ' Вт', match: false },
    ])
    expect(highlightParts('Cap cap', 'CAP')).toEqual([
      { text: 'Cap', match: true },
      { text: ' cap', match: false },
    ])
    expect(highlightParts('NE555', 'ne555')).toEqual([{ text: 'NE555', match: true }])
    // A character outside the Basic Multilingual Plane (two UTF-16 units) before the match.
    expect(highlightParts('𝐀 TL-072', 'tl072')).toEqual([
      { text: '𝐀 ', match: false },
      { text: 'TL-072', match: true },
    ])
  })

  it('builds the groups: items, folders, actions, the empty ones dropped', () => {
    const label = (a: PaletteAction): string => (a.kind === 'newFolder' ? `New folder in ${a.parentName}` : a.kind === 'addItem' ? `Add item “${a.name}”` : a.kind)
    const ctx: PaletteContext = {
      query: 'ne',
      folder: { id: null, name: 'Electronics' },
      inventories,
      current: electronics,
      sections: ['archive', 'settings'],
      canWrite: true,
    }
    const groups = paletteResults(snap, createSearch(snap), ctx, label)
    expect(groups.map((g) => g.key)).toEqual(['items', 'folders', 'actions'])
    const [items, folders, actions] = groups
    expect(items!.rows[0]).toMatchObject({
      kind: 'item',
      hit: { name: 'NE555', path: 'ICs', number: '0', unit: 'pcs', outOfStock: true },
      name: [{ text: 'NE', match: true }, { text: '555', match: false }],
      variant: null,
    })
    expect(folders!.rows).toMatchObject([{ kind: 'folder', hit: { name: 'Passive components', path: '' } }])
    expect(actions!.rows).toEqual([
      { kind: 'action', key: 'action:add-item', action: { kind: 'addItem', name: 'ne' }, label: 'Add item “ne”' },
      {
        kind: 'action',
        key: 'action:new-folder',
        action: { kind: 'newFolder', parentId: null, parentName: 'Electronics' },
        label: 'New folder in Electronics',
      },
    ])
    // Keys are unique across the groups.
    const keys = groups.flatMap((g) => g.rows.map((r) => r.key))
    expect(new Set(keys).size).toBe(keys.length)

    // A variant hit highlights the variant's name; the empty query lists only the actions.
    const [variantRow] = paletteResults(snap, createSearch(snap), { ...ctx, query: '10k' }, label)[0]!.rows
    expect(variantRow).toMatchObject({
      kind: 'item',
      hit: { name: 'Резистор 0,25 Вт', variantName: '10k' },
      name: [{ text: 'Резистор 0,25 Вт', match: false }],
      variant: [{ text: '10k', match: true }],
    })
    expect(paletteResults(snap, createSearch(snap), { ...ctx, query: '' }, label).map((g) => g.key)).toEqual(['actions'])
    expect(paletteResults(null, null, { ...ctx, query: 'ne' }, label).map((g) => g.key)).toEqual(['actions'])
    // Nothing found: only the offer to add it, and nothing at all when writing is off.
    const none = paletteResults(snap, createSearch(snap), { ...ctx, query: 'zzzz' }, label)
    expect(none.map((g) => g.key)).toEqual(['actions'])
    expect(none[0]!.rows.map((r) => r.key)).toEqual(['action:add-item'])
    expect(paletteResults(snap, createSearch(snap), { ...ctx, query: 'zzzz', canWrite: false }, label)).toEqual([])
  })

  it('turns the groups bottom-up for the phone and steps the selection on screen', () => {
    const row = (key: string) => ({ kind: 'action' as const, key, action: { kind: 'go' as const, section: 'settings' as const }, label: key })
    const groups: PaletteGroup[] = [
      { key: 'items', rows: [row('i1'), row('i2')] },
      { key: 'actions', rows: [row('a1')] },
    ]
    const up = bottomUp(groups)
    expect(up.map((g) => [g.key, g.rows.map((r) => r.key)])).toEqual([
      ['actions', ['a1']],
      ['items', ['i2', 'i1']],
    ])
    expect(groups[0]!.rows.map((r) => r.key)).toEqual(['i1', 'i2'])

    const rows = up.flatMap((g) => g.rows)
    expect(stepSelection(rows, 'i1', -1)?.key).toBe('i2')
    expect(stepSelection(rows, 'i2', -1)?.key).toBe('a1')
    // Stops at both ends.
    expect(stepSelection(rows, 'a1', -1)?.key).toBe('a1')
    expect(stepSelection(rows, 'i1', 1)?.key).toBe('i1')
    // Nothing selected yet: the first row on screen.
    expect(stepSelection(rows, null, 1)?.key).toBe('a1')
    expect(stepSelection([], null, 1)).toBeNull()
  })

  it('finds folders: exact, then prefix, then the rest', async () => {
    await createFolder('Ceramic caps')
    await createFolder('Capacitors')
    await createFolder('Cap')
    const s = await storage.loadInventory(inventoryId)
    expect(matchFolders(s, 'cap').map((f) => f.name)).toEqual(['Cap', 'Capacitors', 'Ceramic caps'])
    expect(matchFolders(s, 'op-amp')).toEqual([{ id: opamps, name: 'Op-amps', path: 'ICs' }])
    expect(matchFolders(s, 'Cap')[0]).toEqual({ id: folderId(s, 'Cap'), name: 'Cap', path: '' })
    expect(matchFolders(s, '')).toEqual([])
    expect(matchFolders(s, ' - ')).toEqual([])
  })

  it('shows the whole parent path and stops at the limit', async () => {
    const smd = await createFolder('SMD', folderId(snap, 'Resistors'))
    for (const name of ['Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5', 'Box 6']) await createFolder(name)
    const s = await storage.loadInventory(inventoryId)
    expect(matchFolders(s, 'smd')).toEqual([{ id: smd, name: 'SMD', path: 'Passive components / Resistors' }])
    expect(matchFolders(s, 'box').map((f) => f.name)).toEqual(['Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5'])
    expect(matchFolders(s, 'box', 2).map((f) => f.name)).toEqual(['Box 1', 'Box 2'])
  })

  it('skips archived folders and folders under them', async () => {
    expect(matchFolders(snap, 'op').map((f) => f.name)).toEqual(['Op-amps'])
    await storage.apply({ type: 'archive', target: 'folder', id: ics, archiveId: newId() }, actor)
    const s = await storage.loadInventory(inventoryId)
    expect(matchFolders(s, 'op')).toEqual([])
    expect(matchFolders(s, 'ics')).toEqual([])
  })

  it('offers actions for the query', () => {
    const label = (a: PaletteAction): string =>
      a.kind === 'newFolder'
        ? `New folder in ${a.parentName}`
        : a.kind === 'switchInventory'
          ? `Switch to ${a.name}`
          : a.kind === 'addItem'
            ? `Add item “${a.name}”`
            : a.section
    const ctx: PaletteContext = {
      query: '',
      folder: { id: ics, name: 'ICs' },
      inventories,
      current: electronics,
      sections: ['archive', 'settings'],
      canWrite: true,
    }
    expect(paletteActions(ctx, label)).toEqual([
      { kind: 'newFolder', parentId: ics, parentName: 'ICs' },
      { kind: 'switchInventory', ref: workshop, name: 'Workshop' },
      { kind: 'go', section: 'archive' },
      { kind: 'go', section: 'settings' },
    ])
    expect(paletteActions({ ...ctx, query: 'work' }, label)).toEqual([
      { kind: 'addItem', name: 'work' },
      { kind: 'switchInventory', ref: workshop, name: 'Workshop' },
    ])
    expect(paletteActions({ ...ctx, query: 'NEW-folder' }, label).map((a) => a.kind)).toEqual(['addItem', 'newFolder'])
    expect(paletteActions({ ...ctx, query: 'zzz' }, label)).toEqual([{ kind: 'addItem', name: 'zzz' }])
    expect(paletteActions({ ...ctx, query: 'zzz', canWrite: false }, label)).toEqual([])
    expect(paletteActions({ ...ctx, canWrite: false }, label).map((a) => a.kind)).not.toContain('newFolder')
    expect(paletteActions({ ...ctx, folder: null }, label).map((a) => a.kind)).not.toContain('newFolder')
    // At the root the new folder goes to the inventory root.
    expect(paletteActions({ ...ctx, folder: { id: null, name: 'Electronics' } }, label)[0]).toEqual({
      kind: 'newFolder',
      parentId: null,
      parentName: 'Electronics',
    })
    // No current inventory: every inventory is a switch target.
    expect(
      paletteActions({ ...ctx, current: null, folder: null }, label).filter((a) => a.kind === 'switchInventory'),
    ).toHaveLength(2)
  })

  it('offers to add an item first, only for a query and when writing is allowed', () => {
    const label = (a: PaletteAction): string =>
      a.kind === 'addItem' ? `Add item “${a.name}”` : a.kind === 'newFolder' ? `New folder in ${a.parentName}` : a.kind === 'go' ? a.section : 'x'
    const ctx: PaletteContext = {
      query: 'tl074',
      folder: { id: ics, name: 'ICs' },
      inventories,
      current: electronics,
      sections: ['archive'],
      canWrite: true,
    }
    expect(paletteActions(ctx, label)[0]).toEqual({ kind: 'addItem', name: 'tl074' })
    expect(paletteActions({ ...ctx, query: '' }, label).map((a) => a.kind)).not.toContain('addItem')
    expect(paletteActions({ ...ctx, query: '  ' }, label).map((a) => a.kind)).not.toContain('addItem')
    expect(paletteActions({ ...ctx, canWrite: false }, label).map((a) => a.kind)).not.toContain('addItem')
  })
})

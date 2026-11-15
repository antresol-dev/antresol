import { createSearch, newId, variantDisplayLabel, variantLabel, type Actor, type Id, type InventorySnapshot, type InventoryStorage } from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import {
  bottomUp,
  compactText,
  highlightParts,
  matchFolders,
  paletteActions,
  ITEM_LIMIT,
  paletteResults,
  searchAcross,
  pastedShare,
  snapshotSearch,
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
  inventories = (await storage.listInventories()).inventories.map((inventory) => ({
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

    const resistor = snap.items.find((i) => i.name === 'Резистор 0,25 Вт')!
    const label10k = variantDisplayLabel(snap, snap.variants.find((v) => v.itemId === resistor.id && variantLabel(snap, v).replace(/\s/g, '').toLowerCase().startsWith('10k'))!)
    // A variant hit highlights the variant's label; the empty query lists only the actions.
    const [variantRow] = paletteResults(snap, createSearch(snap), { ...ctx, query: '10k' }, label)[0]!.rows
    expect(variantRow).toMatchObject({
      kind: 'item',
      hit: { name: 'Резистор 0,25 Вт', variantName: label10k },
      name: [{ text: 'Резистор 0,25 Вт', match: false }],
    })
    expect(variantRow).toMatchObject({ variant: expect.any(Array) })
    // The variant line shows its label (axis values), not a name.
    expect((variantRow as { variant: { text: string }[] }).variant.map((p) => p.text).join('')).toBe(label10k)
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

  it('opens the share sheet for a pasted link or long title, never for a query that looks like a file', () => {
    expect(pastedShare('tl072.pdf')).toBeNull()
    expect(pastedShare('ne5532')).toBeNull()
    expect(pastedShare(' https://www.aliexpress.com/item/1005001234567890.html ')).toEqual({
      text: 'https://www.aliexpress.com/item/1005001234567890.html',
    })
    expect(pastedShare('600PCS 1/4W Metal Film Resistor 1% 10K 4.7K')).toEqual({ text: '600PCS 1/4W Metal Film Resistor 1% 10K 4.7K' })
  })

  it('shows pinned values on item rows', () => {
    const s = structuredClone(snap)
    const at = '2026-11-10T00:00:00Z'
    s.attributes.push({ id: 'a-pkg', inventoryId, name: 'Package', kind: 'enum', options: ['DIP-8'], unit: '', siPrefixes: false, pinned: true, createdAt: at, updatedAt: at, createdBy: 'T', updatedBy: 'T' })
    const ne = s.items.find((i) => i.name === 'NE555')!.id
    s.itemAttributes.push({ itemId: ne, attributeId: 'a-pkg', value: 'DIP-8', axisPosition: null })
    const ctx: PaletteContext = { query: 'ne555', folder: null, inventories, current: electronics, sections: [], canWrite: true }
    const [row] = paletteResults(s, snapshotSearch(s), ctx, () => '')[0]!.rows
    expect(row).toMatchObject({ kind: 'item', hit: { name: 'NE555', pinned: ['DIP-8'] } })
  })

  it('builds one search per snapshot', () => {
    expect(snapshotSearch(snap)).toBe(snapshotSearch(snap))
    expect(snapshotSearch(structuredClone(snap))).not.toBe(snapshotSearch(snap))
  })

  it('suggests the nearest values first when nobody holds the typed one', () => {
    const ctx: PaletteContext = { query: '4k7', folder: null, inventories, current: electronics, sections: [], canWrite: true }
    const groups = paletteResults(snap, snapshotSearch(snap), ctx, () => '')
    expect(groups[0]!.key).toBe('nearest')
    const row = groups[0]!.rows[0]!
    expect(row).toMatchObject({ kind: 'nearest', suggestion: { wanted: '4.7 kΩ', above: { value: '10 kΩ' } } })
    // Something holds 10 kΩ: no suggestion, and a bare number or a case code is no value at all.
    for (const query of ['10k', '104', '600']) {
      const g = paletteResults(snap, snapshotSearch(snap), { ...ctx, query }, () => '')
      expect(g.some((x) => x.key === 'nearest')).toBe(false)
    }
  })
})

describe('palette across inventories', () => {
  let box3: Id
  let zinc: Id
  let ele: InventorySnapshot
  let work: InventorySnapshot
  const labelOf = (a: PaletteAction): string => (a.kind === 'addItem' ? `Add item “${a.name}”` : a.kind)

  async function createItem(inv: Id, name: string, folderId: Id | null): Promise<Id> {
    const id = newId()
    await storage.apply(
      { type: 'item.create', id, inventoryId: inv, folderId, name, description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
      actor,
    )
    return id
  }

  beforeAll(async () => {
    box3 = newId()
    await storage.apply({ type: 'folder.create', id: box3, inventoryId: workshop.inventoryId, parentId: null, name: 'Box 3', description: null }, actor)
    zinc = newId()
    await storage.apply({ type: 'folder.create', id: zinc, inventoryId: workshop.inventoryId, parentId: null, name: 'Zinc rack', description: null }, actor)
    await createItem(workshop.inventoryId, 'Hammer set', box3)
    await createItem(workshop.inventoryId, 'Hammer root', null)
    await createItem(electronics.inventoryId, 'Hammer toy', null)
    for (let i = 1; i <= 25; i++) await createItem(workshop.inventoryId, `Bolt ${i}`, null)
    for (let i = 1; i <= 3; i++) await createItem(electronics.inventoryId, `Bolt e${i}`, null)
    ele = await storage.loadInventory(electronics.inventoryId)
    work = await storage.loadInventory(workshop.inventoryId)
  })

  const entryOf = (ref: InventoryRef): InventoryEntry => inventories.find((e) => e.ref.inventoryId === ref.inventoryId)!
  const ctxFor = (query: string, others: PaletteContext['others'], current = electronics): PaletteContext => ({
    query,
    folder: null,
    inventories,
    current,
    sections: ['settings'],
    canWrite: true,
    others,
  })
  const itemsOf = (groups: PaletteGroup[]) => groups.find((g) => g.key === 'items')?.rows ?? []

  it('searches nothing else while the chip is off', () => {
    const off = paletteResults(ele, createSearch(ele), ctxFor('hammer', null), labelOf)
    const unset = paletteResults(ele, createSearch(ele), { ...ctxFor('hammer', null), others: undefined }, labelOf)
    expect(off).toEqual(unset)
    expect(itemsOf(off).every((r) => r.kind === 'item' && r.inventory === null)).toBe(true)
  })

  it('lists the current inventory first, then the others with their name and path', () => {
    const groups = paletteResults(ele, createSearch(ele), ctxFor('hammer', [{ entry: entryOf(workshop), snapshot: work }]), labelOf)
    const rows = itemsOf(groups)
    const own = rows.filter((r) => r.kind === 'item' && r.inventory === null)
    const foreign = rows.filter((r) => r.kind === 'item' && r.inventory !== null)
    expect(rows.slice(0, own.length)).toEqual(own)
    expect(own.length).toBeGreaterThan(0)
    const hammer = foreign.find((r) => r.kind === 'item' && r.hit.name === 'Hammer set')!
    expect(hammer).toMatchObject({ inventory: { ref: workshop, name: 'Workshop' }, hit: { path: 'Workshop · Box 3' } })
    expect(foreign.find((r) => r.kind === 'item' && r.hit.name === 'Hammer root')).toMatchObject({ hit: { path: 'Workshop' } })
    const boxes = paletteResults(ele, createSearch(ele), ctxFor('zinc', [{ entry: entryOf(workshop), snapshot: work }]), labelOf)
    expect(boxes.find((g) => g.key === 'folders')!.rows.find((r) => r.kind === 'folder' && r.inventory !== null)).toMatchObject({
      kind: 'folder',
      key: `folder:demo:${workshop.inventoryId}:${zinc}`,
      inventory: { name: 'Workshop' },
      hit: { name: 'Zinc rack', path: 'Workshop' },
    })
  })

  it('keeps ITEM_LIMIT in all and never displaces the current inventory', () => {
    const others = [{ entry: entryOf(workshop), snapshot: work }]
    const mixed = itemsOf(paletteResults(ele, createSearch(ele), ctxFor('bolt', others), labelOf))
    expect(mixed).toHaveLength(ITEM_LIMIT)
    expect(mixed.slice(0, 3).every((r) => r.kind === 'item' && r.inventory === null)).toBe(true)
    expect(mixed.slice(3).every((r) => r.kind === 'item' && r.inventory?.name === 'Workshop')).toBe(true)
    const ownFull = itemsOf(paletteResults(work, createSearch(work), ctxFor('bolt', [{ entry: entryOf(electronics), snapshot: ele }], workshop), labelOf))
    expect(ownFull).toHaveLength(ITEM_LIMIT)
    expect(ownFull.every((r) => r.kind === 'item' && r.inventory === null)).toBe(true)
  })

  it('skips archived inventories silently and counts those without a copy', () => {
    const archived: InventoryEntry = {
      ...entryOf(workshop),
      inventory: { ...entryOf(workshop).inventory, archivedAt: '2026-11-01T00:00:00Z' },
    }
    const arch = paletteResults(ele, createSearch(ele), ctxFor('hammer', [{ entry: archived, snapshot: work }]), labelOf)
    expect(itemsOf(arch).every((r) => r.kind === 'item' && r.inventory === null)).toBe(true)
    expect(arch.find((g) => g.key === 'items')!.skipped).toBeUndefined()
    const noCopy = paletteResults(ele, createSearch(ele), ctxFor('hammer', [{ entry: entryOf(workshop), snapshot: null }, { entry: archived, snapshot: null }]), labelOf)
    expect(noCopy.find((g) => g.key === 'items')!.skipped).toBe(1)
  })

  it('keys rows of equal ids in two sources apart', () => {
    const other: InventoryEntry = { ...entryOf(electronics), ref: { sourceId: 'second', inventoryId: electronics.inventoryId } }
    const groups = paletteResults(ele, createSearch(ele), ctxFor('bolt e1', [{ entry: other, snapshot: ele }]), labelOf)
    const keys = itemsOf(groups).map((r) => r.key)
    const own = keys.filter((k) => !k.startsWith('item:second:'))
    expect(own.length).toBeGreaterThan(0)
    expect(keys).toHaveLength(own.length * 2)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('offers actions of the current inventory only', () => {
    const withOthers = paletteResults(ele, createSearch(ele), ctxFor('zzz', [{ entry: entryOf(workshop), snapshot: work }]), labelOf)
    const without = paletteResults(ele, createSearch(ele), ctxFor('zzz', null), labelOf)
    expect(withOthers).toEqual(without)
  })

  it('searchAcross is pure and reusable', () => {
    const r = searchAcross([{ entry: entryOf(workshop), snapshot: work }], 'bolt', 4)
    expect(r.items).toHaveLength(4)
    expect(r.skipped).toBe(0)
    expect(searchAcross([{ entry: entryOf(workshop), snapshot: null }], 'bolt', 4)).toEqual({ items: [], folders: [], skipped: 1 })
  })
})

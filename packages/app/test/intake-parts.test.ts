import { customUnitKey, emptyIntakeDraft, newId, type DraftLine, type DraftNewItem, type Id, type IntakeDraftContent, type InventorySnapshot } from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import {
  listHas,
  similarFolders,
  similarItems,
  undoTo,
  unitChoicesWithDraft,
  unitTaken,
  withEditedTag,
  withHeldOptions,
  withHeldUnits,
  withoutAddedValue,
  withoutAttributeEverywhere,
  withoutTagEverywhere,
  withoutUnitEverywhere,
  withRenamedAddedValue,
  writeHeldOptions,
  writeHeldUnits,
} from '../app/lib/intake-parts'
import type { SourceConfig } from '../app/lib/types'

const cfg: SourceConfig = { id: 'demo', kind: 'dev-pglite', name: 'Demo', connectionString: '', uploadcarePublicKey: null, createdAt: '2026-11-10T00:00:00Z' }
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

let s: InventorySnapshot
let list: { id: Id; options: string[] }
beforeAll(async () => {
  const conn = await driver.connect(cfg)
  const inv = (await conn.storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!
  s = await conn.storage.loadInventory(inv.id)
  const id = newId()
  await conn.storage.apply({ type: 'attribute.create', id, inventoryId: inv.id, name: 'Package', kind: 'enum', options: ['0603', '1206'], unit: '', siPrefixes: false }, { device: 'Test' })
  s = await conn.storage.loadInventory(inv.id)
  list = { id, options: ['0603', '1206'] }
})

const item = (over: Partial<DraftNewItem> = {}): DraftNewItem => ({ id: newId(), name: 'Widget', folderId: null, unitKey: 'pcs', attributes: [], ...over })
const unit = { id: newId(), name: 'Reels', symbol: 'reel', prefixPowers: [] as number[] }
const base = (): IntakeDraftContent => emptyIntakeDraft()

describe('held units', () => {
  it('shows the held unit in the choices and writes it only when an item counts in it', () => {
    const draft = withHeldUnits(base(), [unit])
    expect(unitChoicesWithDraft(s, draft).some((u) => u.key === customUnitKey(unit.id))).toBe(true)
    const kept = writeHeldUnits(base(), s, [unit], new Set([customUnitKey(unit.id)]))
    expect('errorKey' in kept ? null : kept.newUnits).toEqual([unit])
    const dropped = writeHeldUnits(base(), s, [unit], new Set(['pcs']))
    expect('errorKey' in dropped ? null : dropped.newUnits).toBeUndefined()
  })
  it('refuses a unit another one has taken since', () => {
    const other = { ...unit, id: newId() }
    const r = writeHeldUnits({ ...base(), newUnits: [other] }, s, [unit], new Set([customUnitKey(unit.id)]))
    expect(r).toMatchObject({ errorKey: 'intakes.unit.duplicate' })
  })
  it('knows built-in, custom and draft units by name (no case) and symbol (with case)', () => {
    expect(unitTaken(s, base(), { name: 'Meters' })).toBe(true)
    expect(unitTaken(s, base(), { symbol: 'm' })).toBe(true)
    expect(unitTaken(s, base(), { symbol: 'M' })).toBe(false)
    const d = { ...base(), newUnits: [unit] }
    expect(unitTaken(s, d, { name: ' reels ' })).toBe(true)
    expect(unitTaken(s, d, { name: 'Reels' }, unit.id)).toBe(false)
  })
})

describe('added list values', () => {
  it('writes a held value once and skips one the list has', () => {
    const w = writeHeldOptions(base(), s, [{ attributeId: list.id, value: ' 0805x ' }, { attributeId: list.id, value: '0805X' }])
    expect('errorKey' in w ? null : w.addedOptions).toEqual([{ attributeId: list.id, values: ['0805x'] }])
    expect(writeHeldOptions(base(), s, [{ attributeId: list.id, value: '0603' }])).toEqual(base())
    expect(listHas(list.options, withHeldOptions(base(), [{ attributeId: list.id, value: 'zz' }]), list.id, 'ZZ')).toBe(true)
  })
  it('removing a value takes the lines that use it', () => {
    const line: DraftLine = { id: newId(), itemId: 'x', axisValues: [{ attributeId: list.id, value: 'zz' }], quantity: '1', totalPrice: null, sourceUrl: null, photo: null, ids: { movementId: newId(), variantId: newId(), photoId: newId() } }
    const d = { ...base(), addedOptions: [{ attributeId: list.id, values: ['zz', 'yy'] }], lines: [line] }
    const r = withoutAddedValue(d, list.id, 'ZZ')
    expect(r.lines).toEqual([])
    expect(r.addedOptions ?? []).toEqual([])
  })
  it('renames a value on the lines and refuses one that exists', () => {
    const line: DraftLine = { id: newId(), itemId: 'x', axisValues: [{ attributeId: list.id, value: 'zz' }], quantity: '1', totalPrice: null, sourceUrl: null, photo: null, ids: { movementId: newId(), variantId: newId(), photoId: newId() } }
    const d = { ...base(), addedOptions: [{ attributeId: list.id, values: ['zz', 'yy'] }], lines: [line] }
    const r = withRenamedAddedValue(d, s, list.id, 'zz', 'ww')
    expect('errorKey' in r ? null : r.lines[0]!.axisValues[0]!.value).toBe('ww')
    expect(withRenamedAddedValue(d, s, list.id, 'zz', 'YY')).toMatchObject({ errorKey: 'intakes.option.exists' })
  })
})

describe('remove from all items', () => {
  it('a unit: items back to pieces', () => {
    const n = item({ unitKey: customUnitKey(unit.id) })
    const r = withoutUnitEverywhere({ ...base(), newUnits: [unit], newItems: [n] }, unit.id)
    expect(r.newUnits ?? []).toEqual([])
    expect(r.newItems[0]!.unitKey).toBe('pcs')
  })
  it('an attribute: off the items and the lines', () => {
    const a = { id: newId(), name: 'Gauge', kind: 'text' as const, unit: '', siPrefixes: false, options: [], pinned: true }
    const n = item({ attributes: [{ attributeId: a.id, value: 'x', axis: false }] })
    const r = withoutAttributeEverywhere({ ...base(), newAttributes: [a], newItems: [n] }, a.id)
    expect(r.newAttributes ?? []).toEqual([])
    expect(r.newItems[0]!.attributes).toEqual([])
  })
  it('a tag: off the items; edit refuses a taken name', () => {
    const t = { id: newId(), name: 'Fresh', color: '#FF0000' }
    const n = item({ tagIds: [t.id] })
    const d = { ...base(), newTags: [t], newItems: [n] }
    const r = withoutTagEverywhere(d, t.id)
    expect(r.newTags ?? []).toEqual([])
    expect(r.newItems[0]!.tagIds).toEqual([])
    const edited = withEditedTag(d, s, t.id, { name: 'Fresher', color: null })
    expect('errorKey' in edited ? null : edited.newTags![0]).toEqual({ id: t.id, name: 'Fresher' })
    const existing = s.tags[0]
    if (existing) expect(withEditedTag(d, s, t.id, { name: existing.name.toUpperCase(), color: null })).toMatchObject({ errorKey: 'intakes.tag.duplicate' })
  })
  it('undo only while the draft is as the removal left it', () => {
    const before = { ...base(), newItems: [item()] }
    const after = base()
    expect(undoTo(before, after)(after)).toBe(before)
    const later = { ...after, newItems: [item()] }
    expect(undoTo(before, after)(later)).toBe(later)
  })
})

describe('similar names', () => {
  it('items: same folder unmarked, other folders with their path', () => {
    const existing = s.items.find((i) => i.folderId !== null)!
    const out = similarItems(s, base(), `${existing.name}s`, existing.folderId)
    expect(out.find((o) => o.id === existing.id)?.where).toBeUndefined()
    const elsewhere = similarItems(s, base(), `${existing.name}s`, null)
    expect(elsewhere.find((o) => o.id === existing.id)?.where).toBeTruthy()
  })
  it('folders and draft items', () => {
    const f = s.folders.find((x) => x.archivedAt === null)!
    expect(similarFolders(s, base(), `${f.name}s`, f.parentId).some((o) => o.id === f.id)).toBe(true)
    const d = { ...base(), newItems: [item({ name: 'Capacitor' })] }
    expect(similarItems(s, d, 'Capacitors', null).some((o) => o.name === 'Capacitor')).toBe(true)
  })
})

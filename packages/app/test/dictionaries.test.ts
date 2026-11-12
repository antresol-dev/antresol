import { BUILTIN_UNITS, customUnitKey, newId, type Command, type InventorySnapshot, type InventoryStorage } from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import { dictionaryView } from '../app/lib/dictionaries'
import { createDemoDriver } from '../app/lib/dev/demo-source'
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
const reelId = newId()
const boxId = newId()
const tagId = newId()
const attrId = newId()
const liveItem = newId()
const archivedItem = newId()

const run = (c: Command) => storage.apply(c, { device: 'Test' })

// One database for the file, closed at the end.
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  const conn = await driver.connect(cfg)
  storage = conn.storage
  inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  // Custom units created in reverse name order: the view sorts them.
  await run({ type: 'unit.create', id: reelId, inventoryId, name: 'Reel', symbol: 'reel', prefixPowers: [3] })
  await run({ type: 'unit.create', id: boxId, inventoryId, name: 'Box', symbol: 'box', prefixPowers: [] })
  await run({ type: 'tag.create', id: tagId, inventoryId, name: 'Zzz tag' })
  await run({ type: 'attribute.create', id: attrId, inventoryId, name: 'Zzz attr', kind: 'text', options: [] })
  for (const id of [liveItem, archivedItem]) {
    await run({
      type: 'item.create',
      id,
      inventoryId,
      folderId: null,
      name: `Probe ${id}`,
      description: null,
      unitKey: customUnitKey(reelId),
      tagIds: [tagId],
      initialReceipt: null,
    })
    await run({ type: 'item.setAttribute', itemId: id, attributeId: attrId, value: 'x' })
  }
  await run({ type: 'archive', target: 'item', id: archivedItem, archiveId: newId() })
  snap = await storage.loadInventory(inventoryId)
})

describe('texts with an item count', () => {
  it.each(['itemCount', 'tagDeleteConfirm', 'attributeDeleteConfirm'] as const)('%s has a singular and a plural form', (key) => {
    const forms = en.dictionaries[key].split(' | ')
    expect(forms).toHaveLength(2)
    expect(forms[0]).toContain('{count} item')
    expect(forms[0]).not.toContain('{count} items')
    expect(forms[1]).toContain('{count} items')
  })
})

describe('dictionaryView', () => {
  it('counts archived items too', () => {
    const v = dictionaryView(snap)
    expect(v.tags.find((t) => t.tag.id === tagId)!.itemCount).toBe(2)
    expect(v.attributes.find((a) => a.attribute.id === attrId)!.itemCount).toBe(2)
    expect(v.units.find((u) => u.custom?.id === reelId)!.itemCount).toBe(2)
    expect(v.units.find((u) => u.custom?.id === boxId)!.itemCount).toBe(0)
  })

  it('lists built-in units first in BUILTIN_UNITS order, without custom entries', () => {
    const v = dictionaryView(snap)
    const builtin = v.units.slice(0, Object.keys(BUILTIN_UNITS).length)
    expect(builtin.map((u) => u.unit.key)).toEqual(Object.keys(BUILTIN_UNITS))
    expect(builtin.every((u) => u.custom === null)).toBe(true)
  })

  it('sorts custom units by name after the built-ins', () => {
    const custom = dictionaryView(snap).units.filter((u) => u.custom)
    expect(custom.map((u) => u.custom!.name)).toEqual(['Box', 'Reel'])
    expect(custom[1]!.unit.key).toBe(customUnitKey(reelId))
  })
})

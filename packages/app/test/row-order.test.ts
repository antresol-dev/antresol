import { createSearch, newId, type Id, type InventorySnapshot } from '@graymatter/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unitChoices } from '../app/lib/amounts'
import { archiveEntries } from '../app/lib/archive'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { dictionaryView } from '../app/lib/dictionaries'
import { attributeChoices, itemView } from '../app/lib/item-view'
import { matchFolders } from '../app/lib/palette'
import { tagMatches } from '../app/lib/tags'
import type { SourceConfig } from '../app/lib/types'
import { folderChoices, folderTree, folderView, searchRows } from '../app/lib/views'

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}

const driver = createDemoDriver({ memory: true })
afterAll(() => driver.close())

/** The demo inventory plus a twin of a row in every list, under a name that ties with the original (same name, or one
 *  differing only in case), so a list can only order the pair by id. */
let twins: InventorySnapshot

beforeAll(async () => {
  const { storage } = await driver.connect(cfg)
  const inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  const s = await storage.loadInventory(inventoryId)
  const twin = <T extends { id: Id }>(row: T, extra: Partial<T> = {}): T => ({ ...row, id: newId(), ...extra })

  const tl072 = s.items.find((i) => i.name === 'TL072')!
  const pkg = s.attributes.find((a) => a.name === 'Package')!
  const audio = s.tags.find((t) => t.name === 'audio')!
  const variant = s.variants.find((v) => v.archivedAt === null)!
  const folder = s.folders.find((f) => f.archivedAt === null && f.parentId !== null)!
  const unit = {
    id: newId(), inventoryId, name: 'Roll', symbol: 'roll', prefixPowers: [],
    createdAt: tl072.createdAt, updatedAt: tl072.updatedAt, createdBy: 'test', updatedBy: 'test',
  }
  const tagTwin = twin(audio)
  const pkgTwin = twin(pkg, { name: 'package' })
  const itemTwin = twin(tl072, { name: 'tl072', tagIds: [audio.id, tagTwin.id].sort() })
  twins = {
    ...s,
    folders: [...s.folders, twin(folder, { name: folder.name.toUpperCase() })],
    items: [...s.items, itemTwin],
    variants: [...s.variants, twin(variant)],
    tags: [...s.tags, tagTwin],
    attributes: [...s.attributes, pkgTwin],
    units: [unit, twin(unit)],
    itemAttributes: [
      ...s.itemAttributes,
      { itemId: tl072.id, attributeId: pkgTwin.id, value: 'SOIC-8' },
      { itemId: itemTwin.id, attributeId: pkg.id, value: 'DIP-8' },
    ],
  }
})

/** Every list of the snapshot in reverse: what a patched snapshot (the rows a write returned, appended) can look like
 *  next to a fresh load in SQL order. */
function reversed(s: InventorySnapshot): InventorySnapshot {
  return {
    ...s,
    folders: [...s.folders].reverse(),
    items: [...s.items].reverse(),
    variants: [...s.variants].reverse(),
    tags: [...s.tags].reverse(),
    attributes: [...s.attributes].reverse(),
    units: [...s.units].reverse(),
    itemAttributes: [...s.itemAttributes].reverse(),
    variantAttributeValues: [...s.variantAttributeValues].reverse(),
    photos: [...s.photos].reverse(),
    stock: [...s.stock].reverse(),
  }
}

describe('row order', () => {
  it('no view depends on the order of the snapshot rows', () => {
    const r = reversed(twins)
    const same = <T>(view: (s: InventorySnapshot) => T) => expect(view(r)).toEqual(view(twins))

    for (const id of [null, ...twins.folders.map((f) => f.id)]) same((s) => folderView(s, id))
    same(folderTree)
    same((s) => folderChoices(s, null))
    for (const item of twins.items) {
      same((s) => itemView(s, item.id))
      same((s) => attributeChoices(s, item.id))
    }
    same(dictionaryView)
    same(unitChoices)
    same((s) => tagMatches(s, ''))
    same(archiveEntries)
    for (const query of ['tl072', 'audio', '1k', twins.folders.at(-1)!.name]) {
      same((s) => searchRows(s, createSearch(s).search(query)))
      same((s) => matchFolders(s, query))
    }
  })
})

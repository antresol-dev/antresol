import { newId, type Command, type InventorySnapshot, type InventoryStorage } from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { tagMatches } from '../app/lib/tags'
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

// One database for the file, closed at the end.
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

beforeAll(async () => {
  const conn = await driver.connect(cfg)
  const storage: InventoryStorage = conn.storage
  const inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  for (const name of ['Audio', 'Lab', 'Zeta', 'Alpha']) {
    const command: Command = { type: 'tag.create', id: newId(), inventoryId, name }
    await storage.apply(command, { device: 'Test' })
  }
  snap = await storage.loadInventory(inventoryId)
})

describe('tagMatches', () => {
  it('finds tags by a case-insensitive part of the name', () => {
    expect(tagMatches(snap, 'ab').tags.map((t) => t.name)).toContain('Lab')
    expect(tagMatches(snap, 'ab').tags.map((t) => t.name)).not.toContain('Audio')
    expect(tagMatches(snap, 'AUD').tags.map((t) => t.name)).toContain('Audio')
  })

  it('cannot create a tag that exists, ignoring case and spaces; can create a new one', () => {
    expect(tagMatches(snap, ' AUDIO ').canCreate).toBe(false)
    expect(tagMatches(snap, '').canCreate).toBe(false)
    expect(tagMatches(snap, '   ').canCreate).toBe(false)
    expect(tagMatches(snap, 'Audi').canCreate).toBe(true)
    expect(tagMatches(snap, 'Brand new').canCreate).toBe(true)
  })

  it('lists every tag for an empty query, sorted by name', () => {
    const names = tagMatches(snap, '').tags.map((t) => t.name)
    expect(names.length).toBe(snap.tags.length)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })
})

import { newId, type Command, type InventorySnapshot, type InventoryStorage } from '@graymatter/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { archiveEntries } from '../app/lib/archive'
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

beforeEach(async () => {
  storage = (await createDemoDriver({ memory: true, extras: false }).connect(cfg)).storage
  inventoryId = (await storage.listInventories()).find((i) => i.name === 'Electronics')!.id
  snap = await storage.loadInventory(inventoryId)
})

const run = async (command: Command): Promise<void> => {
  await storage.apply(command, { device: 'Test' })
  snap = await storage.loadInventory(inventoryId)
}
const folderId = (name: string): string => snap.folders.find((f) => f.name === name)!.id
const itemId = (name: string): string => snap.items.find((i) => i.name === name)!.id
const archive = async (target: 'folder' | 'item' | 'variant', id: string): Promise<string> => {
  const archiveId = newId()
  await run({ type: 'archive', target, id, archiveId })
  return archiveId
}
// archivedAt has millisecond resolution; keep operations apart.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('archiveEntries', () => {
  it('is empty without archived records', () => {
    expect(archiveEntries(snap)).toEqual([])
  })

  it('lists a folder archive once and counts what went with it', async () => {
    await archive('folder', folderId('Passive components'))
    const entries = archiveEntries(snap)
    expect(entries.map((e) => [e.target, e.name, e.folderCount, e.itemCount])).toEqual([['folder', 'Passive components', 1, 1]])
    expect(entries[0]!.path).toBe('')
  })

  it('keeps an item archived earlier as its own entry inside a later folder archive', async () => {
    await archive('item', itemId('TL072'))
    await tick()
    await archive('folder', folderId('ICs'))
    const entries = archiveEntries(snap)
    expect(entries.map((e) => [e.target, e.name])).toEqual([['folder', 'ICs'], ['item', 'TL072']])
    expect(entries[0]!.itemCount).toBe(2) // LM13700 and NE555; TL072 has its own archiveId
    expect(entries[0]!.folderCount).toBe(1) // Op-amps
  })

  it('lists an archived variant with its item name', async () => {
    const resistor = snap.items.find((i) => i.name === 'Резистор 0,25 Вт')!
    await archive('variant', snap.variants.find((v) => v.itemId === resistor.id && v.name === '100k')!.id)
    expect(archiveEntries(snap)[0]).toMatchObject({ target: 'variant', name: '100k', itemName: 'Резистор 0,25 Вт', path: 'Passive components / Resistors' })
  })

  it('shows the path through archived folders', async () => {
    await archive('item', itemId('Резистор 0,25 Вт'))
    await tick()
    await archive('folder', folderId('Passive components'))
    expect(archiveEntries(snap).find((e) => e.target === 'item')!.path).toBe('Passive components / Resistors')
  })

  it('puts the newest archive first and forgets restored ones', async () => {
    await archive('item', itemId('TL072'))
    await tick()
    const b = await archive('item', itemId('LM13700'))
    expect(archiveEntries(snap).map((e) => e.name)).toEqual(['LM13700', 'TL072'])
    await run({ type: 'restore', archiveId: b })
    expect(archiveEntries(snap).map((e) => e.name)).toEqual(['TL072'])
  })
})

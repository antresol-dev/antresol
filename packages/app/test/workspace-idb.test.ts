import { newId } from '@graymatter/core'
import { afterAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { openDeviceDb } from '../app/lib/device-db'
import { createWorkspace } from '../app/lib/workspace'

const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

describe('workspace on a real IndexedDB', () => {
  // IndexedDB structured clone rejects Vue reactive proxies; the in-memory device db does not.
  it('adds a source and selects its first inventory', async () => {
    const ws = createWorkspace({
      db: await openDeviceDb(),
      drivers: { 'dev-pglite': driver },
      userAgent: 'test',
    })
    await ws.startFromCache()
    await ws.addSource({ kind: 'dev-pglite', name: 'Demo', connectionString: '', uploadcarePublicKey: null })
    expect(ws.state.current).not.toBeNull()
    expect(ws.state.snapshot?.inventory.name).toBe('Electronics')
  })

  // The cache save swallows its errors: a copy IndexedDB cannot clone would go unnoticed otherwise.
  it('saves a copy patched by a write', async () => {
    const db = await openDeviceDb()
    const ws = createWorkspace({ db, drivers: { 'dev-pglite': driver }, userAgent: 'test' })
    await ws.start()
    const ref = ws.state.current!
    const id = newId()
    await ws.apply({ type: 'folder.create', id, inventoryId: ref.inventoryId, parentId: null, name: 'Patched', description: null })
    await ws.flushCache()
    const saved = (await db.getSnapshot(ref))!
    expect(saved.snapshot.folders.map((f) => f.id)).toContain(id)
    expect(saved.rev).not.toBeNull()
  })
})

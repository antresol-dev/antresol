import { describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { openDeviceDb } from '../app/lib/device-db'
import { createWorkspace } from '../app/lib/workspace'

describe('workspace on a real IndexedDB', () => {
  // IndexedDB structured clone rejects Vue reactive proxies; the in-memory device db does not.
  it('adds a source and selects its first inventory', async () => {
    const ws = createWorkspace({
      db: await openDeviceDb(),
      drivers: { 'dev-pglite': createDemoDriver({ memory: true }) },
      userAgent: 'test',
    })
    await ws.startFromCache()
    await ws.addSource({ kind: 'dev-pglite', name: 'Demo', connectionString: '', uploadcarePublicKey: null })
    expect(ws.state.current).not.toBeNull()
    expect(ws.state.snapshot?.inventory.name).toBe('Electronics')
  })
})

import { PGlite } from '@electric-sql/pglite'
import { newId } from '@graymatter/core'
import { createPgliteExecutor, type PgExecutor } from '@graymatter/storage-postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDeviceDb } from '../app/lib/device-db'
import { createNeonDriver } from '../app/lib/sources'
import type { SourceConfig } from '../app/lib/types'
import { createWorkspace } from '../app/lib/workspace'

const CS = 'postgresql://u:pw-warm@h/warm'
const cfg: SourceConfig = {
  id: 's1',
  kind: 'neon',
  name: 'Source',
  connectionString: CS,
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}

let pg: PGlite
afterEach(async () => {
  vi.useRealTimers()
  await pg?.close().catch(() => {})
})

/** A workspace on one database; `requests` counts every executor call that reaches it. */
async function start() {
  pg = new PGlite()
  const real = createPgliteExecutor(pg)
  const counts = { requests: 0 }
  const counted: PgExecutor = {
    query: (s) => (counts.requests++, real.query(s)),
    batch: (s) => (counts.requests++, real.batch(s)),
    readBatch: (s) => (counts.requests++, real.readBatch(s)),
    close: async () => {},
  }
  // Seed through the same driver, then open the workspace on a clock the test moves.
  const seeding = await createNeonDriver(() => counted).connect(cfg)
  await seeding.storage.apply(
    { type: 'inventory.create', id: newId(), name: 'Inv', description: null, currency: 'USD' },
    { device: 'seed' },
  )
  await seeding.close()
  const clock = { ms: Date.parse('2026-11-10T10:00:00Z') }
  const db = createMemoryDeviceDb()
  await db.putSource(cfg)
  const ws = createWorkspace({
    db,
    drivers: { neon: createNeonDriver(() => counted) },
    userAgent: 'test',
    now: () => new Date(clock.ms),
  })
  await ws.start()
  return { ws, clock, counts }
}

describe('warm-up', () => {
  it('does nothing while the source answered within 4 minutes', async () => {
    const { ws, clock, counts } = await start()
    clock.ms += 4 * 60_000
    const before = counts.requests
    await ws.warmUp()
    expect(counts.requests).toBe(before)
  })

  it('sends one light request when the source has been silent for more than 4 minutes, and not again after it answered', async () => {
    const { ws, clock, counts } = await start()
    clock.ms += 4 * 60_000 + 1
    const before = counts.requests
    await Promise.all([ws.warmUp(), ws.warmUp()])
    expect(counts.requests).toBe(before + 1)
    await ws.warmUp()
    expect(counts.requests).toBe(before + 1)
  })

  it('never fires by itself: time passing alone sends nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    const { clock, counts } = await start()
    const before = counts.requests
    clock.ms += 60 * 60_000
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(counts.requests).toBe(before)
  })
})

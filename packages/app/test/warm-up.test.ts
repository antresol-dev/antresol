import { PGlite } from '@electric-sql/pglite'
import { newId, type Command } from '@antresol/core'
import { createPgliteExecutor, type PgExecutor } from '@antresol/storage-postgres'
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

/** A workspace on one database; `requests` counts every executor call that reaches it, `log` names them in order. While
 *  `hold.writes` or `hold.reads` is set, writes (batch) or reads (readBatch) wait for it first. */
async function start() {
  pg = new PGlite()
  const real = createPgliteExecutor(pg)
  const counts = { requests: 0 }
  const log: string[] = []
  const hold: { writes: Promise<void> | null; reads: Promise<void> | null } = { writes: null, reads: null }
  const counted: PgExecutor = {
    query: (s) => (counts.requests++, real.query(s)),
    batch: async (s) => {
      counts.requests++
      if (hold.writes) await hold.writes
      log.push('write')
      return real.batch(s)
    },
    readBatch: async (s) => {
      counts.requests++
      if (hold.reads) await hold.reads
      log.push('read')
      return real.readBatch(s)
    },
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
  const inventoryId = ws.state.current!.inventoryId
  return { ws, clock, counts, log, hold, inventoryId }
}

const gate = (): { promise: Promise<void>; open: () => void } => {
  let open!: () => void
  return { promise: new Promise<void>((r) => (open = r)), open }
}
const folder = (inventoryId: string, name: string): Command => ({
  type: 'folder.create',
  id: newId(),
  inventoryId,
  parentId: null,
  name,
  description: null,
})
const receive = (itemId: string): Command => ({
  type: 'stock.receive',
  movementId: newId(),
  itemId,
  variantId: null,
  quantity: '1',
  totalPrice: null,
  sourceUrl: null,
  note: null,
})

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

  it('stays quiet while a write is on its way (a form or a stock bucket), so no listing moves the revision under it', async () => {
    const { ws, clock, counts, hold, inventoryId } = await start()
    const itemId = newId()
    await ws.apply({ type: 'item.create', id: itemId, inventoryId, folderId: null, name: 'Bolt', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null })
    for (const command of [folder(inventoryId, 'Box'), receive(itemId)]) {
      clock.ms += 4 * 60_000 + 1
      const held = gate()
      hold.writes = held.promise
      const writing = ws.apply(command)
      const before = counts.requests
      await ws.warmUp()
      expect(counts.requests).toBe(before)
      hold.writes = null
      held.open()
      await writing
    }
    // The write answered: no warm-up is needed right after it either.
    const before = counts.requests
    await ws.warmUp()
    expect(counts.requests).toBe(before)
  })

  it('a write waits for a warm-up already on its way, so the listing never answers amid it', async () => {
    const { ws, clock, log, hold, inventoryId } = await start()
    clock.ms += 4 * 60_000 + 1
    const held = gate()
    hold.reads = held.promise
    const mark = log.length
    const warming = ws.warmUp()
    const writing = ws.apply(folder(inventoryId, 'Box'))
    await new Promise((r) => setTimeout(r, 20))
    expect(log.slice(mark)).toEqual([])
    hold.reads = null
    held.open()
    await Promise.all([warming, writing])
    expect(log.slice(mark)).toEqual(['read', 'write'])
  })

  it('a write refused on the device is no answer of the source: the warm-up still wakes it', async () => {
    const { ws, clock, counts, inventoryId } = await start()
    clock.ms += 4 * 60_000 + 1
    await expect(ws.apply(folder(inventoryId, ' '))).rejects.toMatchObject({ code: 'name_required' })
    const before = counts.requests
    await ws.warmUp()
    expect(counts.requests).toBe(before + 1)
  })
})

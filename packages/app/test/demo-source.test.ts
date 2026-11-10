import { describe, expect, it, vi } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import type { SourceConfig } from '../app/lib/types'

/** The next `failNext` PGlite databases fail to open. */
const pglite = vi.hoisted(() => ({ failNext: 0 }))
vi.mock('@electric-sql/pglite', async (importOriginal) => {
  const real = await importOriginal<typeof import('@electric-sql/pglite')>()
  class FlakyPGlite extends real.PGlite {
    constructor(...args: ConstructorParameters<typeof real.PGlite>) {
      if (pglite.failNext > 0) {
        pglite.failNext--
        throw new Error('could not open the database')
      }
      super(...args)
    }
  }
  return { ...real, PGlite: FlakyPGlite }
})

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}

describe('demo source', () => {
  it('seeds two inventories with stock', async () => {
    const conn = await createDemoDriver({ memory: true, extras: false }).connect(cfg)
    const invs = await conn.storage.listInventories()
    expect(invs.map((i) => i.name).sort()).toEqual(['Electronics', 'Workshop'])
    const snap = await conn.storage.loadInventory(invs.find((i) => i.name === 'Electronics')!.id)
    const qty = (name: string) => {
      const item = snap.items.find((i) => i.name === name)!
      return snap.stock.filter((l) => l.itemId === item.id).map((l) => l.quantity)
    }
    expect(qty('TL072')).toEqual(['37'])
    expect(qty('NE555')).toEqual(['0'])
    expect(snap.folders.map((f) => f.name)).toContain('Op-amps')
    await conn.close()
  })

  it('seeds an archive with extras', async () => {
    const conn = await createDemoDriver({ memory: true }).connect(cfg)
    const all = await conn.storage.listInventories()
    const snap = await conn.storage.loadInventory(all.find((i) => i.name === 'Electronics')!.id)
    expect(snap.folders.find((f) => f.name === 'Old projects')!.archivedAt).not.toBeNull()
    expect(snap.items.find((i) => i.name === 'CD4017')!.archivedAt).not.toBeNull()
    expect(snap.variants.find((v) => v.name === '100k')!.archivedAt).not.toBeNull()
  })

  it('probe reports empty and never writes', async () => {
    const res = await createDemoDriver({ memory: true, extras: false }).probe(cfg)
    expect(res).toEqual({ ok: true, inspection: { state: 'empty' } })
  })


  it('does not keep a failed PGlite open: the next connect tries again', async () => {
    const driver = createDemoDriver({ memory: true, extras: false })
    pglite.failNext = 1
    await expect(driver.connect(cfg)).rejects.toThrow('could not open the database')
    const conn = await driver.connect(cfg)
    expect((await conn.storage.listInventories()).map((i) => i.name).sort()).toEqual(['Electronics', 'Workshop'])
  })

  it('seeds once when two connects run at the same time', async () => {
    const driver = createDemoDriver({ memory: true, extras: false })
    const [first, second] = await Promise.all([driver.connect(cfg), driver.connect(cfg)])
    expect((await first.storage.listInventories()).map((i) => i.name).sort()).toEqual(['Electronics', 'Workshop'])
    expect((await second.storage.listInventories()).map((i) => i.name).sort()).toEqual(['Electronics', 'Workshop'])
  })

  it('keeps the database open when an older connection is closed', async () => {
    const driver = createDemoDriver({ memory: true, extras: false })
    const first = await driver.connect(cfg)
    const second = await driver.connect(cfg)
    await first.close()
    expect((await second.storage.listInventories()).length).toBe(2)
  })
})

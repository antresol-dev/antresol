import { createSearch } from '@graymatter/core'
import type { Transaction } from '@electric-sql/pglite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoDriver, type DemoDriver } from '../app/lib/dev/demo-source'
import type { SourceConfig } from '../app/lib/types'

/** The next `failNext` PGlite databases fail to open; the transaction number `failTransactionAt` (1-based, counted
 *  from `transactions = 0`) fails once. */
const pglite = vi.hoisted(() => ({ failNext: 0, transactions: 0, failTransactionAt: 0 }))
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

    override async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
      pglite.transactions++
      if (pglite.transactions === pglite.failTransactionAt) throw new Error('disk full')
      return super.transaction(callback)
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

// Every test makes its own driver (a database of its own); all of them are closed after the test.
const drivers: DemoDriver[] = []
const demo = (options: Parameters<typeof createDemoDriver>[0]): DemoDriver => {
  const driver = createDemoDriver(options)
  drivers.push(driver)
  return driver
}
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.close()))
})

describe('demo source', () => {
  it('seeds two inventories with stock', async () => {
    const conn = await demo({ memory: true, extras: false }).connect(cfg)
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
    const conn = await demo({ memory: true }).connect(cfg)
    const all = await conn.storage.listInventories()
    const snap = await conn.storage.loadInventory(all.find((i) => i.name === 'Electronics')!.id)
    expect(snap.folders.find((f) => f.name === 'Old projects')!.archivedAt).not.toBeNull()
    expect(snap.items.find((i) => i.name === 'CD4017')!.archivedAt).not.toBeNull()
    expect(snap.variants.find((v) => v.name === '100k')!.archivedAt).not.toBeNull()
  })

  it('seeds tags and attributes with extras, found by search', async () => {
    const conn = await demo({ memory: true }).connect(cfg)
    const all = await conn.storage.listInventories()
    const snap = await conn.storage.loadInventory(all.find((i) => i.name === 'Electronics')!.id)
    expect(snap.tags.map((x) => x.name).sort()).toEqual(['audio', 'smd'])
    expect(snap.attributes.map((a) => [a.name, a.kind, a.options])).toEqual(
      expect.arrayContaining([['Package', 'enum', ['DIP-8', 'SOIC-8']], ['Resistance', 'text', []]]),
    )
    const tl072 = snap.items.find((i) => i.name === 'TL072')!
    const resistor = snap.items.find((i) => i.name === 'Резистор 0,25 Вт')!
    const { search } = createSearch(snap)
    expect(search('DIP-8').map((h) => h.itemId)).toContain(tl072.id)
    expect(search('10 kΩ').map((h) => h.itemId)).toContain(resistor.id)
    expect(search('audio').map((h) => h.itemId)).toContain(tl072.id)
  })

  it('probe reports empty and never writes', async () => {
    const res = await demo({ memory: true, extras: false }).probe(cfg)
    expect(res).toEqual({ ok: true, inspection: { state: 'empty' } })
  })


  it('does not keep a failed PGlite open: the next connect tries again', async () => {
    const driver = demo({ memory: true, extras: false })
    pglite.failNext = 1
    await expect(driver.connect(cfg)).rejects.toThrow('could not open the database')
    const conn = await driver.connect(cfg)
    expect((await conn.storage.listInventories()).map((i) => i.name).sort()).toEqual(['Electronics', 'Workshop'])
  })

  it('seeds once when two connects run at the same time', async () => {
    const driver = demo({ memory: true, extras: false })
    const [first, second] = await Promise.all([driver.connect(cfg), driver.connect(cfg)])
    expect((await first.storage.listInventories()).map((i) => i.name).sort()).toEqual(['Electronics', 'Workshop'])
    expect((await second.storage.listInventories()).map((i) => i.name).sort()).toEqual(['Electronics', 'Workshop'])
  })

  it('closes its databases on close()', async () => {
    const driver = demo({ memory: true, extras: false })
    const conn = await driver.connect(cfg)
    await driver.close()
    await expect(conn.storage.listInventories()).rejects.toThrow(/closed/i)
  })

  it('keeps the database open when an older connection is closed', async () => {
    const driver = demo({ memory: true, extras: false })
    const first = await driver.connect(cfg)
    const second = await driver.connect(cfg)
    await first.close()
    expect((await second.storage.listInventories()).length).toBe(2)
  })

  it('seeds the whole demo on the next connect after a seeding failure', async () => {
    pglite.transactions = 0
    const probe = await demo({ memory: true, extras: false }).connect(cfg)
    await probe.close()
    const total = pglite.transactions

    const driver = demo({ memory: true, extras: false })
    pglite.transactions = 0
    pglite.failTransactionAt = total - 2
    await expect(driver.connect(cfg)).rejects.toThrow('disk full')
    pglite.failTransactionAt = 0
    const conn = await driver.connect(cfg)
    expect((await conn.storage.listInventories()).map((i) => i.name).sort()).toEqual(['Electronics', 'Workshop'])
    const all = await conn.storage.listInventories()
    const snap = await conn.storage.loadInventory(all.find((i) => i.name === 'Electronics')!.id)
    expect(snap.items.map((i) => i.name)).toContain('TL072')
    expect(snap.items).toHaveLength(4)
  })
})

import { newId } from '@antresol/core'
import { describe, expect, it, vi } from 'vitest'
import { makeContext } from './fixture'

function clock() {
  let t = 1_000_000
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('createSource', () => {
  it('reads once within the window', async () => {
    const c = clock()
    const { storage, source, inventoryId } = await makeContext({ source: { now: c.now, revCheckMs: 3000 } })
    const load = vi.spyOn(storage, 'loadInventoryWithRev')
    const list = vi.spyOn(storage, 'listInventories')
    const a = await source.snapshot(inventoryId)
    c.advance(1000)
    const b = await source.snapshot(inventoryId)
    expect(load).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(1)
    expect(b).toBe(a)
  })

  it('checks only the revision after the window and keeps the copy when it is the same', async () => {
    const c = clock()
    const { storage, source, inventoryId } = await makeContext({ source: { now: c.now, revCheckMs: 3000 } })
    const load = vi.spyOn(storage, 'loadInventoryWithRev')
    const list = vi.spyOn(storage, 'listInventories')
    const a = await source.snapshot(inventoryId)
    c.advance(3500)
    const b = await source.snapshot(inventoryId)
    expect(load).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(2)
    expect(b).toBe(a)
  })

  it('reads again after the window when another command changed the revision', async () => {
    const c = clock()
    const { storage, source, inventoryId, apply } = await makeContext({ source: { now: c.now, revCheckMs: 3000 } })
    const load = vi.spyOn(storage, 'loadInventoryWithRev')
    const a = await source.snapshot(inventoryId)
    await apply({ type: 'tag.create', id: newId(), inventoryId, name: 'THT' })
    c.advance(3500)
    const b = await source.snapshot(inventoryId)
    expect(load).toHaveBeenCalledTimes(2)
    expect(b).not.toBe(a)
    expect(b.tags.map((t) => t.name)).toContain('THT')
  })

  it('does not see a change inside the window, refresh() does', async () => {
    const c = clock()
    const { storage, source, inventoryId, apply } = await makeContext({ source: { now: c.now, revCheckMs: 3000 } })
    const load = vi.spyOn(storage, 'loadInventoryWithRev')
    await source.snapshot(inventoryId)
    await apply({ type: 'tag.create', id: newId(), inventoryId, name: 'THT' })
    expect((await source.snapshot(inventoryId)).tags.map((t) => t.name)).not.toContain('THT')
    source.refresh()
    expect((await source.snapshot(inventoryId)).tags.map((t) => t.name)).toContain('THT')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('checks intakes by the intakes revision', async () => {
    const c = clock()
    const { storage, source, inventoryId } = await makeContext({ source: { now: c.now, revCheckMs: 3000 } })
    const list = vi.spyOn(storage, 'listIntakes')
    const rev = vi.spyOn(storage, 'intakesRev')
    await source.intakes(inventoryId)
    await source.intakes(inventoryId)
    expect(list).toHaveBeenCalledTimes(1)
    expect(rev).not.toHaveBeenCalled()
    c.advance(3500)
    await source.intakes(inventoryId)
    expect(rev).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(1)

    const id = newId()
    await storage.saveIntakeDraft(
      { id, inventoryId, header: { shop: 'LCSC', orderNumber: null, purchasedOn: '2026-11-14', note: null }, content: { newItems: [], lines: [] } },
      null,
      { device: 'x' },
    )
    c.advance(3500)
    expect((await source.intakes(inventoryId)).map((i) => i.id)).toEqual([id])
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shares one read between concurrent calls', async () => {
    const { storage, source, inventoryId } = await makeContext()
    const load = vi.spyOn(storage, 'loadInventoryWithRev')
    await Promise.all([source.snapshot(inventoryId), source.snapshot(inventoryId)])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('tells whether the storage is read-only', async () => {
    const { source } = await makeContext()
    expect(source.readOnly).toBe(false)
  })
})

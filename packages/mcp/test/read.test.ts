import { newId, StorageError, type DraftLine, type Id } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { requireSource, resolveInventory } from '../src/context'
import { toToolResult, ToolError } from '../src/errors'
import * as read from '../src/tools/read'
import { disconnectedContext, makeContext, TEST_ACTOR, type Fixture } from './fixture'

const line = (itemId: Id, over: Partial<DraftLine> = {}): DraftLine => ({
  id: newId(),
  itemId,
  axisValues: [],
  quantity: '2',
  totalPrice: 1250,
  sourceUrl: 'https://example.com/p',
  photo: null,
  ids: { movementId: newId(), variantId: newId(), photoId: newId() },
  ...over,
})

async function draft(f: Fixture, content: Parameters<Fixture['storage']['saveIntakeDraft']>[0]['content']) {
  const id = newId()
  await f.storage.saveIntakeDraft(
    { id, inventoryId: f.inventoryId, header: { shop: 'LCSC', orderNumber: 'A-1', purchasedOn: '2026-11-14', note: null }, content },
    null,
    TEST_ACTOR,
  )
  return id
}

describe('getOverview', () => {
  it('describes the inventory', async () => {
    const f = await makeContext()
    const o = (await read.getOverview(f.ctx, {})) as any
    expect(o.inventories).toEqual([{ id: f.inventoryId, name: 'Electronics', currency: 'RUB' }])
    expect(o.folders).toEqual([
      { id: f.ids.modules, path: 'Modules', items: 1 },
      { id: f.ids.passives, path: 'Passives', items: 0 },
      { id: f.ids.resistors, path: 'Passives/Resistors', items: 1 },
    ])
    expect(o.attributes).toContainEqual({ id: f.ids.resistance, name: 'Resistance', kind: 'number', unit: 'Ω', siPrefixes: true, options: [], pinned: false })
    expect(o.attributes).toContainEqual({ id: f.ids.power, name: 'Power', kind: 'number', unit: 'W', siPrefixes: false, options: [], pinned: false })
    expect(o.attributes.map((a: any) => a.name).sort()).toEqual(['Power', 'Resistance'])
    expect(o.tags).toEqual([{ id: f.ids.smd, name: 'SMD', color: null }])
    expect(o.units.builtin.map((u: any) => u.key)).toEqual(['pcs', 'm', 'g', 'l'])
    expect(o.units.custom).toEqual([])
    expect(o.photos).toEqual({ store: null, folder: f.ctx.config.photosDir })
    expect(o.photos.folder).toBe('/photos')
  })

  it('tells a list attribute as list, with its options', async () => {
    const f = await makeContext()
    const id = newId()
    await f.apply({ type: 'attribute.create', id, inventoryId: f.inventoryId, name: 'Package', kind: 'enum', options: ['THT', 'SMD'], unit: '', siPrefixes: false })
    f.source.refresh()
    const o = (await read.getOverview(f.ctx, {})) as any
    expect(o.attributes).toContainEqual({ id, name: 'Package', kind: 'list', unit: '', siPrefixes: false, options: ['THT', 'SMD'], pinned: false })
  })

  it('lists the inventories alone when there are several and none is named', async () => {
    const f = await makeContext({ secondInventory: true })
    const o = (await read.getOverview(f.ctx, {})) as any
    expect(o.inventories.map((i: any) => i.name)).toEqual(['Electronics', 'Workshop'])
    expect(o.folders).toBeUndefined()
    const w = (await read.getOverview(f.ctx, { inventory: 'workshop' })) as any
    expect(w.inventory.name).toBe('Workshop')
    expect(w.folders).toEqual([])
  })
})

describe('search', () => {
  it('finds the 4.7k variant first with its stock', async () => {
    const f = await makeContext()
    const r = (await read.search(f.ctx, { query: '4k7' })) as any
    const first = r.results[0]
    expect(first.variantId).toBe(f.ids.v4k7)
    expect(first.name).toBe('Resistor 0.25 W')
    expect(first.variant).toContain('4.7')
    expect(first.stock).toContain('40')
    expect(first.folder).toBe('Passives/Resistors')
  })

  it('clamps the limit', async () => {
    const f = await makeContext()
    expect(((await read.search(f.ctx, { query: 'resistor', limit: 0 })) as any).results.length).toBeLessThanOrEqual(20)
    expect(((await read.search(f.ctx, { query: 'resistor', limit: 1 })) as any).results).toHaveLength(1)
    expect(((await read.search(f.ctx, { query: 'resistor', limit: 1000 })) as any).results.length).toBeLessThanOrEqual(50)
  })
})

describe('getItem', () => {
  it('describes ESP32 with its tags, stock and receipts', async () => {
    const f = await makeContext()
    const i = (await read.getItem(f.ctx, { item: f.ids.esp32 })) as any
    expect(i.folder).toBe('Modules')
    expect(i.tags).toEqual(['SMD'])
    expect(i.stock).toBe('3 pcs')
    expect(i.variants).toEqual([])
    expect(i.receipts).toHaveLength(1)
    expect(i.receipts[0]).toMatchObject({ amount: '3 pcs', price: '450.00', url: 'https://example.com/esp32', intakeId: null })
    expect(typeof i.receipts[0].at).toBe('string')
  })

  it('lists the variants of the resistor', async () => {
    const f = await makeContext()
    const i = (await read.getItem(f.ctx, { item: f.ids.resistor })) as any
    expect(i.axes).toEqual(['Resistance'])
    expect(i.variants.map((v: any) => [v.label, v.stock])).toEqual([
      ['4.7 kΩ', '40 pcs'],
      ['10 kΩ', '0 pcs'],
    ])
  })

  it('does not know an unknown id', async () => {
    const f = await makeContext()
    await expect(read.getItem(f.ctx, { item: newId() })).rejects.toBeInstanceOf(ToolError)
  })
})

describe('getFolder', () => {
  it('finds a folder by path, case-insensitively', async () => {
    const f = await makeContext()
    const r = (await read.getFolder(f.ctx, { folder: 'Passives/Resistors' })) as any
    expect(r.folder).toEqual({ id: f.ids.resistors, path: 'Passives/Resistors' })
    expect(r.items.map((i: any) => i.name)).toEqual(['Resistor 0.25 W'])
    expect(r.items[0].variants).toBe(2)
    expect(r.more).toBe(false)
    expect(((await read.getFolder(f.ctx, { folder: 'passives / RESISTORS' })) as any).folder.id).toBe(f.ids.resistors)
  })

  it('finds a folder by id and lists the root', async () => {
    const f = await makeContext()
    expect(((await read.getFolder(f.ctx, { folder: f.ids.modules })) as any).items[0].name).toBe('ESP32 DevKit')
    const root = (await read.getFolder(f.ctx, { folder: '' })) as any
    expect(root.folder).toEqual({ id: null, path: '' })
    expect(root.folders.map((x: any) => x.path)).toEqual(['Modules', 'Passives'])
  })

  it('rejects a path that does not exist', async () => {
    const f = await makeContext()
    await expect(read.getFolder(f.ctx, { folder: 'Passives/Capacitors' })).rejects.toBeInstanceOf(ToolError)
  })
})

describe('intakes', () => {
  it('lists drafts and shows one in full', async () => {
    const f = await makeContext()
    const tagId = newId()
    const newItemId = newId()
    const unknown = newId()
    const l1 = line(f.ids.esp32)
    const l2 = line(f.ids.resistor, { axisValues: [{ attributeId: f.ids.resistance, value: '4k7' }], quantity: '10', totalPrice: null })
    const l3 = line(newItemId)
    const l4 = line(unknown)
    const id = await draft(f, {
      newTags: [{ id: tagId, name: 'THT' }],
      newItems: [{ id: newItemId, name: 'ESP32 DevKit', folderId: f.ids.modules, unitKey: 'pcs', attributes: [], tagIds: [tagId, f.ids.smd] }],
      lines: [l1, l2, l3, l4],
    })

    const list = (await read.listIntakes(f.ctx, {})) as any
    expect(list.intakes).toHaveLength(1)
    expect(list.intakes[0]).toMatchObject({ id, status: 'draft', shop: 'LCSC', orderNumber: 'A-1', lines: 4 })
    expect(((await read.listIntakes(f.ctx, { query: 'lcsc' })) as any).intakes).toHaveLength(1)
    expect(((await read.listIntakes(f.ctx, { query: 'nothing' })) as any).intakes).toHaveLength(0)
    expect(((await read.listIntakes(f.ctx, { status: 'committed' })) as any).intakes).toHaveLength(0)

    const v = (await read.getIntake(f.ctx, { intake: id })) as any
    expect(v.inventory).toBe('Electronics')
    expect(v.status).toBe('draft')
    expect(v.ok).toBe(false)
    expect(v.newItems).toHaveLength(1)
    expect(v.newItems[0]).toMatchObject({ name: 'ESP32 DevKit', folder: 'Modules', unit: 'pcs', tags: ['THT', 'SMD'] })
    expect(v.newItems[0].looksLike).toMatchObject({ itemId: f.ids.esp32, name: 'ESP32 DevKit', have: '3 pcs' })
    const byId = new Map(v.lines.map((x: any) => [x.id, x]))
    expect(byId.get(l1.id)).toMatchObject({ kind: 'add', problem: null, item: 'ESP32 DevKit', amount: '2 pcs', price: '12.50', url: 'https://example.com/p' })
    expect(byId.get(l2.id)).toMatchObject({ kind: 'add', values: '4.7 kΩ', amount: '10 pcs', price: null })
    expect(byId.get(l3.id)).toMatchObject({ kind: 'newItem', item: 'ESP32 DevKit' })
    expect(byId.get(l4.id)).toMatchObject({ kind: 'problem', item: null })
    expect((byId.get(l4.id) as any).problem).toContain('does not exist')
  })

  it('marks a line that repeats another one', async () => {
    const f = await makeContext()
    const a = line(f.ids.esp32)
    const b = line(f.ids.esp32)
    const id = await draft(f, { newItems: [], lines: [a, b] })
    const v = (await read.getIntake(f.ctx, { intake: id })) as any
    expect(v.ok).toBe(true)
    expect(v.lines.map((x: any) => x.alreadyInDraft)).toEqual([true, true])
  })

  it('rejects an unknown intake', async () => {
    const f = await makeContext()
    await expect(read.getIntake(f.ctx, { intake: newId() })).rejects.toBeInstanceOf(ToolError)
  })
})

describe('refresh', () => {
  it('forgets the cache', async () => {
    const f = await makeContext()
    expect(await read.refresh(f.ctx)).toEqual({ refreshed: true })
  })
})

describe('resolveInventory (Review Focus 4)', () => {
  it('without a name, several inventories give an error that lists both', async () => {
    const f = await makeContext({ secondInventory: true })
    const error = await resolveInventory(f.ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ToolError)
    const text = (error as Error).message
    expect(text).toContain(`${f.inventoryId} — Electronics`)
    expect(text).toContain(`${f.secondInventoryId} — Workshop`)
    await expect(read.search(f.ctx, { query: 'esp' })).rejects.toThrow(/Workshop/)
  })

  it('takes a name without regard to case, or an id', async () => {
    const f = await makeContext({ secondInventory: true })
    expect((await resolveInventory(f.ctx, 'workshop')).inventory.id).toBe(f.secondInventoryId)
    expect((await resolveInventory(f.ctx, f.inventoryId)).inventory.name).toBe('Electronics')
    await expect(resolveInventory(f.ctx, 'nope')).rejects.toThrow(/Electronics/)
  })

  it('takes the only active inventory by itself', async () => {
    const f = await makeContext({ secondInventory: true, archiveSecond: true })
    expect((await resolveInventory(f.ctx)).inventory.name).toBe('Electronics')
    await expect(resolveInventory(f.ctx, 'Workshop')).rejects.toBeInstanceOf(ToolError)
  })
})

describe('no connection (Review Focus 2)', () => {
  it('every tool answers with a pointer to Settings → Connect AI', async () => {
    const ctx = disconnectedContext()
    expect(() => requireSource(ctx)).toThrow(/Settings → Connect AI/)
    const calls: Promise<unknown>[] = [
      read.getOverview(ctx, {}),
      read.search(ctx, { query: 'x' }),
      read.getItem(ctx, { item: 'x' }),
      read.getFolder(ctx, { folder: '' }),
      read.listIntakes(ctx, {}),
      read.getIntake(ctx, { intake: 'x' }),
      read.refresh(ctx),
    ]
    for (const call of calls) {
      const result = toToolResult(await call.catch((e: unknown) => e), [])
      expect(result.isError).toBe(true)
      expect((result.content[0] as any).text).toContain('Settings → Connect AI')
    }
  })

  it('an invalid key says so', async () => {
    const ctx = disconnectedContext()
    ctx.config = { ...ctx.config, connectionProblem: 'invalid' }
    expect(() => requireSource(ctx)).toThrow(/not a valid connection key/)
  })

  it('a failed open is what the tools answer', async () => {
    const ctx = { ...disconnectedContext(), openError: new StorageError('unavailable') }
    const result = toToolResult(await read.search(ctx, { query: 'x' }).catch((e: unknown) => e), [])
    expect((result.content[0] as any).text).toContain('not reachable')
  })

  it('hides secrets in storage errors', () => {
    const conn = 'postgresql://user:hunter2@ep-1.neon.tech/db'
    const result = toToolResult(new StorageError('failed', `could not connect to ${conn}`), [conn])
    const text = (result.content[0] as any).text as string
    expect(result.isError).toBe(true)
    expect(text).toContain('[hidden]')
    expect(text).not.toContain(conn)
    expect(text).not.toContain('hunter2')
  })

  it('hides secrets in other errors too', () => {
    const result = toToolResult(new Error('boom hunter2'), ['hunter2'])
    expect((result.content[0] as any).text).toBe('Unexpected error: boom [hidden]')
  })
})


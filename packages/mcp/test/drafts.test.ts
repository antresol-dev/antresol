import { newId, type Id, type Intake, type InventoryStorage } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { ToolError } from '../src/errors'
import * as drafts from '../src/tools/drafts'
import * as read from '../src/tools/read'
import { makeContext, TEST_ACTOR, type Fixture } from './fixture'

const CLIENT = { device: 'Test Client · MCP' }

async function ctxOf(options: Parameters<typeof makeContext>[0] = {}): Promise<Fixture> {
  const f = await makeContext(options)
  f.ctx.actor = () => CLIENT
  return f
}
const create = async (f: Fixture) => ((await drafts.createIntake(f.ctx, { shop: 'LCSC' })) as any).id as Id
const get = async (f: Fixture, id: Id) => (await read.getIntake(f.ctx, { intake: id })) as any
const rawIntake = async (f: Fixture, id: Id): Promise<Intake> => (await f.storage.listIntakes(f.inventoryId)).intakes.find((i) => i.id === id)!

describe('createIntake and header', () => {
  it('creates a draft by the client, without a rev change', async () => {
    const f = await ctxOf()
    const rev = (await f.storage.listInventories()).rev
    const before = await f.storage.intakesRev()
    const v = (await drafts.createIntake(f.ctx, { shop: 'LCSC', orderNumber: ' A-7 ' })) as any
    expect(v).toMatchObject({ status: 'draft', createdBy: 'Test Client · MCP', header: { shop: 'LCSC', orderNumber: 'A-7', purchasedOn: '2026-11-15', note: null } })
    expect(((await read.listIntakes(f.ctx, {})) as any).intakes[0]).toMatchObject({ id: v.id })
    expect((await get(f, v.id)).createdBy).toBe('Test Client · MCP')
    expect((await f.storage.listInventories()).rev).toBe(rev)
    expect(await f.storage.intakesRev()).not.toBe(before)
  })

  it('refuses a bad date and updates only passed header fields', async () => {
    const f = await ctxOf()
    await expect(drafts.createIntake(f.ctx, { purchasedOn: '15.11.2026' })).rejects.toBeInstanceOf(ToolError)
    const id = await create(f)
    const v = (await drafts.updateIntakeHeader(f.ctx, { intake: id, note: 'rush', shop: '' })) as any
    expect(v.header).toMatchObject({ shop: null, note: 'rush', purchasedOn: '2026-11-15' })
  })
})

describe('addIntakeLines', () => {
  it('adds to an existing value, a new value, and flags a repeat', async () => {
    const f = await ctxOf()
    const id = await create(f)
    let v = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.resistor, values: { Resistance: '4k7' }, amount: '10' }] })) as any
    expect(v.lines[0]).toMatchObject({ kind: 'add', amount: '10 pcs', itemId: f.ids.resistor })
    v = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.resistor, values: { [f.ids.resistance]: '47k' }, amount: '5' }] })) as any
    expect(v.lines[1]).toMatchObject({ kind: 'newValue' })
    v = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.resistor, values: { Resistance: '4,7k' }, amount: '1' }] })) as any
    expect(v.lines[2].alreadyInDraft).toBe(true)
    expect(v.lines[0].alreadyInDraft).toBe(true)
  })

  it('makes a new item with an existing and a new tag', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [{ ref: 'a', name: 'LM358', folder: 'Modules', tags: ['SMD', 'Op-amps'] }],
      lines: [{ item: 'a', amount: '5', price: '35,50', url: 'https://example.com/x' }],
    })) as any
    expect(v.lines[0]).toMatchObject({ kind: 'newItem', price: '35.50', url: 'https://example.com/x' })
    expect(v.newItems[0]).toMatchObject({ name: 'LM358', folder: 'Modules', unit: 'pcs', tags: ['SMD', 'Op-amps'] })
    const raw = (await rawIntake(f, id)).draft!
    expect(raw.newTags).toHaveLength(1)
    expect(raw.newTags![0]!.name).toBe('Op-amps')
    expect(raw.newItems[0]!.tagIds).toContain(f.ids.smd)
    expect(raw.newItems[0]!.tagIds).toContain(raw.newTags![0]!.id)
    expect(raw.lines[0]!.totalPrice).toBe(3550)
    // a later line adds to the new item by its id
    const v2 = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: raw.newItems[0]!.id, amount: '2' }] })) as any
    expect(v2.lines).toHaveLength(2)
    expect(v2.newItems).toHaveLength(1)
  })

  it('new item with a variant attribute takes values per line, and looksLike points at stock', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [{ ref: 'r', name: 'Resistor 0.25 W', folder: 'Passives/Resistors', attributes: [{ attribute: 'Resistance', axis: true }] }],
      lines: [
        { item: 'r', values: { Resistance: '100' }, amount: '10' },
        { item: 'r', values: { Resistance: '220' }, amount: '10' },
      ],
    })) as any
    expect(v.lines.map((l: any) => l.kind)).toEqual(['newItem', 'newItem'])
    expect(v.newItems).toHaveLength(1)
    expect(v.newItems[0].looksLike).toMatchObject({ itemId: f.ids.resistor })
  })

  it('is all or nothing, with the app\'s texts', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const e1 = await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }, { item: f.ids.esp32, amount: '' }] }).catch((e) => e)
    expect(e1).toBeInstanceOf(ToolError)
    expect(e1.message).toContain('line 2: Enter the amount.')
    const e2 = await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: 'abc' }] }).catch((e) => e)
    expect(e2.message).toMatch(/line 1: Enter a valid amount, like /)
    const e3 = await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.resistor, amount: '1' }] }).catch((e) => e)
    expect(e3.message).toContain('line 1: Enter Resistance.')
    const e4 = await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1', photo: 'x.jpg' }] }).catch((e) => e)
    expect(e4).toBeInstanceOf(ToolError)
    expect((await rawIntake(f, id)).draft!.lines).toHaveLength(0)
  })

  it('keeps the creator when it adds to a draft made in the app', async () => {
    const f = await ctxOf()
    const id = newId()
    await f.storage.saveIntakeDraft(
      { id, inventoryId: f.inventoryId, header: { shop: null, orderNumber: null, purchasedOn: '2026-11-14', note: null }, content: { newItems: [], lines: [] } },
      null,
      { device: 'Pixel 10' },
    )
    const v = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }] })) as any
    expect(v.lines).toHaveLength(1)
    expect(v.createdBy).toBe('Pixel 10')
    expect(v.updatedBy).toBe('Test Client · MCP')
  })
})

function wrapped(f: Fixture, changedTimes: number, calls: any[]): InventoryStorage {
  let left = changedTimes
  const real = f.storage
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== 'saveIntakeDraft') return Reflect.get(target, prop, receiver)
      return async (draft: any, base: string | null, actor: any, options?: any) => {
        calls.push(options)
        if (left > 0) {
          left--
          // another device saves first, with an extra line
          const current = (await real.listIntakes(draft.inventoryId)).intakes.find((i) => i.id === draft.id)!
          const extra = { ...current.draft!.lines[0]!, id: newId(), ids: { movementId: newId(), variantId: newId(), photoId: newId() } }
          await real.saveIntakeDraft(
            { id: draft.id, inventoryId: draft.inventoryId, header: current.header, content: { ...current.draft!, lines: [...current.draft!.lines, extra] } },
            current.draftRev,
            { device: 'Pixel 10' },
          )
          const now = (await real.listIntakes(draft.inventoryId)).intakes.find((i) => i.id === draft.id)!
          return { saved: false, reason: 'changed', current: now }
        }
        return real.saveIntakeDraft(draft, base, actor, options)
      }
    },
  })
}

describe('never over another device (Review Focus 1)', () => {
  it('applies the edit on top of what the other device saved', async () => {
    const f = await ctxOf()
    const id = await create(f)
    await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }] })
    const calls: any[] = []
    f.ctx.storage = wrapped(f, 1, calls)
    const v = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '7' }] })) as any
    expect(v.lines).toHaveLength(3)
    expect(v.lines.map((l: any) => l.amount)).toEqual(['1 pcs', '1 pcs', '7 pcs'])
    expect(calls.every((o) => !o?.force)).toBe(true)
  })

  it('gives up on a second change and leaves the other device\'s write', async () => {
    const f = await ctxOf()
    const id = await create(f)
    await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }] })
    const calls: any[] = []
    f.ctx.storage = wrapped(f, 2, calls)
    await expect(drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '7' }] })).rejects.toThrow(/being edited in the app/)
    const lines = (await rawIntake(f, id)).draft!.lines
    expect(lines).toHaveLength(3)
    expect(lines.some((l) => l.quantity === '7')).toBe(false)
    expect(calls.every((o) => !o?.force)).toBe(true)
  })
})

describe('refusals', () => {
  it('refuses an archived inventory (Review Focus 4)', async () => {
    const f = await ctxOf({ secondInventory: true })
    const id = newId()
    await f.storage.saveIntakeDraft(
      { id, inventoryId: f.secondInventoryId!, header: { shop: null, orderNumber: null, purchasedOn: '2026-11-14', note: null }, content: { newItems: [], lines: [] } },
      null,
      TEST_ACTOR,
    )
    await f.apply({ type: 'archive', target: 'inventory', id: f.secondInventoryId!, archiveId: newId() })
    f.source.refresh()
    const before = (await f.storage.listIntakes(f.secondInventoryId!)).intakes[0]!
    await expect(drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }] })).rejects.toThrow(/archived/)
    await expect(drafts.updateIntakeHeader(f.ctx, { intake: id, note: 'x' })).rejects.toThrow(/archived/)
    await expect(drafts.createIntake(f.ctx, { inventory: 'Workshop' })).rejects.toBeInstanceOf(ToolError)
    const after = (await f.storage.listIntakes(f.secondInventoryId!)).intakes[0]!
    expect(after.draftRev).toBe(before.draftRev)
  })

  it('refuses a committed intake but allows its header', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const v = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }] })) as any
    const intake = await rawIntake(f, id)
    const line = intake.draft!.lines[0]!
    await f.storage.apply(
      {
        type: 'intake.commit',
        intakeId: id,
        inventoryId: f.inventoryId,
        baseRev: (await f.storage.listInventories()).rev,
        baseDraftRev: intake.draftRev,
        header: intake.header,
        newFolders: [],
        newAttributes: [],
        newTags: [],
        newItems: [],
        newVariants: [],
        unarchiveVariants: [],
        receipts: [{ movementId: line.ids.movementId, itemId: f.ids.esp32, variantId: null, quantity: '1', totalPrice: null, sourceUrl: null }],
        photos: [],
        lines: [
          { lineId: line.id, kind: 'add', itemId: f.ids.esp32, variantId: null, movementId: line.ids.movementId, itemName: 'ESP32 DevKit', variantLabel: null, quantity: '1', unitKey: 'pcs', totalPrice: null, sourceUrl: null },
        ],
        created: { folders: [], attributes: [], tags: [], items: [] },
      },
      TEST_ACTOR,
    )
    f.source.refresh()
    expect(v.lines).toHaveLength(1)
    await expect(drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }] })).rejects.toThrow(/already committed/)
    const h = (await drafts.updateIntakeHeader(f.ctx, { intake: id, note: 'late note' })) as any
    expect(h).toMatchObject({ status: 'committed', header: { note: 'late note' } })
  })

  it('refuses a read-only source', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const ro = Object.create(f.source, { readOnly: { value: true } })
    f.ctx.source = ro
    await expect(drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }] })).rejects.toThrow(/Update Antresol MCP/)
  })
})

describe('edit and remove', () => {
  it('updates and removes lines; the last line of a new item takes the item and its tag', async () => {
    const f = await ctxOf()
    const id = await create(f)
    let v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [{ ref: 'a', name: 'LM358', tags: ['Op-amps'] }],
      lines: [
        { item: 'a', amount: '5', price: '10', url: 'https://example.com/a' },
        { item: f.ids.esp32, amount: '1' },
      ],
    })) as any
    const [la, lb] = v.lines
    v = await drafts.updateIntakeLine(f.ctx, { intake: id, line: la.id, amount: '8', price: '' })
    expect(v.lines[0]).toMatchObject({ amount: '8 pcs', price: null, url: 'https://example.com/a' })
    v = await drafts.updateIntakeLine(f.ctx, { intake: id, line: lb.id, url: 'https://example.com/b' })
    expect(v.lines[1]).toMatchObject({ amount: '1 pcs', url: 'https://example.com/b' })
    await expect(drafts.updateIntakeLine(f.ctx, { intake: id, line: lb.id, amount: 'x' })).rejects.toBeInstanceOf(ToolError)
    v = await drafts.removeIntakeLine(f.ctx, { intake: id, line: la.id })
    expect(v.newItems).toHaveLength(0)
    const raw = (await rawIntake(f, id)).draft!
    expect(raw.newItems).toHaveLength(0)
    expect(raw.newTags ?? []).toHaveLength(0)
    await expect(drafts.removeIntakeLine(f.ctx, { intake: id, line: la.id })).rejects.toBeInstanceOf(ToolError)
  })

  it('updates a new item', async () => {
    const f = await ctxOf()
    const id = await create(f)
    let v = (await drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name: 'LM358' }], lines: [{ item: 'a', amount: '5' }] })) as any
    const nid = v.newItems[0].id
    v = await drafts.updateNewItem(f.ctx, { intake: id, item: nid, name: 'LM358P', folder: 'Modules', tags: ['SMD'], unit: 'pcs' })
    expect(v.newItems[0]).toMatchObject({ name: 'LM358P', folder: 'Modules', tags: ['SMD'] })
    await expect(drafts.updateNewItem(f.ctx, { intake: id, item: f.ids.esp32, name: 'x' })).rejects.toBeInstanceOf(ToolError)
    await expect(drafts.updateNewItem(f.ctx, { intake: id, item: nid, name: ' ' })).rejects.toBeInstanceOf(ToolError)
    v = await drafts.updateNewItem(f.ctx, { intake: id, item: nid, attributes: [{ attribute: 'Power', value: '0.25W' }] })
    expect(v.newItems[0].attributes).toEqual([{ name: 'Power', value: '0.25 W', axis: false }])
  })
})


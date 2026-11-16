import { copyFile, mkdir, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { newId, type FileStore, type Id, type Intake, type InventoryStorage } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config'
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
    // a new item without variant attributes is created by one line; a second one is refused and names the first
    const again = await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: raw.newItems[0]!.id, amount: '2' }] }).catch((e: unknown) => e)
    expect(again).toBeInstanceOf(ToolError)
    expect((again as Error).message).toMatch(/already creates[\s\S]*line 1 \(id /)
    expect((await get(f, id)).lines).toHaveLength(1)
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
  it('updates and removes lines; the new item and its tag stay, remove_new_item takes item and lines', async () => {
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
    expect(v.lines).toHaveLength(1)
    expect(v.newItems).toHaveLength(1)
    let raw = (await rawIntake(f, id)).draft!
    expect(raw.newItems).toHaveLength(1)
    expect(raw.newTags ?? []).toHaveLength(1)
    await expect(drafts.removeIntakeLine(f.ctx, { intake: id, line: la.id })).rejects.toBeInstanceOf(ToolError)
    v = await drafts.removeNewItem(f.ctx, { intake: id, item: raw.newItems[0]!.id })
    expect(v.newItems).toHaveLength(0)
    raw = (await rawIntake(f, id)).draft!
    expect(raw.newItems).toHaveLength(0)
    expect(raw.newTags ?? []).toHaveLength(0)
    await expect(drafts.removeNewItem(f.ctx, { intake: id, item: 'nope' })).rejects.toBeInstanceOf(ToolError)
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


describe('draft folders and attributes', () => {
  it('makes nested folders by path, new items use them, get_intake shows them', async () => {
    const f = await ctxOf()
    const id = await create(f)
    let v = (await drafts.createFolder(f.ctx, { intake: id, name: 'Tools' })) as any
    expect(v.newFolders).toMatchObject([{ path: 'Tools', problem: null }])
    v = (await drafts.createFolder(f.ctx, { intake: id, name: 'Drills', parent: 'tools' })) as any
    v = (await drafts.createFolder(f.ctx, { intake: id, name: 'Bits', parent: 'Tools / Drills' })) as any
    v = (await drafts.createFolder(f.ctx, { intake: id, name: 'Caps', parent: 'Passives' })) as any
    expect(v.newFolders.map((x: any) => x.path)).toEqual(['Tools', 'Tools/Drills', 'Tools/Drills/Bits', 'Passives/Caps'])
    v = (await drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name: 'HSS 3 mm', folder: 'Tools/Drills/Bits', description: ' sharp ' }], lines: [{ item: 'a', amount: '2' }] })) as any
    expect(v.newItems[0]).toMatchObject({ folder: 'Tools/Drills/Bits', description: 'sharp', photo: null, problem: null })
    expect(v.ok).toBe(true)
    v = (await drafts.updateFolder(f.ctx, { intake: id, folder: 'Tools/Drills/Bits', name: 'Bit sets', parent: '' })) as any
    expect(v.newFolders.map((x: any) => x.path)).toContain('Bit sets')
    expect(v.newItems[0].folder).toBe('Bit sets')
    await expect(drafts.updateFolder(f.ctx, { intake: id, folder: 'Passives', name: 'x' })).rejects.toBeInstanceOf(ToolError)
  })

  it('refuses a duplicate folder and attribute with the existing one named, a cycle and a non-empty removal', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const dupe = (await drafts.createFolder(f.ctx, { intake: id, name: 'resistors', parent: 'Passives' }).catch((e: unknown) => e)) as Error
    expect(dupe).toBeInstanceOf(ToolError)
    expect(dupe.message).toContain('Passives/Resistors')
    expect(dupe.message).toContain(f.ids.resistors)
    await drafts.createFolder(f.ctx, { intake: id, name: 'Tools' })
    await drafts.createFolder(f.ctx, { intake: id, name: 'Drills', parent: 'Tools' })
    const again = (await drafts.createFolder(f.ctx, { intake: id, name: 'TOOLS' }).catch((e: unknown) => e)) as Error
    expect(again.message).toMatch(/already a folder[\s\S]*"Tools"[\s\S]*id /)
    const cycle = await drafts.updateFolder(f.ctx, { intake: id, folder: 'Tools', parent: 'Tools/Drills' }).catch((e: unknown) => e)
    expect((cycle as Error).message).toMatch(/inside itself/)
    const full = await drafts.removeFolder(f.ctx, { intake: id, folder: 'Tools' }).catch((e: unknown) => e)
    expect((full as Error).message).toMatch(/Move or remove/)
    expect(((await drafts.removeFolder(f.ctx, { intake: id, folder: 'Tools/Drills' })) as any).newFolders).toHaveLength(1)
    const a = (await drafts.createAttribute(f.ctx, { intake: id, name: 'resistance', kind: 'number' }).catch((e: unknown) => e)) as Error
    expect(a).toBeInstanceOf(ToolError)
    expect(a.message).toContain(f.ids.resistance)
    expect(a.message).toContain('Resistance')
  })

  it('makes attributes of the three kinds; new items use them by name, also as an axis', async () => {
    const f = await ctxOf()
    const id = await create(f)
    let v = (await drafts.createAttribute(f.ctx, { intake: id, name: 'Voltage', kind: 'number', unit: 'V', siPrefixes: true })) as any
    v = (await drafts.createAttribute(f.ctx, { intake: id, name: 'Package', kind: 'list', options: ['0603', ' 0805 ', ''] })) as any
    v = (await drafts.createAttribute(f.ctx, { intake: id, name: 'Maker', kind: 'text', unit: 'ignored' })) as any
    expect(v.newAttributes).toMatchObject([
      { name: 'Voltage', kind: 'number', unit: 'V', siPrefixes: true, options: [], problem: null },
      { name: 'Package', kind: 'list', unit: null, siPrefixes: false, options: ['0603', '0805'] },
      { name: 'Maker', kind: 'text', unit: null },
    ])
    v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [{ ref: 'c', name: 'Cap', attributes: [{ attribute: 'Voltage', axis: true }, { attribute: 'Package', value: '0603' }] }],
      lines: [
        { item: 'c', values: { Voltage: '16' }, amount: '5' },
        { item: 'c', values: { Voltage: '25' }, amount: '5' },
      ],
    })) as any
    expect(v.lines.map((l: any) => l.values)).toEqual(['16 V', '25 V'])
    expect(v.newItems[0].attributes).toEqual([
      { name: 'Package', value: '0603', axis: false },
      { name: 'Voltage', value: null, axis: true },
    ])
    const inUse = await drafts.removeAttribute(f.ctx, { intake: id, attribute: 'Voltage' }).catch((e: unknown) => e)
    expect((inUse as Error).message).toMatch(/uses this attribute/)
    v = (await drafts.updateAttribute(f.ctx, { intake: id, attribute: 'Maker', name: 'Brand' })) as any
    expect(v.newAttributes[2].name).toBe('Brand')
    v = (await drafts.removeAttribute(f.ctx, { intake: id, attribute: 'Brand' })) as any
    expect(v.newAttributes).toHaveLength(2)
    await expect(drafts.updateAttribute(f.ctx, { intake: id, attribute: 'Resistance', name: 'x' })).rejects.toBeInstanceOf(ToolError)
  })

  it('a second line making the same variant of a new item names the first line; an existing item works the same', async () => {
    const f = await ctxOf()
    const id = await create(f)
    await drafts.createAttribute(f.ctx, { intake: id, name: 'Inductance', kind: 'number', unit: 'H', siPrefixes: true })
    const args = { intake: id, newItems: [{ ref: 'l', name: 'Inductor', attributes: [{ attribute: 'Inductance', axis: true }] }] }
    await drafts.addIntakeLines(f.ctx, { ...args, lines: [{ item: 'l', values: { Inductance: '4.7 µH' }, amount: '3' }] })
    const draft = (await rawIntake(f, id)).draft!
    const err = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: draft.newItems[0]!.id, values: { Inductance: '4u7' }, amount: '1' }] }).catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(ToolError)
    expect(err.message).toContain(`line 1 (id ${draft.lines[0]!.id})`)
    expect((await get(f, id)).lines).toHaveLength(1)
    await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.resistor, values: { Resistance: '47k' }, amount: '1' }] })
    const e2 = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.resistor, values: { Resistance: '47000' }, amount: '1' }] }).catch((e: unknown) => e)) as Error
    expect(e2.message).toMatch(/already creates[\s\S]*line 2/)
  })

  it('refuses a draft folder with a problem in get_intake, not ok', async () => {
    const f = await ctxOf()
    const id = await create(f)
    await drafts.createFolder(f.ctx, { intake: id, name: 'Tools' })
    await drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name: 'Saw', withoutLines: true, folder: 'Tools' }], lines: [] })
    // a folder with that name appears in stock meanwhile
    await f.apply({ type: 'folder.create', id: newId(), inventoryId: f.inventoryId, parentId: null, name: 'Tools', description: null })
    f.ctx.source!.refresh()
    const v = await get(f, id)
    expect(v.newFolders[0].problem).toMatch(/already exists/)
    expect(v.ok).toBe(false)
  })
})

describe('items without lines', () => {
  it('an item with no line is refused unless withoutLines; it lives on and shows in get_intake', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const bad = await drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name: 'Saw' }], lines: [{ item: f.ids.esp32, amount: '1' }] }).catch((e: unknown) => e)
    expect((bad as Error).message).toMatch(/no line uses it[\s\S]*withoutLines/)
    expect((await get(f, id)).lines).toHaveLength(0)
    const none = await drafts.addIntakeLines(f.ctx, { intake: id, lines: [] }).catch((e: unknown) => e)
    expect(none).toBeInstanceOf(ToolError)
    const v = (await drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name: 'Saw', description: 'Hand saw', withoutLines: true }] })) as any
    expect(v.lines).toHaveLength(0)
    expect(v.newItems).toMatchObject([{ name: 'Saw', description: 'Hand saw' }])
    expect(v.ok).toBe(true)
    const raw = (await rawIntake(f, id)).draft!
    // a line later still leaves it be, and removing that line keeps the item
    const w = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: raw.newItems[0]!.id, amount: '1' }] })) as any
    expect(w.lines).toHaveLength(1)
    await drafts.removeIntakeLine(f.ctx, { intake: id, line: w.lines[0].id })
    expect((await get(f, id)).newItems).toHaveLength(1)
    const u = (await drafts.updateNewItem(f.ctx, { intake: id, item: raw.newItems[0]!.id, description: '' })) as any
    expect(u.newItems[0].description).toBeNull()
  })
})

describe('item photos', () => {
  async function photoSetup() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'antresol-itemphoto-'))
    const photosDir = path.join(root, 'photos')
    await mkdir(photosDir)
    await copyFile(path.join(__dirname, 'fixtures', 'gradient.png'), path.join(photosDir, 'a.png'))
    const uploads: string[] = []
    const files: FileStore = {
      provider: 'fake',
      async upload(_blob, name) {
        uploads.push(name)
        return { provider: 'fake', fileId: `f${uploads.length}`, url: `https://img.example/${uploads.length}`, urls: null, deleteHandle: null }
      },
    }
    const f = await ctxOf()
    f.ctx.config = { ...readConfig({ ANTRESOL_PHOTOS_DIR: photosDir }, 'linux', root), stateDir: path.join(root, 'state') }
    f.ctx.files = files
    return { f, uploads, id: await create(f) }
  }

  it('a new item takes a photo with or without lines; update sets and removes it', async () => {
    const { f, uploads, id } = await photoSetup()
    let v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [
        { ref: 'a', name: 'Saw', photo: 'a.png', withoutLines: true },
        { ref: 'b', name: 'Plane', photo: 'a.png' },
      ],
      lines: [{ item: 'b', amount: '1' }],
    })) as any
    expect(uploads).toHaveLength(1)
    expect(v.newItems.map((n: any) => n.photo)).toEqual(['https://img.example/1', 'https://img.example/1'])
    expect(v.lines[0].photo).toBeNull()
    const raw = (await rawIntake(f, id)).draft!
    expect(raw.newItems.every((n) => n.photoId)).toBe(true)
    const nid = raw.newItems[0]!.id
    v = (await drafts.updateNewItem(f.ctx, { intake: id, item: nid, name: 'Saw 2' })) as any
    expect(v.newItems[0].photo).toBe('https://img.example/1')
    v = (await drafts.updateNewItem(f.ctx, { intake: id, item: nid, photo: '' })) as any
    expect(v.newItems[0].photo).toBeNull()
    v = (await drafts.updateNewItem(f.ctx, { intake: id, item: nid, photo: 'a.png' })) as any
    expect(v.newItems[0].photo).toBe('https://img.example/1')
    expect(uploads).toHaveLength(1)
  })

  it('a photo on a top-up line is refused with the app text; a new variant takes it', async () => {
    const { f, id } = await photoSetup()
    const bad = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.resistor, values: { Resistance: '4k7' }, amount: '1', photo: 'a.png' }] }).catch((e: unknown) => e)) as Error
    expect(bad).toBeInstanceOf(ToolError)
    expect(bad.message).toMatch(/adds stock to something you already have takes no photo/)
    expect((await get(f, id)).lines).toHaveLength(0)
    const ok = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.resistor, values: { Resistance: '33k' }, amount: '1', photo: 'a.png' }] })) as any
    expect(ok.lines[0].photo.url).toBe('https://img.example/1')
  })
})

import { buildIntakeCommit, newId, resolveIntake, type Id, type Intake } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { ToolError } from '../src/errors'
import * as drafts from '../src/tools/drafts'
import * as read from '../src/tools/read'
import { makeContext, TEST_ACTOR, type Fixture } from './fixture'

async function ctxOf(options: Parameters<typeof makeContext>[0] = {}): Promise<Fixture> {
  const f = await makeContext(options)
  f.ctx.actor = () => ({ device: 'Test Client · MCP' })
  return f
}
const create = async (f: Fixture) => ((await drafts.createIntake(f.ctx, { shop: 'LCSC' })) as any).id as Id
const get = async (f: Fixture, id: Id) => (await read.getIntake(f.ctx, { intake: id })) as any
const raw = async (f: Fixture, id: Id): Promise<Intake> => (await f.storage.listIntakes(f.inventoryId)).intakes.find((i) => i.id === id)!
const refused = async (p: Promise<unknown>): Promise<string> => {
  const e = await p.catch((x: unknown) => x)
  expect(e).toBeInstanceOf(ToolError)
  return (e as Error).message
}

/** A list attribute "Package" (0603, 1206) with an item "Capacitor" in Passives that varies by it. */
async function withPackage(f: Fixture) {
  const pkg = newId()
  const cap = newId()
  await f.apply({ type: 'attribute.create', id: pkg, inventoryId: f.inventoryId, name: 'Package', kind: 'enum', options: ['0603', '1206'], unit: '', siPrefixes: false })
  await f.apply({ type: 'item.create', id: cap, inventoryId: f.inventoryId, folderId: f.ids.passives, name: 'Capacitor', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null })
  await f.apply({ type: 'item.addAxis', itemId: cap, attributeId: pkg, firstVariantId: newId() })
  await f.apply({ type: 'variant.createMany', itemId: cap, variants: [{ id: newId(), values: [{ attributeId: pkg, value: '0603' }] }] })
  f.source.refresh()
  return { pkg, cap }
}

describe('declarations under the item', () => {
  it('a new item declares an attribute (pinned), a tag with a colour, its own unit, an icon and a colour', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [
        {
          ref: 'w',
          name: 'Copper wire',
          folder: 'Modules',
          unit: { name: 'Metre', symbol: 'mtr', prefixes: ['k', 'm'] },
          icon: 'cable',
          color: '#aa3322',
          attributes: [
            { attribute: 'Gauge', kind: 'list', options: ['0.5', '1.0'], pinned: true, axis: true },
            { attribute: 'Resistance', value: '4k7' },
            { attribute: 'Maker', kind: 'text', value: 'ACME' },
          ],
          tags: ['SMD', { name: 'Bulk', color: '#336699' }],
        },
      ],
      lines: [{ item: 'w', values: { Gauge: '1.0' }, amount: '2.5 mtr' }],
    })) as any
    const d = (await raw(f, id)).draft!
    expect(d.newAttributes!.map((a) => [a.name, a.kind, a.pinned === true])).toEqual([
      ['Gauge', 'enum', true],
      ['Maker', 'text', false],
    ])
    expect(d.newTags).toMatchObject([{ name: 'Bulk', color: '#336699' }])
    expect(d.newUnits).toMatchObject([{ name: 'Metre', symbol: 'mtr', prefixPowers: [3, -3] }])
    expect(d.newItems[0]).toMatchObject({ icon: 'cable', color: '#AA3322', unitKey: `custom:${d.newUnits![0]!.id}` })
    expect(v.newItems[0]).toMatchObject({ icon: 'cable', color: '#AA3322', unit: 'mtr', tags: ['SMD', 'Bulk'] })
    expect(v.newItems[0].attributes).toEqual([
      { name: 'Resistance', value: '4.7 kΩ', axis: false },
      { name: 'Maker', value: 'ACME', axis: false },
      { name: 'Gauge', value: null, axis: true },
    ])
    expect(v.newAttributes).toMatchObject([{ name: 'Gauge', kind: 'list', pinned: true, options: ['0.5', '1.0'] }, { name: 'Maker', pinned: false }])
    expect(v.newUnits).toMatchObject([{ name: 'Metre', symbol: 'mtr', prefixes: ['k', 'm'], problem: null }])
    expect(v.newTags).toMatchObject([{ name: 'Bulk', color: '#336699' }])
    expect(v.lines[0]).toMatchObject({ amount: '2.5 mtr', values: '1.0' })
    expect(v.ok).toBe(true)
    // and the commit makes all of it
    const intake = await raw(f, id)
    const s = await f.source.snapshot(f.inventoryId)
    await f.storage.apply(buildIntakeCommit(intake, resolveIntake(intake.draft!, s), s, (await f.storage.listInventories()).rev), TEST_ACTOR)
    f.source.refresh()
    const after = await f.source.snapshot(f.inventoryId)
    expect(after.units.map((u) => u.symbol)).toEqual(['mtr'])
    expect(after.attributes.find((a) => a.name === 'Gauge')).toMatchObject({ pinned: true })
    expect(after.tags.find((t) => t.name === 'Bulk')).toMatchObject({ color: '#336699' })
  })

  it('an existing unit by symbol, an existing attribute by id, and update_new_item declares more', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [{ ref: 'a', name: 'Cable', unit: 'm', attributes: [{ attribute: f.ids.power, value: '5' }], withoutLines: true }],
    })) as any
    expect(v.newItems[0]).toMatchObject({ unit: 'm' })
    const u = (await drafts.updateNewItem(f.ctx, {
      intake: id,
      item: v.newItems[0].id,
      icon: 'zap',
      unit: { name: 'Reel', symbol: 'reel' },
      attributes: [{ attribute: 'Colour', kind: 'list', options: ['red'], value: 'red' }],
    })) as any
    expect(u.newItems[0]).toMatchObject({ icon: 'zap', unit: 'reel', attributes: [{ name: 'Colour', value: 'red', axis: false }] })
    expect(u.newUnits).toHaveLength(1)
    const c = (await drafts.updateNewItem(f.ctx, { intake: id, item: v.newItems[0].id, icon: '', unit: 'pcs', attributes: [] })) as any
    // what the item no longer uses goes with it
    expect(c.newUnits).toEqual([])
    expect(c.newAttributes).toEqual([])
    expect(c.newItems[0].icon).toBeNull()
  })

  it('refuses a bad icon, colour, unit prefix and pinned over the limit, saving nothing', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const item = (extra: object) => ({ intake: id, newItems: [{ ref: 'a', name: 'Thing', withoutLines: true, ...extra }] })
    expect(await refused(drafts.addIntakeLines(f.ctx, item({ icon: 'Not An Icon' })))).toMatch(/icon/i)
    expect(await refused(drafts.addIntakeLines(f.ctx, item({ color: 'red' })))).toMatch(/colou?r/i)
    expect(await refused(drafts.addIntakeLines(f.ctx, item({ tags: [{ name: 'x', color: 'blue' }] })))).toMatch(/colou?r/i)
    expect(await refused(drafts.addIntakeLines(f.ctx, item({ unit: { name: 'X', symbol: 'x', prefixes: ['q?'] } })))).toMatch(/prefix/i)
    const three = ['A', 'B', 'C'].map((attribute) => ({ attribute, kind: 'text' as const, pinned: true }))
    expect(await refused(drafts.addIntakeLines(f.ctx, item({ attributes: three })))).toMatch(/shown in lists/)
    expect((await get(f, id)).newItems).toHaveLength(0)
  })

  it('a line of an existing item adds a value to a list attribute and describes the new variant', async () => {
    const f = await ctxOf()
    const { pkg, cap } = await withPackage(f)
    const id = await create(f)
    const v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      lines: [{ item: cap, values: { Package: '0805' }, addValues: [{ attribute: 'Package', value: '0805' }], description: ' 2012 metric ', amount: '10' }],
    })) as any
    expect(v.lines[0]).toMatchObject({ kind: 'newValue', values: '0805', variantDescription: '2012 metric' })
    expect(v.addedValues).toEqual([{ attribute: 'Package', values: ['0805'], problem: null }])
    const d = (await raw(f, id)).draft!
    expect(d.addedOptions).toEqual([{ attributeId: pkg, values: ['0805'] }])
    expect(d.lines[0]!.variantDescription).toBe('2012 metric')
    // a top-up takes no description
    const top = await refused(drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: cap, values: { Package: '0603' }, description: 'x', amount: '1' }] }))
    expect(top).toMatch(/description/)
    // a value nothing uses is refused, not dropped silently
    const unused = await refused(drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: f.ids.esp32, addValues: [{ attribute: 'Package', value: '2512' }], amount: '1' }] }))
    expect(unused).toMatch(/2512/)
    // update_intake_line may add one too, and the one nothing uses any more goes
    const lineId = d.lines[0]!.id
    const u = (await drafts.updateIntakeLine(f.ctx, { intake: id, line: lineId, values: { Package: '2512' }, addValues: [{ attribute: 'Package', value: '2512' }], description: 'big' })) as any
    expect(u.addedValues).toEqual([{ attribute: 'Package', values: ['2512'], problem: null }])
    expect(u.lines[0]).toMatchObject({ values: '2512', variantDescription: 'big' })
    // the commit appends and creates the variant with its description
    const intake = await raw(f, id)
    const s = await f.source.snapshot(f.inventoryId)
    await f.storage.apply(buildIntakeCommit(intake, resolveIntake(intake.draft!, s), s, (await f.storage.listInventories()).rev), TEST_ACTOR)
    f.source.refresh()
    const after = await f.source.snapshot(f.inventoryId)
    expect(after.attributes.find((a) => a.id === pkg)!.options).toEqual(['0603', '1206', '2512'])
    expect(after.variants.find((x) => x.itemId === cap && x.description === 'big')).toBeTruthy()
  })

  it('addValues on a value the list has (any case), on a text attribute and on an unknown one is refused', async () => {
    const f = await ctxOf()
    const { cap } = await withPackage(f)
    const id = await create(f)
    const line = (addValues: { attribute: string; value: string }[]) => drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: cap, values: { Package: '0603' }, addValues, amount: '1' }] })
    const e = await refused(line([{ attribute: 'Package', value: ' 0603 ' }]))
    expect(e).toMatch(/already has "0603"/)
    expect(e).toContain('Package')
    expect(await refused(line([{ attribute: 'Resistance', value: '5' }]))).toMatch(/list/)
    expect(await refused(line([{ attribute: 'Nope', value: '5' }]))).toMatch(/No attribute "Nope"/)
  })

  it('create_folder and update_folder take an icon', async () => {
    const f = await ctxOf()
    const id = await create(f)
    let v = (await drafts.createFolder(f.ctx, { intake: id, name: 'Tools', icon: 'wrench' })) as any
    expect(v.newFolders[0]).toMatchObject({ path: 'Tools', icon: 'wrench' })
    v = (await drafts.updateFolder(f.ctx, { intake: id, folder: 'Tools', icon: 'hammer' })) as any
    expect(v.newFolders[0].icon).toBe('hammer')
    v = (await drafts.updateFolder(f.ctx, { intake: id, folder: 'Tools', icon: '' })) as any
    expect(v.newFolders[0].icon).toBeNull()
    expect(await refused(drafts.createFolder(f.ctx, { intake: id, name: 'X', icon: 'No Good' }))).toMatch(/icon/i)
  })
})

describe('hard duplicates name the existing entity', () => {
  it('a new item with the name of an item of its folder, living or archived, another new item', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const item = (name: string, folder = 'Passives/Resistors') => drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name, folder, withoutLines: true }] })
    const living = await refused(item(' resistor 0.25 w'))
    expect(living).toContain(f.ids.resistor)
    expect(living).toContain('Passives/Resistors')
    expect(living).not.toMatch(/archived/i)
    await f.apply({ type: 'archive', target: 'item', id: f.ids.esp32, archiveId: newId() })
    f.source.refresh()
    const archived = await refused(item('ESP32 DevKit', 'Modules'))
    expect(archived).toMatch(/archived/i)
    expect(archived).toContain(f.ids.esp32)
    expect(archived).toContain('Modules')
    await item('Saw')
    const twin = await refused(item('SAW'))
    expect(twin).toMatch(/another new item/i)
    expect((await get(f, id)).newItems).toHaveLength(1)
    // the same name in another folder is fine, and says so in `similar`
    const ok = (await item('Saw', 'Modules')) as any
    expect(ok.newItems).toHaveLength(2)
  })

  it('update_new_item cannot rename or move into a twin', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const v = (await drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name: 'Saw', folder: 'Modules', withoutLines: true }] })) as any
    const itemId = v.newItems[0].id
    expect(await refused(drafts.updateNewItem(f.ctx, { intake: id, item: itemId, name: 'esp32 devkit' }))).toContain(f.ids.esp32)
    await drafts.updateNewItem(f.ctx, { intake: id, item: itemId, name: 'ESP32 DevKit', folder: 'Passives' })
    expect(await refused(drafts.updateNewItem(f.ctx, { intake: id, item: itemId, folder: 'Modules' }))).toContain(f.ids.esp32)
  })

  it('an attribute, a unit, a folder', async () => {
    const f = await ctxOf()
    const id = await create(f)
    const one = (extra: object) => drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name: 'Thing', withoutLines: true, ...extra }] })
    const attr = await refused(one({ attributes: [{ attribute: 'resistance', kind: 'number' }] }))
    expect(attr).toContain(f.ids.resistance)
    expect(attr).toContain('Resistance')
    const unit = await refused(one({ unit: { name: 'Metre', symbol: 'm' } }))
    expect(unit).toMatch(/metre/i)
    const sym = await refused(one({ unit: { name: 'Mine', symbol: 'g' } }))
    expect(sym).toMatch(/Grams[\s\S]*key g/)
    const old = { id: newId() }
    await f.apply({ type: 'folder.create', id: old.id, inventoryId: f.inventoryId, parentId: null, name: 'Old', description: null })
    await f.apply({ type: 'archive', target: 'folder', id: old.id, archiveId: newId() })
    f.source.refresh()
    const folder = await refused(drafts.createFolder(f.ctx, { intake: id, name: 'old' }))
    expect(folder).toMatch(/archived/i)
    expect(folder).toContain(old.id)
    expect(await refused(drafts.createFolder(f.ctx, { intake: id, name: 'Modules' }))).toContain(f.ids.modules)
  })

  it('texts for problems the app marks: archived twin, pinned limit, units as names', async () => {
    const f = await ctxOf()
    const id = await create(f)
    await drafts.addIntakeLines(f.ctx, { intake: id, newItems: [{ ref: 'a', name: 'Saw', folder: 'Modules', withoutLines: true, unit: { name: 'Reel', symbol: 'reel' }, attributes: [{ attribute: 'P', kind: 'text', pinned: true }] }] })
    // meanwhile the world changes: an archived item and a unit appear
    await f.apply({ type: 'item.create', id: newId(), inventoryId: f.inventoryId, folderId: f.ids.modules, name: 'Saw', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null })
    await f.apply({ type: 'unit.create', id: newId(), inventoryId: f.inventoryId, name: 'Reel', symbol: 'rl', prefixPowers: [] } as any)
    f.source.refresh()
    const v = await get(f, id)
    expect(v.newItems[0].problem).toMatch(/an item with this name already exists/)
    expect(v.newItems[0].problem).not.toMatch(/a item/)
    expect(v.newUnits[0].problem).toMatch(/a unit with this name already exists: "Reel"/)
    expect(v.ok).toBe(false)
  })
})

describe('similar names in every write answer', () => {
  it('items: same folder and other folders, marked; folders, attributes, tags, units, values', async () => {
    const f = await ctxOf()
    const { cap } = await withPackage(f)
    const id = await create(f)
    const v = (await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [
        {
          ref: 'a',
          name: 'Resistor 0.25W',
          folder: 'Passives/Resistors',
          unit: { name: 'Metres', symbol: 'mtr' },
          attributes: [{ attribute: 'Resistence', kind: 'number' }],
          tags: ['SMDs'],
        },
        { ref: 'b', name: 'ESP32 DevKit', folder: 'Passives', withoutLines: true },
      ],
      lines: [{ item: 'a', amount: '2 mtr' }],
    })) as any
    const by = (kind: string, name: string) => v.similar.find((x: any) => x.kind === kind && x.name === name)
    expect(by('item', 'Resistor 0.25W').near).toEqual([expect.objectContaining({ id: f.ids.resistor, name: 'Resistor 0.25 W', why: 'spacing', sameFolder: true })])
    const other = by('item', 'ESP32 DevKit').near[0]
    expect(other).toMatchObject({ id: f.ids.esp32, why: 'same', where: 'Modules' })
    expect(other.sameFolder).toBeUndefined()
    expect(by('attribute', 'Resistence').near).toEqual([expect.objectContaining({ id: f.ids.resistance, why: 'typo' })])
    expect(by('tag', 'SMDs').near).toEqual([expect.objectContaining({ id: f.ids.smd, why: 'plural' })])
    expect(by('unit', 'Metres').near[0]).toMatchObject({ name: 'Meters' })
    // no near names: still listed, with an empty list
    const f2 = await drafts.createFolder(f.ctx, { intake: id, name: 'Zzz' })
    expect((f2 as any).similar).toEqual([{ kind: 'folder', name: 'Zzz', near: [] }])
    const f3 = (await drafts.createFolder(f.ctx, { intake: id, name: 'Resistor', parent: 'Passives' })) as any
    expect(f3.similar[0]).toMatchObject({ kind: 'folder', name: 'Resistor', near: [expect.objectContaining({ why: 'plural', name: 'Resistors' })] })
    const value = (await drafts.addIntakeLines(f.ctx, { intake: id, lines: [{ item: cap, values: { Package: '06030' }, addValues: [{ attribute: 'Package', value: '06030' }], amount: '1' }] })) as any
    expect(value.similar.find((x: any) => x.kind === 'value')).toMatchObject({ name: '06030', near: [expect.objectContaining({ name: '0603', why: 'typo' })] })
    // update_new_item answers too, for a renamed item
    const itemId = v.newItems[1].id
    const renamed = (await drafts.updateNewItem(f.ctx, { intake: id, item: itemId, name: 'ESP-32 DevKit' })) as any
    expect(renamed.similar[0]).toMatchObject({ kind: 'item', name: 'ESP-32 DevKit', near: [expect.objectContaining({ id: f.ids.esp32, why: 'spacing' })] })
  })
})

describe('reading', () => {
  it('get_overview lists the values of list attributes and the prefixes of units', async () => {
    const f = await ctxOf()
    await withPackage(f)
    await f.apply({ type: 'unit.create', id: newId(), inventoryId: f.inventoryId, name: 'Reel', symbol: 'rl', prefixPowers: [3, -3] } as any)
    f.source.refresh()
    const o = (await read.getOverview(f.ctx, {})) as any
    expect(o.attributes.find((a: any) => a.name === 'Package')).toMatchObject({ kind: 'list', options: ['0603', '1206'] })
    expect(o.units.custom).toEqual([expect.objectContaining({ symbol: 'rl', prefixes: ['k', 'm'] })])
    expect(o.units.builtin.find((u: any) => u.key === 'm').prefixes).toEqual(expect.arrayContaining(['k']))
  })

  it('get_intake shows the new units, pinned, colours, icons, added values and descriptions, and what a commit created', async () => {
    const f = await ctxOf()
    const { cap } = await withPackage(f)
    const id = await create(f)
    await drafts.addIntakeLines(f.ctx, {
      intake: id,
      newItems: [{ ref: 'w', name: 'Wire', icon: 'cable', color: '#112233', unit: { name: 'Reel', symbol: 'rl', prefixes: [3] }, attributes: [{ attribute: 'Gauge', kind: 'text', pinned: true }], tags: [{ name: 'Bulk', color: '#336699' }] }],
      lines: [
        { item: 'w', amount: '3 rl' },
        { item: cap, values: { Package: '0805' }, addValues: [{ attribute: 'Package', value: '0805' }], description: 'metric 2012', amount: '5' },
      ],
    })
    await drafts.createFolder(f.ctx, { intake: id, name: 'Cables', icon: 'cable' })
    const v = await get(f, id)
    expect(v.newUnits).toEqual([expect.objectContaining({ name: 'Reel', symbol: 'rl', prefixes: ['k'] })])
    expect(v.newAttributes[0].pinned).toBe(true)
    expect(v.newTags).toEqual([expect.objectContaining({ name: 'Bulk', color: '#336699' })])
    expect(v.newItems[0]).toMatchObject({ icon: 'cable', color: '#112233', unit: 'rl' })
    expect(v.newFolders[0].icon).toBe('cable')
    expect(v.addedValues).toEqual([{ attribute: 'Package', values: ['0805'], problem: null }])
    expect(v.lines[1].variantDescription).toBe('metric 2012')
    const intake = await raw(f, id)
    const s = await f.source.snapshot(f.inventoryId)
    await f.storage.apply(buildIntakeCommit(intake, resolveIntake(intake.draft!, s), s, (await f.storage.listInventories()).rev), TEST_ACTOR)
    f.source.refresh()
    const done = await get(f, id)
    expect(done.created.units).toEqual([{ id: expect.any(String), name: 'Reel', symbol: 'rl' }])
    expect(done.created.appendedValues).toEqual([{ attribute: 'Package', values: ['0805'] }])
  })
})

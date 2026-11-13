import {
  emptyIntakeDraft,
  newId,
  type Command,
  type DraftLine,
  type DraftNewItem,
  type Id,
  type IntakeDraftContent,
  type InventorySnapshot,
  type InventoryStorage,
} from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import {
  alreadyInDraft,
  attributesFrom,
  buildDraftLine,
  duplicateWarning,
  lineMatches,
  nextLineDefaults,
  priceText,
  restoreLine,
  suggestedFolder,
  valueHint,
  valuesFromQuery,
  withLine,
  withoutLine,
  type LineForm,
} from '../app/lib/intake-line'
import type { SourceConfig } from '../app/lib/types'

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}
const actor = { device: 'Test' }

let storage: InventoryStorage
let snap: InventorySnapshot
let inventoryId: Id
let resistorsFolder: Id
let power: Id
let resistance: Id
let resistor: Id
let resistor06: Id
const v = { r4k7: newId(), r10k: newId(), r43k: newId(), r51k: newId() }

const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

const run = (c: Command) => storage.apply(c, actor)

beforeAll(async () => {
  const conn = await driver.connect(cfg)
  storage = conn.storage
  inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  const before = await storage.loadInventory(inventoryId)
  resistorsFolder = before.folders.find((f) => f.name === 'Resistors')!.id
  resistance = before.attributes.find((a) => a.name === 'Resistance')!.id

  power = newId()
  await run({ type: 'attribute.create', id: power, inventoryId, name: 'Power', kind: 'number', options: [], unit: 'W', siPrefixes: true })
  const item = async (name: string, watts: string): Promise<Id> => {
    const id = newId()
    await run({ type: 'item.create', id, inventoryId, folderId: resistorsFolder, name, description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null })
    await run({ type: 'item.setAttribute', itemId: id, attributeId: power, value: watts })
    await run({ type: 'item.addAxis', itemId: id, attributeId: resistance, firstVariantId: newId() })
    return id
  }
  resistor = await item('Resistor 0.25 W', '0.25')
  await run({
    type: 'variant.createMany',
    itemId: resistor,
    variants: [
      { id: v.r4k7, values: [{ attributeId: resistance, value: '4700' }], initialReceipt: { movementId: newId(), quantity: '40' } },
      { id: v.r10k, values: [{ attributeId: resistance, value: '10000' }] },
      { id: v.r43k, values: [{ attributeId: resistance, value: '43000' }], initialReceipt: { movementId: newId(), quantity: '5' } },
      { id: v.r51k, values: [{ attributeId: resistance, value: '51000' }], initialReceipt: { movementId: newId(), quantity: '20' } },
    ],
  })
  resistor06 = await item('Resistor 0.6 W', '0.6')
  await run({ type: 'variant.createMany', itemId: resistor06, variants: [{ id: newId(), values: [{ attributeId: resistance, value: '4700' }] }] })
  snap = await storage.loadInventory(inventoryId)
})

const ids = () => ({ movementId: newId(), variantId: newId(), photoId: newId() })
const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  id: newId(),
  itemId: resistor,
  axisValues: [],
  quantity: '10',
  totalPrice: null,
  sourceUrl: null,
  photo: null,
  ids: ids(),
  ...over,
})
const newItem = (over: Partial<DraftNewItem> = {}): DraftNewItem => ({
  id: newId(),
  name: 'Fuse holder 5x20',
  folderId: null,
  unitKey: 'pcs',
  attributes: [],
  ...over,
})

describe('lineMatches', () => {
  it('puts the exact variant first, the same item for another value, then similar items', () => {
    const m = lineMatches('resistor 0.25w 4k7', snap, emptyIntakeDraft())
    expect(m.exact[0]).toMatchObject({ itemId: resistor, variantId: v.r4k7 })
    expect(m.otherValue.map((r) => r.itemId)).toEqual([resistor])
    expect(m.otherValue[0]!.variantId).toBeNull()
    expect(m.similar.map((r) => r.itemId)).toContain(resistor06)
    expect(m.similar.map((r) => r.itemId)).not.toContain(resistor)
  })

  it('offers the same item for a value it does not have yet', () => {
    const m = lineMatches('resistor 0.25w 47k', snap, emptyIntakeDraft())
    expect(m.exact).toEqual([])
    expect(m.otherValue.map((r) => r.itemId)).toEqual([resistor])
  })

  it('finds a new item of the draft by its name', () => {
    const fuse = newItem()
    const draft: IntakeDraftContent = { newItems: [fuse], lines: [line({ itemId: fuse.id })] }
    expect(lineMatches('fuse holder', snap, draft).inDraft).toEqual([{ newItemId: fuse.id, name: 'Fuse holder 5x20' }])
    expect(lineMatches('capacitor', snap, draft).inDraft).toEqual([])
  })

  it('finds nothing for an empty query', () => {
    expect(lineMatches('  ', snap, emptyIntakeDraft())).toEqual({ exact: [], otherValue: [], similar: [], inDraft: [] })
  })
})

describe('valuesFromQuery', () => {
  it('reads the axis values out of the typed text', () => {
    expect(valuesFromQuery(snap, resistor, 'resistor 0.25w 47k')).toEqual([{ attributeId: resistance, value: '47000' }])
    expect(valuesFromQuery(snap, resistor, 'resistor')).toEqual([])
  })
})

describe('valueHint', () => {
  it('an existing variant: adding to it, with what is there', () => {
    expect(valueHint(snap, emptyIntakeDraft(), resistor, [{ attributeId: resistance, value: '4k7' }])).toEqual({
      kind: 'existing',
      variantId: v.r4k7,
      have: '40',
    })
  })

  it('47 kΩ: existing once the item has it, new with the nearest values before', async () => {
    const hint = valueHint(snap, emptyIntakeDraft(), resistor, [{ attributeId: resistance, value: '47k' }])
    expect(hint?.kind).toBe('new')
    if (hint?.kind !== 'new') return
    expect(hint.nearest.below).toMatchObject({ variantId: v.r43k, value: '43000', quantity: '5' })
    expect(hint.nearest.above).toMatchObject({ variantId: v.r51k, value: '51000', quantity: '20' })

    const r47k = newId()
    await run({ type: 'variant.createMany', itemId: resistor, variants: [{ id: r47k, values: [{ attributeId: resistance, value: '47000' }] }] })
    const after = await storage.loadInventory(inventoryId)
    expect(valueHint(after, emptyIntakeDraft(), resistor, [{ attributeId: resistance, value: '47k' }])).toEqual({
      kind: 'existing',
      variantId: r47k,
      have: '0',
    })
  })

  it('an archived variant with the value', async () => {
    const r1M = newId()
    await run({ type: 'variant.createMany', itemId: resistor, variants: [{ id: r1M, values: [{ attributeId: resistance, value: '1000000' }] }] })
    await run({ type: 'archive', target: 'variant', id: r1M, archiveId: newId() })
    const after = await storage.loadInventory(inventoryId)
    expect(valueHint(after, emptyIntakeDraft(), resistor, [{ attributeId: resistance, value: '1M' }])).toEqual({ kind: 'archived', variantId: r1M })
  })

  it('null while a value is missing or does not fit', () => {
    expect(valueHint(snap, emptyIntakeDraft(), resistor, [])).toBeNull()
    expect(valueHint(snap, emptyIntakeDraft(), resistor, [{ attributeId: resistance, value: 'abc' }])).toBeNull()
  })
})

describe('duplicateWarning', () => {
  it('finds the item a new one looks like, values written differently', () => {
    const row = duplicateWarning(snap, newItem({ name: 'Resistor 0.25W 4k7' }), 'Resistor 0.25W 4k7')
    expect(row).toMatchObject({ itemId: resistor, variantId: v.r4k7 })
  })

  it('finds the variant by the new item’s own values', () => {
    const n = newItem({
      name: 'Resistor',
      attributes: [
        { attributeId: power, value: '0.25', axis: false },
        { attributeId: resistance, value: null, axis: true },
      ],
    })
    expect(duplicateWarning(snap, n, 'Resistor 4.7k')).toMatchObject({ itemId: resistor, variantId: v.r4k7 })
  })

  it('reads a decimal comma as a point', () => {
    const ru = snap.items.find((i) => i.name === 'Резистор 0,25 Вт')!
    const r10k = snap.variantAttributeValues.find((x) => x.value === '10000' && snap.variants.some((v) => v.id === x.variantId && v.itemId === ru.id))!
    expect(duplicateWarning(snap, newItem({ name: 'Резистор 0,25 Вт 10k' }), 'Резистор 0,25 Вт 10k')).toMatchObject({ itemId: ru.id, variantId: r10k.variantId })
  })

  it('nothing for a thing the inventory does not have', () => {
    expect(duplicateWarning(snap, newItem({ name: 'Fuse holder 5x20' }), 'Fuse holder 5x20')).toBeNull()
  })
})

describe('alreadyInDraft', () => {
  it('a second line with the same item and values', () => {
    const first = line({ axisValues: [{ attributeId: resistance, value: '4700' }] })
    const draft: IntakeDraftContent = { newItems: [], lines: [first] }
    expect(alreadyInDraft(draft, resistor, [{ attributeId: resistance, value: '4700' }])).toBe(true)
    expect(alreadyInDraft(draft, resistor, [{ attributeId: resistance, value: '4700' }], first.id)).toBe(false)
    expect(alreadyInDraft(draft, resistor, [{ attributeId: resistance, value: '47000' }])).toBe(false)
    expect(alreadyInDraft(draft, resistor06, [{ attributeId: resistance, value: '4700' }])).toBe(false)
  })
})

describe('suggestedFolder', () => {
  it('the folder of the nearest similar item', () => {
    const m = lineMatches('resistor 0.25w 4k7', snap, emptyIntakeDraft())
    expect(suggestedFolder(snap, m)).toEqual({ folderId: resistorsFolder, nextTo: 'Resistor 0.25 W' })
    expect(suggestedFolder(snap, { exact: [], otherValue: [], similar: [], inDraft: [] })).toBeNull()
  })
})

describe('nextLineDefaults', () => {
  it('keeps the folder, the unit and the shop of the link', () => {
    const n = newItem({ folderId: resistorsFolder, unitKey: 'm' })
    const prev = line({ itemId: n.id, sourceUrl: 'https://lcsc.com/product-detail/C25819.html' })
    expect(nextLineDefaults(prev, { newItems: [n], lines: [prev] })).toEqual({
      folderId: resistorsFolder,
      unitKey: 'm',
      urlPrefix: 'https://lcsc.com',
    })
  })

  it('an existing item: its folder and unit from the copy; no link, no prefix', () => {
    const prev = line({ itemId: resistor })
    expect(nextLineDefaults(prev, { newItems: [], lines: [prev] }, snap)).toEqual({ folderId: resistorsFolder, unitKey: 'pcs', urlPrefix: null })
    expect(nextLineDefaults(line({ sourceUrl: 'not a link' }), emptyIntakeDraft())).toMatchObject({ urlPrefix: null })
  })
})

describe('attributesFrom', () => {
  it('copies the similar item’s attributes and axes, values empty', () => {
    expect(attributesFrom(snap, resistor)).toEqual([
      { attributeId: power, value: null, axis: false },
      { attributeId: resistance, value: null, axis: true },
    ])
  })
})

describe('buildDraftLine', () => {
  const form = (over: Partial<LineForm> = {}): LineForm => ({
    lineId: newId(),
    ids: ids(),
    itemId: resistor,
    newItem: null,
    axisValues: [{ attributeId: resistance, value: '47k' }],
    amount: '5x10',
    price: '0.35',
    url: 'https://lcsc.com/product-detail/C25819.html',
    urlPrefix: null,
    photo: null,
    ...over,
  })

  it('an existing item: canonical values, quantity and price in minor units', () => {
    const built = buildDraftLine(form(), snap, emptyIntakeDraft())
    expect(built).toMatchObject({
      line: { itemId: resistor, axisValues: [{ attributeId: resistance, value: '47000' }], quantity: '50', totalPrice: 35, sourceUrl: 'https://lcsc.com/product-detail/C25819.html' },
      newItem: null,
    })
  })

  it('what to fix: the amount, a value, the price, the name', () => {
    expect(buildDraftLine(form({ amount: '' }), snap, emptyIntakeDraft())).toEqual({ errorKey: 'intakes.line.needsAmount' })
    expect(buildDraftLine(form({ amount: '0' }), snap, emptyIntakeDraft())).toEqual({ errorKey: 'intakes.line.needsAmount' })
    expect(buildDraftLine(form({ axisValues: [] }), snap, emptyIntakeDraft())).toEqual({ errorKey: 'intakes.line.needsValue', params: { name: 'Resistance' } })
    expect(buildDraftLine(form({ axisValues: [{ attributeId: resistance, value: 'x' }] }), snap, emptyIntakeDraft())).toMatchObject({ errorKey: 'intakes.line.invalidValue' })
    expect(buildDraftLine(form({ price: 'abc' }), snap, emptyIntakeDraft())).toEqual({ errorKey: 'quickAdd.invalidPrice' })
    const n = newItem({ name: '  ' })
    expect(buildDraftLine(form({ itemId: n.id, newItem: n, axisValues: [] }), snap, emptyIntakeDraft())).toEqual({ errorKey: 'errors.domain.name_required' })
  })

  it('refuses what the commit would refuse: a link that is not http(s), a new item name that is too long', () => {
    expect(buildDraftLine(form({ url: 'lcsc.com/x' }), snap, emptyIntakeDraft())).toEqual({ errorKey: 'errors.domain.invalid_url' })
    expect(buildDraftLine(form({ url: ' https://lcsc.com/x ' }), snap, emptyIntakeDraft())).toMatchObject({ line: { sourceUrl: 'https://lcsc.com/x' } })
    const long = newItem({ name: 'x'.repeat(201), unitKey: 'pcs', attributes: [] })
    expect(buildDraftLine(form({ itemId: long.id, newItem: long, axisValues: [] }), snap, emptyIntakeDraft())).toEqual({ errorKey: 'errors.domain.name_too_long' })
    const fits = newItem({ name: 'x'.repeat(200), unitKey: 'pcs', attributes: [] })
    expect(buildDraftLine(form({ itemId: fits.id, newItem: fits, axisValues: [] }), snap, emptyIntakeDraft())).toHaveProperty('line')
    // A line written elsewhere (MCP) with such a link is marked with its own copy.
    expect(en.intakes.problem.invalid_link).toMatch(/https:\/\//)
  })

  it('a new item keeps its shared values, its axes go on the line; the link prefix alone is no link', () => {
    const n = newItem({
      name: ' Resistor 1 W ',
      unitKey: 'pcs',
      attributes: [
        { attributeId: power, value: '1', axis: false },
        { attributeId: resistance, value: null, axis: true },
      ],
    })
    const built = buildDraftLine(form({ itemId: n.id, newItem: n, axisValues: [{ attributeId: resistance, value: '4k7' }], url: 'https://lcsc.com/', urlPrefix: 'https://lcsc.com' }), snap, emptyIntakeDraft())
    if ('errorKey' in built) throw new Error(built.errorKey)
    expect(built.newItem).toMatchObject({ name: 'Resistor 1 W', attributes: [{ value: '1' }, { value: null, axis: true }] })
    expect(built.line).toMatchObject({ itemId: n.id, axisValues: [{ attributeId: resistance, value: '4700' }], sourceUrl: null })
  })
})

describe('buildDraftLine: shared values and photos', () => {
  const form = (over: Partial<LineForm> = {}): LineForm => ({
    lineId: newId(),
    ids: ids(),
    itemId: resistor,
    newItem: null,
    axisValues: [{ attributeId: resistance, value: '4k7' }],
    amount: '10',
    price: '',
    url: '',
    urlPrefix: null,
    photo: null,
    ...over,
  })
  const photo = (replace: boolean) => ({ provider: 'uploadcare', fileId: 'f1', url: 'https://ucarecdn.com/f1/', replace })

  it('a shared value of a new item that does not fit is refused', () => {
    const n = newItem({ name: 'Resistor 2 W', attributes: [{ attributeId: power, value: 'lots', axis: false }] })
    expect(buildDraftLine(form({ itemId: n.id, newItem: n, axisValues: [] }), snap, emptyIntakeDraft())).toEqual({
      errorKey: 'intakes.line.invalidValue',
      params: { name: 'Power' },
    })
  })

  it('replaces a photo only when asked and only when the variant the line goes to has one', async () => {
    await run({ type: 'photo.add', id: newId(), itemId: resistor, variantId: v.r4k7, provider: 'uploadcare', fileId: 'old', url: 'https://ucarecdn.com/old/' })
    const withPhoto = await storage.loadInventory(inventoryId)
    const replaceOf = (f: LineForm, s: InventorySnapshot): boolean | undefined => {
      const built = buildDraftLine(f, s, emptyIntakeDraft())
      return 'line' in built ? built.line.photo?.replace : undefined
    }
    // Asked, and 4.7 kΩ has a photo: replaced.
    expect(replaceOf(form({ photo: photo(true) }), withPhoto)).toBe(true)
    // Not asked: kept.
    expect(replaceOf(form({ photo: photo(false) }), withPhoto)).toBe(false)
    // Asked while on 4.7 kΩ, then the value changed to one without a photo: nothing to replace.
    expect(replaceOf(form({ photo: photo(true), axisValues: [{ attributeId: resistance, value: '10k' }] }), withPhoto)).toBe(false)
    // A new value: no photo yet.
    expect(replaceOf(form({ photo: photo(true), axisValues: [{ attributeId: resistance, value: '33k' }] }), withPhoto)).toBe(false)
  })
})

describe('withLine, withoutLine, restoreLine', () => {
  it('puts a line in place, drops new items left without lines, and Undo brings both back', () => {
    const fuse = newItem()
    const first = line({ itemId: fuse.id })
    const second = line()
    let draft = withLine(withLine(emptyIntakeDraft(), first, fuse), second, null)
    expect(draft.lines.map((l) => l.id)).toEqual([first.id, second.id])
    draft = withLine(draft, { ...first, quantity: '3' }, { ...fuse, name: 'Fuse' })
    expect(draft.lines[0]).toMatchObject({ id: first.id, quantity: '3' })
    expect(draft.newItems).toEqual([{ ...fuse, name: 'Fuse' }])

    const { content, removed } = withoutLine(draft, first.id)
    expect(content).toEqual({ newItems: [], lines: [second] })
    expect(removed).toMatchObject({ index: 0, newItem: { id: fuse.id } })
    expect(restoreLine(content, removed!)).toEqual(draft)
    // A line moved off its new item takes the item away.
    expect(withLine(draft, { ...first, itemId: resistor }, null).newItems).toEqual([])
  })
})

describe('priceText', () => {
  it('minor units in integers', () => {
    expect(priceText(1234, 'USD')).toBe('12.34')
    expect(priceText(5, 'USD')).toBe('0.05')
    expect(priceText(50, 'JPY')).toBe('50')
  })
})

import { customUnitKey, emptyIntakeDraft, type DraftNewItem, type IntakeDraftContent } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { attribute, folder, item, makeSnapshot, ARCHIVED } from '../../core/test/fixtures'
import {
  buildDraftLine,
  nameClash,
  withAddedOption,
  withItemAttribute,
  withItemTag,
  withItemUnit,
  withLine,
  withNewFolder,
  withNewItem,
  withoutLine,
  withoutNewItem,
  restoreNewItem,
  type DraftError,
  type LineForm,
} from '../src'

const s = makeSnapshot({
  folders: [folder('PASS', 'Passives'), folder('OLD', 'Old', null, ARCHIVED)],
  items: [item('R', 'Resistor', 'PASS'), item('OLDR', 'Gone', 'PASS', ARCHIVED), item('P', 'Part', 'PASS')],
  attributes: [attribute('pkg', 'Package', 'enum', { options: ['0805', '0603'] }), attribute('mark', 'Marking', 'text')],
  tags: [{ id: 'T1', inventoryId: 'inv', name: 'SMD', color: null, createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }],
  units: [{ id: 'U1', inventoryId: 'inv', name: 'Metre', symbol: 'mt', prefixPowers: [], createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }],
})
const failed = (x: unknown): x is DraftError => typeof x === 'object' && x !== null && 'errorKey' in x
const ok = (x: IntakeDraftContent | DraftError): IntakeDraftContent => {
  if (failed(x)) throw new Error(x.errorKey)
  return x
}
const nItem = (over: Partial<DraftNewItem> = {}): DraftNewItem => ({ id: 'N1', name: 'Inductor', folderId: null, unitKey: 'pcs', attributes: [], ...over })
const withItem = () => withNewItem(emptyIntakeDraft(), nItem())

describe('nameClash', () => {
  it('items: a living twin, an archived one, other folder is free, draft items too', () => {
    const d = withItem()
    expect(nameClash(s, d, { kind: 'item', name: ' resistor', folderId: 'PASS' })).toEqual({ id: 'R', draft: false })
    expect(nameClash(s, d, { kind: 'item', name: 'GONE', folderId: 'PASS' })).toEqual({ id: 'OLDR', draft: false, archived: true })
    expect(nameClash(s, d, { kind: 'item', name: 'Resistor', folderId: null })).toBeNull()
    expect(nameClash(s, d, { kind: 'item', name: 'inductor', folderId: null })).toEqual({ id: 'N1', draft: true })
    expect(nameClash(s, d, { kind: 'item', name: 'Inductor', folderId: null }, 'N1')).toBeNull()
  })

  it('folders: an archived twin now clashes', () => {
    expect(nameClash(s, emptyIntakeDraft(), { kind: 'folder', name: 'old', parentId: null })).toEqual({ id: 'OLD', draft: false, archived: true })
    expect(nameClash(s, emptyIntakeDraft(), { kind: 'folder', name: 'Passives', parentId: null })).toEqual({ id: 'PASS', draft: false })
  })

  it('units: name without case, symbol with case, built-in included, draft units too', () => {
    const d: IntakeDraftContent = { ...emptyIntakeDraft(), newUnits: [{ id: 'DU', name: 'Bunch', symbol: 'bn', prefixPowers: [] }] }
    expect(nameClash(s, d, { kind: 'unit', name: 'Meters', symbol: 'q' })).toMatchObject({ id: 'm', draft: false })
    expect(nameClash(s, d, { kind: 'unit', name: 'x', symbol: 'm' })).toMatchObject({ id: 'm', draft: false })
    expect(nameClash(s, d, { kind: 'unit', name: 'x', symbol: 'M' })).toBeNull()
    expect(nameClash(s, d, { kind: 'unit', name: 'metre', symbol: 'q' })).toMatchObject({ id: customUnitKey('U1') })
    expect(nameClash(s, d, { kind: 'unit', name: 'bunch', symbol: 'q' })).toEqual({ id: 'DU', draft: true })
    expect(nameClash(s, d, { kind: 'unit', name: 'x', symbol: 'BN' })).toBeNull()
    expect(nameClash(s, d, { kind: 'unit', name: 'x', symbol: 'bn' })).toEqual({ id: 'DU', draft: true })
    expect(nameClash(s, d, { kind: 'unit', name: 'Bunch', symbol: 'bn' }, 'DU')).toBeNull()
  })
})

describe('withNewFolder and the archived twin', () => {
  it('refuses a name an archived folder has, with its own key', () => {
    expect(withNewFolder(emptyIntakeDraft(), s, { id: 'F', name: 'Old', parentId: null })).toEqual({
      errorKey: 'intakes.folder.duplicateArchived',
      params: { name: 'Old', id: 'OLD' },
    })
  })
})

describe('withItemAttribute', () => {
  const def = { id: 'A1', name: 'Tolerance', kind: 'enum' as const, unit: '', siPrefixes: false, options: ['1%', '5%'], pinned: true }

  it('declares a new attribute under the item (shared by default) and keeps it', () => {
    const d = ok(withItemAttribute(withItem(), s, 'N1', def))
    expect(d.newAttributes).toEqual([{ ...def }])
    expect(d.newItems[0]!.attributes).toEqual([{ attributeId: 'A1', value: null, axis: false }])
  })

  it('puts it on an axis or with a value, and in its place when there already', () => {
    let d = ok(withItemAttribute(withItem(), s, 'N1', def, { axis: true }))
    expect(d.newItems[0]!.attributes).toEqual([{ attributeId: 'A1', value: null, axis: true }])
    d = ok(withItemAttribute(d, s, 'N1', { ...def, name: 'Tol' }, { axis: false, value: '5%' }))
    expect(d.newItems[0]!.attributes).toEqual([{ attributeId: 'A1', value: '5%', axis: false }])
    expect(d.newAttributes).toEqual([{ ...def, name: 'Tol' }])
  })

  it('uses an existing attribute by id', () => {
    const d = ok(withItemAttribute(withItem(), s, 'N1', 'pkg', { axis: true }))
    expect(d.newItems[0]!.attributes).toEqual([{ attributeId: 'pkg', value: null, axis: true }])
    expect(d.newAttributes ?? []).toEqual([])
  })

  it('refuses an explicit duplicate with the existing id, an unknown id, an item that is not new', () => {
    expect(withItemAttribute(withItem(), s, 'N1', { ...def, id: 'A2', name: ' package' })).toEqual({
      errorKey: 'intakes.attribute.duplicate',
      params: { name: 'package', id: 'pkg' },
    })
    expect(withItemAttribute(withItem(), s, 'N1', 'nope')).toEqual({ errorKey: 'intakes.attribute.unknown' })
    expect(withItemAttribute(withItem(), s, 'R', 'pkg')).toEqual({ errorKey: 'intakes.item.notInDraft' })
    expect(withItemAttribute(withItem(), s, 'N1', { ...def, name: ' ' })).toEqual({ errorKey: 'errors.domain.name_required' })
  })

  it('prunes the others: a draft attribute left with no item goes', () => {
    let d = ok(withItemAttribute(withItem(), s, 'N1', def))
    d = withNewItem(d, nItem({ attributes: [] }))
    expect(d.newAttributes).toEqual([])
  })
})

describe('withItemTag', () => {
  it('declares a new tag with a colour, or reuses one by name or id', () => {
    let d = ok(withItemTag(withItem(), s, 'N1', 'Precision', '#aabbcc'))
    expect(d.newTags).toHaveLength(1)
    expect(d.newTags![0]).toMatchObject({ name: 'Precision', color: '#aabbcc' })
    expect(d.newItems[0]!.tagIds).toEqual([d.newTags![0]!.id])
    d = ok(withItemTag(d, s, 'N1', ' precision '))
    expect(d.newTags).toHaveLength(1)
    expect(d.newItems[0]!.tagIds).toHaveLength(1)
    d = ok(withItemTag(d, s, 'N1', 'smd'))
    expect(d.newItems[0]!.tagIds).toEqual([d.newTags![0]!.id, 'T1'])
    d = ok(withItemTag(withItem(), s, 'N1', 'T1'))
    expect(d.newItems[0]!.tagIds).toEqual(['T1'])
    expect(d.newTags ?? []).toEqual([])
  })

  it('refuses a bad name or colour and an item that is not new', () => {
    expect(withItemTag(withItem(), s, 'N1', ' ')).toEqual({ errorKey: 'errors.domain.name_required' })
    expect(withItemTag(withItem(), s, 'N1', 'X', 'red')).toEqual({ errorKey: 'intakes.tag.invalidColor' })
    expect(withItemTag(withItem(), s, 'R', 'X')).toEqual({ errorKey: 'intakes.item.notInDraft' })
  })
})

describe('withItemUnit', () => {
  const def = { id: 'DU', name: 'Bunch', symbol: 'bn', prefixPowers: [] as number[] }

  it('declares a unit and sets it on the item', () => {
    const d = ok(withItemUnit(withItem(), s, 'N1', def))
    expect(d.newUnits).toEqual([def])
    expect(d.newItems[0]!.unitKey).toBe(customUnitKey('DU'))
  })

  it('uses a unit by key (built-in, existing custom, draft)', () => {
    expect(ok(withItemUnit(withItem(), s, 'N1', 'm')).newItems[0]!.unitKey).toBe('m')
    expect(ok(withItemUnit(withItem(), s, 'N1', customUnitKey('U1'))).newItems[0]!.unitKey).toBe(customUnitKey('U1'))
    expect(withItemUnit(withItem(), s, 'N1', 'nope')).toEqual({ errorKey: 'intakes.unit.unknown' })
  })

  it('Review Focus 2: name and symbol clashes (symbol case-sensitive), with the existing key', () => {
    expect(withItemUnit(withItem(), s, 'N1', { ...def, name: 'Meters' })).toEqual({
      errorKey: 'intakes.unit.duplicate',
      params: { name: 'Meters', id: 'm' },
    })
    expect(withItemUnit(withItem(), s, 'N1', { ...def, symbol: 'm' })).toMatchObject({ errorKey: 'intakes.unit.duplicate', params: { id: 'm' } })
    expect(failed(withItemUnit(withItem(), s, 'N1', { ...def, symbol: 'M' }))).toBe(false)
    const d = ok(withItemUnit(withItem(), s, 'N1', def))
    expect(withItemUnit(d, s, 'N1', { ...def, id: 'DU2' })).toMatchObject({ errorKey: 'intakes.unit.duplicate', params: { id: 'DU' } })
    expect(failed(withItemUnit(d, s, 'N1', { ...def, name: 'Bunches' }))).toBe(false)
  })

  it('refuses an empty name or symbol, and an item that is not new', () => {
    expect(withItemUnit(withItem(), s, 'N1', { ...def, name: ' ' })).toEqual({ errorKey: 'errors.domain.name_required' })
    expect(withItemUnit(withItem(), s, 'N1', { ...def, symbol: ' ' })).toEqual({ errorKey: 'intakes.unit.invalid' })
    expect(withItemUnit(withItem(), s, 'R', def)).toEqual({ errorKey: 'intakes.item.notInDraft' })
  })

  it('a unit nothing uses any more is pruned when the item changes it back', () => {
    let d = ok(withItemUnit(withItem(), s, 'N1', def))
    d = withNewItem(d, { ...d.newItems[0]!, unitKey: 'pcs' })
    expect(d.newUnits).toEqual([])
  })
})

describe('withAddedOption', () => {
  it('adds a value to an existing list, at the end, once; the rest is pruned', () => {
    let d = ok(withAddedOption(emptyIntakeDraft(), s, 'pkg', ' 1206 '))
    expect(d.addedOptions).toEqual([{ attributeId: 'pkg', values: ['1206'] }])
    d = ok(withAddedOption(d, s, 'pkg', '1206'))
    d = ok(withAddedOption(d, s, 'pkg', '1210'))
    expect(d.addedOptions).toEqual([{ attributeId: 'pkg', values: ['1206', '1210'] }])
  })

  it('refuses a value the list has (no case), an empty one, a missing or non-list attribute', () => {
    expect(withAddedOption(emptyIntakeDraft(), s, 'pkg', '0805')).toEqual({ errorKey: 'intakes.option.exists', params: { value: '0805' } })
    expect(withAddedOption(emptyIntakeDraft(), s, 'pkg', ' ')).toEqual({ errorKey: 'errors.domain.name_required' })
    expect(withAddedOption(emptyIntakeDraft(), s, 'mark', 'x')).toEqual({ errorKey: 'intakes.option.notList' })
    expect(withAddedOption(emptyIntakeDraft(), s, 'nope', 'x')).toEqual({ errorKey: 'intakes.attribute.unknown' })
  })

  it('is kept while a line uses it and pruned when the last line goes', () => {
    const d0 = ok(withAddedOption(emptyIntakeDraft(), s, 'pkg', '1206'))
    const f: LineForm = {
      lineId: 'LF', ids: { movementId: 'm', variantId: 'v', photoId: 'p' }, itemId: 'P', newItem: null,
      axisValues: [], amount: '5', price: '', url: '', urlPrefix: null, photo: null, newTags: [],
    }
    const withAxis = makeSnapshot({
      ...s,
      itemAttributes: [{ itemId: 'P', attributeId: 'pkg', value: null, axisPosition: 0 }],
    })
    const built = buildDraftLine({ ...f, axisValues: [{ attributeId: 'pkg', value: '1206' }] }, withAxis, d0)
    if ('errorKey' in built) throw new Error(built.errorKey)
    // Without the draft's value the same form does not pass.
    expect(buildDraftLine({ ...f, axisValues: [{ attributeId: 'pkg', value: '1206' }] }, withAxis, emptyIntakeDraft())).toMatchObject({ errorKey: 'intakes.line.invalidValue' })
    const d1 = withLine(d0, built.line, built.newItem)
    expect(d1.addedOptions).toEqual([{ attributeId: 'pkg', values: ['1206'] }])
    const d2 = withoutLine(d1, 'LF')
    expect(d2.content.addedOptions).toEqual([])
    expect(d2.removed?.addedOptions).toEqual([{ attributeId: 'pkg', values: ['1206'] }])
  })
})

describe('buildDraftLine', () => {
  const f: LineForm = {
    lineId: 'LF', ids: { movementId: 'm', variantId: 'v', photoId: 'p' }, itemId: 'N1', newItem: null,
    axisValues: [], amount: '3', price: '', url: '', urlPrefix: null, photo: null, newTags: [],
  }

  it('carries variantDescription on the line, trimmed, empty as null', () => {
    const d = withItem()
    const a = buildDraftLine({ ...f, newItem: d.newItems[0]!, variantDescription: ' tight ' }, s, d)
    if ('errorKey' in a) throw new Error(a.errorKey)
    expect(a.line.variantDescription).toBe('tight')
    const b = buildDraftLine({ ...f, newItem: d.newItems[0]!, variantDescription: '  ' }, s, d)
    if ('errorKey' in b) throw new Error(b.errorKey)
    expect(b.line.variantDescription).toBeNull()
  })

  it('parses an amount in a draft unit', () => {
    const d = ok(withItemUnit(withItem(), s, 'N1', { id: 'DU', name: 'Bunch', symbol: 'bn', prefixPowers: [] }))
    const built = buildDraftLine({ ...f, newItem: d.newItems[0]!, amount: '2' }, s, d)
    if ('errorKey' in built) throw new Error(built.errorKey)
    expect(built.line.quantity).toBe('2')
  })
})

describe('Undo with the new parts', () => {
  it('removing an item with a unit, attribute and tag puts all of them back', () => {
    let d = ok(withItemUnit(withItem(), s, 'N1', { id: 'DU', name: 'Bunch', symbol: 'bn', prefixPowers: [] }))
    d = ok(withItemAttribute(d, s, 'N1', { id: 'A1', name: 'Tolerance', kind: 'text', unit: '', siPrefixes: false, options: [] }))
    const before = d
    const { content, removed } = withoutNewItem(d, 'N1')
    expect(content.newUnits).toEqual([])
    expect(content.newAttributes).toEqual([])
    expect(restoreNewItem(content, removed!)).toEqual(before)
  })
})

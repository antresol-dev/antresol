import {
  emptyIntakeDraft,
  resolveIntake,
  type DraftLine,
  type DraftNewAttribute,
  type DraftNewItem,
  type IntakeDraftContent,
} from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { attribute, axis, folder, item, makeSnapshot, variant, value, ARCHIVED } from '../../core/test/fixtures'
import {
  buildDraftLine,
  creatingLineOf,
  nameClash,
  restoreNewItem,
  useExisting,
  withNewAttribute,
  withNewFolder,
  withNewItem,
  withLine,
  withoutLine,
  restoreLine,
  withoutNewAttribute,
  withoutNewFolder,
  withoutNewItem,
  type DraftError,
  type LineForm,
} from '../src'

const s = makeSnapshot({
  folders: [folder('PASS', 'Passives'), folder('OLD', 'Old', null, ARCHIVED)],
  items: [item('R', 'Resistor', 'PASS'), item('M', 'Module')],
  attributes: [attribute('res', 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }), attribute('ind', 'Inductance', 'number', { unit: 'H', siPrefixes: true })],
  itemAttributes: [axis('R', 'res', 0)],
  variants: [variant('r4k7', 'R')],
  variantAttributeValues: [value('r4k7', 'res', '4700')],
})

const failed = (x: unknown): x is DraftError => typeof x === 'object' && x !== null && 'errorKey' in x
const ok = (x: IntakeDraftContent | DraftError): IntakeDraftContent => {
  if (failed(x)) throw new Error(x.errorKey)
  return x
}

let seq = 0
const line = (itemId: string, axisValues: Record<string, string> = {}, over: Partial<DraftLine> = {}): DraftLine => {
  const n = ++seq
  return {
    id: `line${n}`,
    itemId,
    axisValues: Object.entries(axisValues).map(([attributeId, v]) => ({ attributeId, value: v })),
    quantity: '10',
    totalPrice: null,
    sourceUrl: null,
    photo: null,
    ids: { movementId: `mov${n}`, variantId: `var${n}`, photoId: `pho${n}` },
    ...over,
  }
}
const nItem = (over: Partial<DraftNewItem> = {}): DraftNewItem => ({ id: 'N1', name: 'Inductor 0805', folderId: null, unitKey: 'pcs', attributes: [], ...over })
const form = (over: Partial<LineForm> = {}): LineForm => ({
  lineId: 'LF',
  ids: { movementId: 'm', variantId: 'v', photoId: 'p' },
  itemId: 'R',
  newItem: null,
  axisValues: [],
  amount: '5',
  price: '',
  url: '',
  urlPrefix: null,
  photo: null,
  newTags: [],
  ...over,
})
const photo = { provider: 'uploadcare', fileId: 'f1', url: 'https://ucarecdn.com/f1/' }
const base = emptyIntakeDraft()

describe('draft folders', () => {
  it('puts a folder in, in its place when it is there already, parents existing or draft', () => {
    let d = ok(withNewFolder(base, s, { id: 'F1', name: ' Coils ', parentId: 'PASS' }))
    d = ok(withNewFolder(d, s, { id: 'F2', name: 'Inductors', parentId: 'F1' }))
    d = ok(withNewFolder(d, s, { id: 'F1', name: 'Coils', parentId: null }))
    expect(d.newFolders).toEqual([
      { id: 'F1', name: 'Coils', parentId: null },
      { id: 'F2', name: 'Inductors', parentId: 'F1' },
    ])
  })

  it('refuses a name that is empty or a parent that is gone', () => {
    expect(withNewFolder(base, s, { id: 'F1', name: ' ', parentId: null })).toEqual({ errorKey: 'errors.domain.name_required' })
    expect(withNewFolder(base, s, { id: 'F1', name: 'X', parentId: 'OLD' })).toEqual({ errorKey: 'intakes.folder.parentGone' })
    expect(withNewFolder(base, s, { id: 'F1', name: 'X', parentId: 'nope' })).toEqual({ errorKey: 'intakes.folder.parentGone' })
  })

  it('Review Focus 1: a folder cannot move into itself or its descendant', () => {
    let d = ok(withNewFolder(base, s, { id: 'A', name: 'A', parentId: null }))
    d = ok(withNewFolder(d, s, { id: 'B', name: 'B', parentId: 'A' }))
    d = ok(withNewFolder(d, s, { id: 'C', name: 'C', parentId: 'B' }))
    expect(withNewFolder(d, s, { id: 'A', name: 'A', parentId: 'C' })).toEqual({ errorKey: 'intakes.folder.cycle' })
    expect(withNewFolder(d, s, { id: 'A', name: 'A', parentId: 'A' })).toEqual({ errorKey: 'intakes.folder.cycle' })
    expect(failed(withNewFolder(d, s, { id: 'C', name: 'C', parentId: 'A' }))).toBe(false)
  })

  it('refuses a name the parent has already, existing or draft, and says which', () => {
    expect(withNewFolder(base, s, { id: 'F1', name: 'passives', parentId: null })).toEqual({
      errorKey: 'intakes.folder.duplicate',
      params: { name: 'passives', id: 'PASS' },
    })
    const d = ok(withNewFolder(base, s, { id: 'F1', name: 'Coils', parentId: null }))
    expect(withNewFolder(d, s, { id: 'F2', name: 'COILS', parentId: null })).toMatchObject({ errorKey: 'intakes.folder.duplicate', params: { id: 'F1' } })
    // Same name under another parent, or the archived namesake, is fine.
    expect(failed(withNewFolder(d, s, { id: 'F2', name: 'Coils', parentId: 'PASS' }))).toBe(false)
    expect(failed(withNewFolder(base, s, { id: 'F3', name: 'Old', parentId: null }))).toBe(false)
  })

  it('Review Focus 1: a folder with a draft folder or a new item in it cannot be removed', () => {
    let d = ok(withNewFolder(base, s, { id: 'A', name: 'A', parentId: null }))
    d = ok(withNewFolder(d, s, { id: 'B', name: 'B', parentId: 'A' }))
    expect(withoutNewFolder(d, 'A')).toEqual({ errorKey: 'intakes.folder.notEmpty' })
    d = withNewItem(d, nItem({ folderId: 'B' }))
    expect(withoutNewFolder(d, 'B')).toEqual({ errorKey: 'intakes.folder.notEmpty' })
    d = withNewItem(d, nItem({ folderId: null }))
    expect(ok(withoutNewFolder(d, 'B')).newFolders?.map((f) => f.id)).toEqual(['A'])
  })
})

describe('draft attributes', () => {
  const att = (over: Partial<DraftNewAttribute> = {}): DraftNewAttribute => ({ id: 'A1', name: 'Tolerance', kind: 'number', unit: '%', siPrefixes: false, options: [], ...over })

  it('puts an attribute in, refuses a duplicate name (existing or draft) and bad input', () => {
    const d = ok(withNewAttribute(base, s, att()))
    expect(d.newAttributes).toEqual([att()])
    expect(withNewAttribute(d, s, att({ id: 'A2', name: 'inductance' }))).toEqual({
      errorKey: 'intakes.attribute.duplicate',
      params: { name: 'inductance', id: 'ind' },
    })
    expect(withNewAttribute(d, s, att({ id: 'A2', name: ' TOLERANCE ' }))).toMatchObject({ errorKey: 'intakes.attribute.duplicate', params: { id: 'A1' } })
    // Editing itself is not a clash.
    expect(failed(withNewAttribute(d, s, att({ unit: '‰' })))).toBe(false)
    expect(withNewAttribute(base, s, att({ name: '' }))).toEqual({ errorKey: 'errors.domain.name_required' })
    expect(withNewAttribute(base, s, att({ unit: 'x'.repeat(17) }))).toEqual({ errorKey: 'intakes.attribute.invalid' })
  })

  it('cannot be removed while a new item uses it', () => {
    let d = ok(withNewAttribute(base, s, att()))
    d = withNewItem(d, nItem({ attributes: [{ attributeId: 'A1', value: null, axis: true }] }))
    expect(withoutNewAttribute(d, 'A1')).toEqual({ errorKey: 'intakes.attribute.inUse' })
    d = withNewItem(d, nItem())
    expect(ok(withoutNewAttribute(d, 'A1')).newAttributes).toEqual([])
  })
})

describe('new items', () => {
  it('live on their own, and get the photo id once', () => {
    let d = withNewItem(base, nItem({ photo }))
    const id = d.newItems[0]!.photoId
    expect(id).toBeTruthy()
    d = withNewItem(d, { ...d.newItems[0]!, name: 'Inductor' })
    expect(d.newItems).toHaveLength(1)
    expect(d.newItems[0]).toMatchObject({ name: 'Inductor', photoId: id })
    expect(withNewItem(base, nItem()).newItems[0]!.photoId).toBeUndefined()
  })

  it('withoutNewItem removes the item and its lines; restoreNewItem puts them back in place', () => {
    const a = line('M')
    const l1 = line('N1')
    const l2 = line('N1')
    const tag = { id: 'T1', name: 'Kit' }
    let d = withNewItem({ ...base, newTags: [tag], lines: [a, l1, l2] }, nItem({ tagIds: ['T1'] }))
    d = withNewItem(d, nItem({ id: 'N2', name: 'Other' }))
    const before = d
    const { content, removed } = withoutNewItem(d, 'N1')
    expect(content.newItems.map((n) => n.id)).toEqual(['N2'])
    expect(content.lines).toEqual([a])
    expect(content.newTags).toEqual([])
    expect(restoreNewItem(content, removed!)).toEqual(before)
    expect(withoutNewItem(d, 'nope')).toEqual({ content: d, removed: null })
  })
})

describe('nameClash', () => {
  it('Review Focus 2: finds the existing Passives, ignoring case and the archive', () => {
    expect(nameClash(s, base, { kind: 'folder', name: ' passives ', parentId: null })).toEqual({ id: 'PASS', draft: false })
    expect(nameClash(s, base, { kind: 'folder', name: 'Passives', parentId: 'R' })).toBeNull()
    expect(nameClash(s, base, { kind: 'folder', name: 'Old', parentId: null })).toBeNull()
    expect(nameClash(s, base, { kind: 'folder', name: 'Passives', parentId: null }, 'PASS')).toBeNull()
  })

  it('finds a draft folder and attributes anywhere', () => {
    const d: IntakeDraftContent = { ...base, newFolders: [{ id: 'F1', name: 'Coils', parentId: null }], newAttributes: [{ id: 'A1', name: 'Tolerance', kind: 'text', unit: '', siPrefixes: false, options: [] }] }
    expect(nameClash(s, d, { kind: 'folder', name: 'coils', parentId: null })).toEqual({ id: 'F1', draft: true })
    expect(nameClash(s, d, { kind: 'folder', name: 'coils', parentId: null }, 'F1')).toBeNull()
    expect(nameClash(s, d, { kind: 'attribute', name: 'tolerance' })).toEqual({ id: 'A1', draft: true })
    expect(nameClash(s, d, { kind: 'attribute', name: 'Resistance' })).toEqual({ id: 'res', draft: false })
  })
})

describe('useExisting', () => {
  it('Review Focus 2: redirects a new item and a child draft folder, and resolveIntake has no entity problems', () => {
    // The person made "Passives" in the app while the draft held its own (made when it did not exist).
    const clashing = makeSnapshot({ ...s, folders: [...s.folders] })
    let d = ok(withNewFolder(base, makeSnapshot({ ...s, folders: [] }), { id: 'DP', name: 'Passives', parentId: null }))
    d = ok(withNewFolder(d, clashing, { id: 'DI', name: 'Inductors', parentId: 'DP' }))
    d = withNewItem({ ...d, lines: [line('N1')] }, nItem({ folderId: 'DP' }))
    const blocked = resolveIntake(d, clashing)
    expect(blocked.ok).toBe(false)
    expect(blocked.entities.find((e) => e.id === 'DP')?.problem).toEqual({ code: 'duplicate_name', existingId: 'PASS' })

    const fixed = useExisting(d, 'DP', 'PASS')
    expect(fixed.newFolders).toEqual([{ id: 'DI', name: 'Inductors', parentId: 'PASS' }])
    expect(fixed.newItems[0]!.folderId).toBe('PASS')
    const r = resolveIntake(fixed, clashing)
    expect(r.entities.every((e) => e.problem === null)).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('redirects an attribute on new items and on line values', () => {
    const t = makeSnapshot({ ...s, attributes: [...s.attributes] })
    let d = ok(withNewAttribute(base, makeSnapshot({ ...s, attributes: [] }), { id: 'DA', name: 'Inductance', kind: 'number', unit: 'H', siPrefixes: true, options: [] }))
    d = withNewItem({ ...d, lines: [line('N1', { DA: '1u' })] }, nItem({ attributes: [{ attributeId: 'DA', value: null, axis: true }] }))
    expect(resolveIntake(d, t).entities.find((e) => e.id === 'DA')?.problem).toEqual({ code: 'duplicate_name', existingId: 'ind' })
    const fixed = useExisting(d, 'DA', 'ind')
    expect(fixed.newAttributes).toEqual([])
    expect(fixed.newItems[0]!.attributes).toEqual([{ attributeId: 'ind', value: null, axis: true }])
    expect(fixed.lines[0]!.axisValues).toEqual([{ attributeId: 'ind', value: '1u' }])
  })

  it('leaves the draft alone for an id that is no draft folder or attribute', () => {
    expect(useExisting(base, 'x', 'y')).toBe(base)
  })
})

describe('creatingLineOf', () => {
  it('a new value of an existing item: the other line that creates it', () => {
    const a = line('R', { res: '47000' })
    const d = { ...base, lines: [a] }
    expect(creatingLineOf(s, d, 'R', [{ attributeId: 'res', value: '47k' }])).toBe(a.id)
    expect(creatingLineOf(s, d, 'R', [{ attributeId: 'res', value: '47k' }], a.id)).toBeNull()
    expect(creatingLineOf(s, d, 'R', [{ attributeId: 'res', value: '10k' }])).toBeNull()
    // A top-up of a variant the item has is not creating.
    expect(creatingLineOf(s, { ...base, lines: [line('R', { res: '4700' })] }, 'R', [{ attributeId: 'res', value: '4k7' }])).toBeNull()
    expect(creatingLineOf(s, d, 'R', [])).toBeNull()
    expect(creatingLineOf(s, d, 'M', [])).toBeNull()
  })

  it('a new item: without axes any other line; with axes the same values', () => {
    const plain = line('N1')
    const d = withNewItem({ ...base, lines: [plain] }, nItem())
    expect(creatingLineOf(s, d, 'N1', [])).toBe(plain.id)
    expect(creatingLineOf(s, d, 'N1', [], plain.id)).toBeNull()
    const withAxis = nItem({ id: 'N2', attributes: [{ attributeId: 'res', value: null, axis: true }] })
    const x = line('N2', { res: '1000' })
    const d2 = withNewItem({ ...base, lines: [x] }, withAxis)
    expect(creatingLineOf(s, d2, 'N2', [{ attributeId: 'res', value: '1k' }])).toBe(x.id)
    expect(creatingLineOf(s, d2, 'N2', [{ attributeId: 'res', value: '2k' }])).toBeNull()
  })

  it('reads a draft attribute as an axis', () => {
    let d = ok(withNewAttribute(base, s, { id: 'DA', name: 'Tolerance', kind: 'number', unit: '%', siPrefixes: false, options: [] }))
    const x = line('N1', { DA: '5' })
    d = withNewItem({ ...d, lines: [x] }, nItem({ attributes: [{ attributeId: 'DA', value: null, axis: true }] }))
    expect(creatingLineOf(s, d, 'N1', [{ attributeId: 'DA', value: '5' }])).toBe(x.id)
  })
})

describe('buildDraftLine: one line per created variant and photos', () => {
  it('a second creating line is refused with the line named', () => {
    const a = line('R', { res: '47000' })
    const d = { ...base, lines: [a] }
    expect(buildDraftLine(form({ axisValues: [{ attributeId: 'res', value: '47k' }] }), s, d)).toEqual({
      errorKey: 'intakes.line.alreadyCreated',
      params: { line: a.id },
    })
    // Editing that line itself, or a top-up twice, is fine.
    expect(buildDraftLine(form({ lineId: a.id, axisValues: [{ attributeId: 'res', value: '47k' }] }), s, d)).toHaveProperty('line')
    const top = { ...base, lines: [line('R', { res: '4700' })] }
    expect(buildDraftLine(form({ axisValues: [{ attributeId: 'res', value: '4k7' }] }), s, top)).toHaveProperty('line')
  })

  it('a second line of a new item without axes is refused', () => {
    const n = nItem()
    const first = line('N1')
    const d = withNewItem({ ...base, lines: [first] }, n)
    expect(buildDraftLine(form({ itemId: 'N1', newItem: n }), s, d)).toMatchObject({ errorKey: 'intakes.line.alreadyCreated', params: { line: first.id } })
  })

  it('a top-up line takes no photo, but keeps one its own saved line has', () => {
    const f = form({ axisValues: [{ attributeId: 'res', value: '4k7' }], photo: { ...photo, replace: false } })
    expect(buildDraftLine(f, s, base)).toEqual({ errorKey: 'intakes.line.noPhotoOnTopUp' })
    expect(buildDraftLine(form({ itemId: 'M', photo: { ...photo, replace: false } }), s, base)).toEqual({ errorKey: 'intakes.line.noPhotoOnTopUp' })
    const old = line('R', { res: '4700' }, { id: 'LF', photo: { ...photo, replace: true } })
    expect(buildDraftLine(f, s, { ...base, lines: [old] })).toHaveProperty('line.photo')
  })

  it('a new item without axes: the form photo is the item photo, with a photo id; the line has none', () => {
    const built = buildDraftLine(form({ itemId: 'N1', newItem: nItem(), photo: { ...photo, replace: true } }), s, base)
    if (!('line' in built)) throw new Error(built.errorKey)
    expect(built.line.photo).toBeNull()
    expect(built.newItem!.photo).toEqual(photo)
    expect(built.newItem!.photoId).toBeTruthy()
    // The card's photo stays when the form has none.
    const again = buildDraftLine(form({ itemId: 'N1', newItem: built.newItem }), s, base)
    expect(again).toMatchObject({ newItem: { photo, photoId: built.newItem!.photoId }, line: { photo: null } })
  })

  it('a new variant keeps its photo on the line; the folder and attribute of a new item may be the draft’s', () => {
    let d = ok(withNewAttribute(base, s, { id: 'DA', name: 'Tolerance', kind: 'number', unit: '%', siPrefixes: false, options: [] }))
    d = ok(withNewFolder(d, s, { id: 'DF', name: 'Coils', parentId: null }))
    const n = nItem({ folderId: 'DF', attributes: [{ attributeId: 'DA', value: null, axis: true }] })
    const built = buildDraftLine(form({ itemId: 'N1', newItem: n, axisValues: [{ attributeId: 'DA', value: '5' }], photo: { ...photo, replace: false } }), s, d)
    expect(built).toMatchObject({ line: { photo: { ...photo, replace: false }, axisValues: [{ attributeId: 'DA', value: '5' }] }, newItem: { folderId: 'DF' } })
    // An existing item's new value: the photo is the new variant's.
    expect(buildDraftLine(form({ axisValues: [{ attributeId: 'res', value: '33k' }], photo: { ...photo, replace: true } }), s, base)).toMatchObject({
      line: { photo: { replace: false } },
    })
  })
})

describe('fix round 1', () => {
  const rich = (): IntakeDraftContent => {
    let d = ok(withNewFolder(base, s, { id: 'DF', name: 'Coils', parentId: null }))
    d = ok(withNewAttribute(d, s, { id: 'DA', name: 'Tolerance', kind: 'text', unit: '', siPrefixes: false, options: [] }))
    return { ...d, newTags: [{ id: 'T1', name: 'Kit' }], newItems: [nItem({ tagIds: ['T1'] })] }
  }
  const keeps = (d: IntakeDraftContent) => {
    expect(d.newFolders?.map((f) => f.id)).toEqual(['DF'])
    expect(d.newAttributes?.map((a) => a.id)).toEqual(['DA'])
    expect(d.newTags?.map((t) => t.id)).toEqual(['T1'])
  }

  it('withLine, withoutLine, restoreLine, item helpers and useExisting keep draft folders, attributes and tags', () => {
    const l = line('M')
    const d = withLine(rich(), l, null)
    keeps(d)
    const { content, removed } = withoutLine(d, l.id)
    keeps(content)
    keeps(restoreLine(content, removed!))
    keeps(withNewItem(d, nItem({ id: 'N2', name: 'Other' })))
    const out = withoutNewItem(d, 'N2')
    keeps(out.content)
    const gone = withoutNewItem(withNewItem(d, nItem({ id: 'N3', name: 'Z' })), 'N3')
    keeps(gone.content)
    keeps(restoreNewItem(gone.content, gone.removed!))
    keeps(useExisting(d, 'nope', 'x'))
    keeps(useExisting({ ...d, newFolders: [...d.newFolders!, { id: 'D2', name: 'Q', parentId: null }] }, 'D2', 'PASS'))
  })

  it('the duplicate check uses the new item as the form has it', () => {
    const plain = nItem()
    const other = line('N1')
    const d = withNewItem({ ...base, lines: [other] }, plain)
    // The sheet gives the item an axis: the other line (no value) is not the same variant.
    const withAxis = { ...plain, attributes: [{ attributeId: 'res', value: null, axis: true }] }
    const built = buildDraftLine(form({ itemId: 'N1', newItem: withAxis, axisValues: [{ attributeId: 'res', value: '1k' }] }), s, d)
    expect(built).toHaveProperty('line')
    // Same values on the same axes is still refused.
    const twin = line('N1', { res: '1000' })
    const d2 = withNewItem({ ...base, lines: [twin] }, withAxis)
    expect(buildDraftLine(form({ itemId: 'N1', newItem: withAxis, axisValues: [{ attributeId: 'res', value: '1k' }] }), s, d2)).toMatchObject({ errorKey: 'intakes.line.alreadyCreated' })
  })
})

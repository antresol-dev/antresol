import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import type { Photo } from '../src/model'
import {
  buildIntakeCommit,
  emptyIntakeDraft,
  pruneNewItems,
  resolveIntake,
  snapshotAfterIntake,
  type DraftLine,
  type DraftNewAttribute,
  type DraftNewItem,
  type Intake,
  type IntakeDraftContent,
} from '../src/intakes'
import { MAX_NAME_LENGTH } from '../src/limits'
import { normalizeCommand, validateCommand } from '../src/validate'
import { ARCHIVED, attribute, axis, electronics, folder, item, makeSnapshot, value, variant } from './fixtures'

type IntakeCommit = Extract<Command, { type: 'intake.commit' }>

let seq = 0
function line(itemId: string, axisValues: Record<string, string> = {}, over: Partial<DraftLine> = {}): DraftLine {
  const n = ++seq
  return {
    id: `line${n}`,
    itemId,
    axisValues: Object.entries(axisValues).map(([attributeId, value]) => ({ attributeId, value })),
    quantity: '10',
    totalPrice: null,
    sourceUrl: null,
    photo: null,
    ids: { movementId: `mov${n}`, variantId: `var${n}`, photoId: `pho${n}` },
    ...over,
  }
}

const draft = (lines: DraftLine[], newItems: DraftNewItem[] = []): IntakeDraftContent => ({ newItems, lines })

function intakeOf(content: IntakeDraftContent): Intake {
  return {
    id: 'intake1',
    inventoryId: 'inv',
    status: 'draft',
    header: { shop: 'LCSC', orderNumber: 'WM2511-0042', purchasedOn: '2026-11-12', note: null },
    draft: content,
    lines: null,
    created: null,
    draftRev: 'rev-d',
    createdAt: '',
    createdBy: 'test',
    updatedAt: '',
    updatedBy: 'test',
    committedAt: null,
  }
}

const photoRow = (id: string, itemId: string, variantId: string | null): Photo => ({
  id, itemId, variantId, provider: 'uploadcare', fileId: id, url: `https://x/${id}`, urls: null, width: null, height: null,
  deleteHandle: null, position: 0, createdAt: '', createdBy: 'test',
})

/** Resistor R (axis Resistance, Ω with SI prefixes): an active 4.7 kΩ variant and an archived 47 kΩ one. */
function resistors() {
  return makeSnapshot({
    items: [item('R', 'Resistor 0.25 W')],
    attributes: [attribute('res', 'Resistance', 'number', { unit: 'Ω', siPrefixes: true })],
    itemAttributes: [axis('R', 'res', 0)],
    variants: [variant('r4k7', 'R'), variant('r47k', 'R', ARCHIVED)],
    variantAttributeValues: [value('r4k7', 'res', '4700'), value('r47k', 'res', '47000')],
  })
}

const resistorItem = (id = 'NEW'): DraftNewItem => ({
  id,
  name: 'Resistor 0.6 W',
  folderId: null,
  unitKey: 'pcs',
  attributes: [
    { attributeId: 'pkg', value: 'THT', axis: false },
    { attributeId: 'res', value: null, axis: true },
  ],
})

describe('resolveIntake', () => {
  it('a line on an item without axes adds to the item', () => {
    const r = resolveIntake(draft([line('M')]), electronics())
    expect(r.ok).toBe(true)
    expect(r.lines[0]!.resolution).toEqual({ kind: 'add', itemId: 'M', variantId: null, unarchive: false })
  })

  it('4k7 and 4.7k both add to the existing 4.7 kΩ variant', () => {
    const r = resolveIntake(draft([line('R', { res: '4k7' }), line('R', { res: '4.7k' })]), resistors())
    expect(r.ok).toBe(true)
    for (const l of r.lines) expect(l.resolution).toEqual({ kind: 'add', itemId: 'R', variantId: 'r4k7', unarchive: false })
  })

  it('an archived variant with the value is added to and unarchived', () => {
    const r = resolveIntake(draft([line('R', { res: '47k' })]), resistors())
    expect(r.lines[0]!.resolution).toEqual({ kind: 'add', itemId: 'R', variantId: 'r47k', unarchive: true })
  })

  it('a second line creating the same new value of an existing item is a duplicate line', () => {
    const a = line('R', { res: '47k' })
    const b = line('R', { res: '47 kΩ' })
    const r = resolveIntake(draft([a, b]), electronics())
    expect(r.ok).toBe(false)
    expect(r.lines[0]!.resolution).toEqual({ kind: 'newValue', itemId: 'R', variantId: a.ids.variantId, sharedWith: null })
    expect(r.lines[1]!.resolution).toEqual({ kind: 'problem', code: 'duplicate_line' })
  })

  it('lines on a new item of the draft make its variants', () => {
    const lines = [line('NEW', { res: '1k' }), line('NEW', { res: '4k7' }), line('NEW', { res: '10k' })]
    const r = resolveIntake(draft(lines, [resistorItem()]), electronics())
    expect(r.ok).toBe(true)
    expect(r.lines.map((l) => l.resolution)).toEqual(lines.map((l) => ({ kind: 'newItem', itemId: 'NEW', variantId: l.ids.variantId })))
    expect(new Set(lines.map((l) => l.ids.variantId)).size).toBe(3)
  })

  it('a line on a new item without axes has no variant; a second line on it is a duplicate line', () => {
    const plain: DraftNewItem = { id: 'P', name: 'ESP32', folderId: null, unitKey: 'pcs', attributes: [] }
    const one = resolveIntake(draft([line('P')], [plain]), electronics())
    expect(one.ok).toBe(true)
    expect(one.lines[0]!.resolution).toEqual({ kind: 'newItem', itemId: 'P', variantId: null })
    const two = resolveIntake(draft([line('P'), line('P')], [plain]), electronics())
    expect(two.ok).toBe(false)
    expect(two.lines.map((l) => l.resolution)).toEqual([
      { kind: 'newItem', itemId: 'P', variantId: null },
      { kind: 'problem', code: 'duplicate_line' },
    ])
  })

  it('marks lines on a new item that cannot be created', () => {
    const s = makeSnapshot({
      ...electronics(),
      folders: [folder('AF', 'Old parts', null, ARCHIVED)],
      units: [{ id: 'u1', inventoryId: 'inv', name: 'Reel', symbol: 'reel', prefixPowers: [], createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }],
    })
    const cases: [Partial<DraftNewItem>, string][] = [
      [{ folderId: 'AF' }, 'item_archived'],
      [{ attributes: [{ attributeId: 'gone', value: null, axis: true }] }, 'invalid_value'],
      [{ unitKey: 'custom:deleted' }, 'invalid_value'],
      [{ name: '   ' }, 'invalid_value'],
      [{ unitKey: 'custom:u1' }, 'ok'],
    ]
    for (const [over, code] of cases) {
      const r = resolveIntake(draft([line('NEW', { res: '1k' })], [{ ...resistorItem(), ...over }]), s)
      expect(r.lines[0]!.resolution.kind === 'problem' ? r.lines[0]!.resolution.code : 'ok', JSON.stringify(over)).toBe(code)
      expect(r.ok).toBe(code === 'ok')
    }
  })

  it('marks lines whose item is gone or archived, or whose axis has no value', () => {
    const s = makeSnapshot({
      ...electronics(),
      folders: [folder('AF', 'Old parts', null, ARCHIVED)],
      items: [...electronics().items, item('X', 'Op-amp', 'AF')],
    })
    const r = resolveIntake(draft([line('M'), line('GONE'), line('X'), line('R'), line('R', { res: 'abc' })]), s)
    expect(r.ok).toBe(false)
    expect(r.lines.map((l) => l.resolution)).toEqual([
      { kind: 'add', itemId: 'M', variantId: null, unarchive: false },
      { kind: 'problem', code: 'unknown_item' },
      { kind: 'problem', code: 'item_archived' },
      { kind: 'problem', code: 'missing_axis_value' },
      { kind: 'problem', code: 'invalid_value' },
    ])
  })
})

describe('resolveIntake: what the commit would refuse', () => {
  it('marks a line whose link is not an http(s) address, and a new item whose name is too long', () => {
    const plain = (name: string): DraftNewItem => ({ id: 'P', name, folderId: null, unitKey: 'pcs', attributes: [] })
    const lines = [
      line('M', {}, { sourceUrl: 'lcsc.com/x' }),
      line('M', {}, { sourceUrl: 'https://lcsc.com/x' }),
      line('M', {}, { sourceUrl: 'HTTP://lcsc.com/x' }),
    ]
    const r = resolveIntake(draft(lines), electronics())
    expect(r.ok).toBe(false)
    expect(r.lines.map((l) => l.resolution.kind === 'problem' ? l.resolution.code : 'ok')).toEqual(['invalid_link', 'ok', 'ok'])
    const long = resolveIntake(draft([line('P')], [plain('x'.repeat(201))]), electronics())
    expect(long.lines[0]!.resolution).toEqual({ kind: 'problem', code: 'invalid_value' })
    expect(resolveIntake(draft([line('P')], [plain(` ${'x'.repeat(200)} `)]), electronics()).ok).toBe(true)
  })

  it('an item problem is told before a bad link', () => {
    const r = resolveIntake(draft([line('GONE', {}, { sourceUrl: 'lcsc.com/x' })]), electronics())
    expect(r.lines[0]!.resolution).toEqual({ kind: 'problem', code: 'unknown_item' })
  })
})

describe('buildIntakeCommit', () => {
  const build = (content: IntakeDraftContent, s = electronics()) => {
    const resolved = resolveIntake(content, s)
    return buildIntakeCommit(intakeOf(content), resolved, s, 'rev-1') as IntakeCommit
  }

  it('builds new items before their variants, receipts and lines per line; a new item without lines too', () => {
    const s = resistors()
    const lines = [
      line('NEW', { res: '1k' }, { totalPrice: 120, sourceUrl: 'https://lcsc.com/C1' }),
      line('NEW', { res: '4.7 kΩ' }),
      line('R', { res: '4k7' }),
      line('R', { res: '47k' }),
      line('R', { res: '22k' }),
    ]
    const c = build(draft(lines, [resistorItem(), { ...resistorItem('UNUSED'), name: 'No stock' }]), {
      ...s,
      attributes: [...s.attributes, attribute('pkg', 'Package', 'enum', { options: ['0805', 'THT'] })],
    })
    expect(c).toMatchObject({ type: 'intake.commit', intakeId: 'intake1', inventoryId: 'inv', baseRev: 'rev-1', baseDraftRev: 'rev-d' })
    expect(c.header).toEqual({ shop: 'LCSC', orderNumber: 'WM2511-0042', purchasedOn: '2026-11-12', note: null })
    const attributes = [
      { attributeId: 'pkg', value: 'THT', axisPosition: null },
      { attributeId: 'res', value: null, axisPosition: 0 },
    ]
    expect(c.newItems).toEqual([
      { id: 'NEW', folderId: null, name: 'Resistor 0.6 W', description: null, unitKey: 'pcs', tagIds: [], attributes },
      { id: 'UNUSED', folderId: null, name: 'No stock', description: null, unitKey: 'pcs', tagIds: [], attributes },
    ])
    expect(c.newVariants).toEqual([
      { id: lines[0]!.ids.variantId, itemId: 'NEW', values: [{ attributeId: 'res', value: '1000' }] },
      { id: lines[1]!.ids.variantId, itemId: 'NEW', values: [{ attributeId: 'res', value: '4700' }] },
      { id: lines[4]!.ids.variantId, itemId: 'R', values: [{ attributeId: 'res', value: '22000' }] },
    ])
    expect(c.unarchiveVariants).toEqual(['r47k'])
    expect(c.receipts.map((r) => [r.movementId, r.itemId, r.variantId])).toEqual([
      [lines[0]!.ids.movementId, 'NEW', lines[0]!.ids.variantId],
      [lines[1]!.ids.movementId, 'NEW', lines[1]!.ids.variantId],
      [lines[2]!.ids.movementId, 'R', 'r4k7'],
      [lines[3]!.ids.movementId, 'R', 'r47k'],
      [lines[4]!.ids.movementId, 'R', lines[4]!.ids.variantId],
    ])
    expect(c.receipts[0]).toMatchObject({ quantity: '10', totalPrice: 120, sourceUrl: 'https://lcsc.com/C1' })
    expect(c.lines.map((l) => [l.kind, l.itemName, l.variantLabel])).toEqual([
      ['newItem', 'Resistor 0.6 W', '1 kΩ'],
      ['newItem', 'Resistor 0.6 W', '4.7 kΩ'],
      ['add', 'Resistor 0.25 W', '4.7 kΩ'],
      ['add', 'Resistor 0.25 W', '47 kΩ'],
      ['newValue', 'Resistor 0.25 W', '22 kΩ'],
    ])
    expect(c.lines[0]).toEqual({
      lineId: lines[0]!.id, kind: 'newItem', itemId: 'NEW', variantId: lines[0]!.ids.variantId, movementId: lines[0]!.ids.movementId,
      itemName: 'Resistor 0.6 W', variantLabel: '1 kΩ', quantity: '10', unitKey: 'pcs', totalPrice: 120, sourceUrl: 'https://lcsc.com/C1',
    })
    expect(c.photos).toEqual([])
  })

  it('the built command passes validation', () => {
    const s = { ...resistors(), attributes: [...resistors().attributes, attribute('pkg', 'Package', 'enum', { options: ['THT'] })] }
    const lines = [line('NEW', { res: '1k' }), line('R', { res: '47k' }), line('R', { res: '22k' })]
    const c = build(draft(lines, [resistorItem()]), s)
    expect(validateCommand(normalizeCommand(c), s)).toBeNull()
  })

  it('a variant photo is replaced only when the line asks for it', () => {
    const s = { ...resistors(), photos: [photoRow('old', 'R', 'r4k7')] }
    const photo = { provider: 'uploadcare', fileId: 'f1', url: 'https://x/f1' }
    expect(build(draft([line('R', { res: '4k7' }, { photo: { ...photo, replace: false } })]), s).photos).toEqual([])
    const l = line('R', { res: '4k7' }, { photo: { ...photo, replace: true } })
    // A draft saved before photo renditions: the photo goes without them (null).
    expect(build(draft([l]), s).photos).toEqual([
      {
        id: l.ids.photoId, itemId: 'R', variantId: 'r4k7', replaces: 'old', provider: 'uploadcare', fileId: 'f1', url: 'https://x/f1',
        urls: null, width: null, height: null, deleteHandle: null,
      },
    ])
  })

  it('a photo carries the renditions, size and delete handle the upload gave it', () => {
    const file = {
      provider: 'imgbb', fileId: 'f1', url: 'https://i.ibb.co/f1/full.jpg',
      urls: [{ url: 'https://i.ibb.co/f1/thumb.jpg', role: 'thumb', width: 180, height: 180, fit: 'cover' as const, type: null }],
      width: 1600, height: 1200, deleteHandle: 'https://ibb.co/f1/del',
    }
    const l = line('M', {}, { photo: { ...file, replace: false } })
    expect(build(draft([l])).photos).toEqual([{ id: l.ids.photoId, itemId: 'M', variantId: null, replaces: undefined, ...file }])
  })

  it('a photo goes to a new variant or a variant without one; the item gallery takes any number', () => {
    const photo = { provider: 'uploadcare', fileId: 'f', url: 'https://x/f', replace: false }
    const lines = [
      line('R', { res: '47k' }, { photo }),
      line('R', { res: '1k' }, { photo }),
      line('R', { res: '1k' }, { photo }), // the same variant without a photo: it already gets the line above's
      line('M', {}, { photo }),
      line('M', {}, { photo }),
    ]
    const c = build(draft(lines))
    expect(c.photos.map((p) => [p.id, p.itemId, p.variantId, p.replaces])).toEqual([
      [lines[0]!.ids.photoId, 'R', lines[0]!.ids.variantId, undefined],
      [lines[1]!.ids.photoId, 'R', 'r1k', undefined],
      [lines[3]!.ids.photoId, 'M', null, undefined],
      [lines[4]!.ids.photoId, 'M', null, undefined],
    ])
  })

  it('refuses a draft with problem lines', () => {
    const content = draft([line('GONE')])
    expect(() => buildIntakeCommit(intakeOf(content), resolveIntake(content, electronics()), electronics(), 'rev-1')).toThrow()
  })
})

describe('tags of new items', () => {
  const tag = (id: string, name: string) => ({ id, inventoryId: 'inv', name, color: null, createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' })
  const base = () => ({ ...electronics(), tags: [tag('smd', 'SMD')] })
  const tagged = (tagIds: string[] | undefined, newTags: { id: string; name: string }[] | undefined, lines = [line('NEW')]) => ({
    ...draft(lines, [{ ...resistorItem(), attributes: [], ...(tagIds ? { tagIds } : {}) }]),
    ...(newTags ? { newTags } : {}),
  })
  const build = (content: IntakeDraftContent, s = base()) =>
    buildIntakeCommit(intakeOf(content), resolveIntake(content, s), s, 'rev-1') as IntakeCommit
  const code = (content: IntakeDraftContent) => {
    const r = resolveIntake(content, base()).lines[0]!.resolution
    return r.kind === 'problem' ? r.code : r.kind
  }

  it('marks the lines of a new item with a tag that is nowhere, or a new tag with a bad name', () => {
    expect(code(tagged(['ghost'], []))).toBe('invalid_value')
    expect(code(tagged(['T1'], [{ id: 'T1', name: '  ' }]))).toBe('invalid_value')
    expect(code(tagged(['T1'], [{ id: 'T1', name: 'x'.repeat(MAX_NAME_LENGTH + 1) }]))).toBe('invalid_value')
    expect(code(tagged(['smd', 'T1'], [{ id: 'T1', name: 'Kit A' }]))).toBe('newItem')
  })

  it('builds newTags and the item tagIds, existing tag first as the item lists them', () => {
    const c = build(tagged(['smd', 'T1'], [{ id: 'T1', name: 'Kit A' }]))
    expect(c.newTags).toEqual([{ id: 'T1', name: 'Kit A' }])
    expect(c.newItems[0]!.tagIds).toEqual(['smd', 'T1'])
    expect(validateCommand(normalizeCommand(c), base())).toBeNull()
  })

  it('a new tag named as an existing one (trim, no case) is the existing tag', () => {
    const c = build(tagged(['T1'], [{ id: 'T1', name: ' smd ' }]))
    expect(c.newTags).toEqual([])
    expect(c.newItems[0]!.tagIds).toEqual(['smd'])
  })

  it('two new tags with one name are created once', () => {
    const c = build(tagged(['T1', 'T2'], [{ id: 'T1', name: 'Kit' }, { id: 'T2', name: 'KIT' }]))
    expect(c.newTags).toEqual([{ id: 'T1', name: 'Kit' }])
    expect(c.newItems[0]!.tagIds).toEqual(['T1'])
  })

  it('a new tag no new item references is not created', () => {
    const c = build(tagged(['T1'], [{ id: 'T1', name: 'Kit A' }, { id: 'T2', name: 'Kit B' }], [line('NEW'), line('M')]))
    expect(c.newTags).toEqual([{ id: 'T1', name: 'Kit A' }])
    expect(c.newItems.map((n) => n.id)).toEqual(['NEW'])
  })

  it('a draft saved before tags existed commits with no tags', () => {
    const c = build(tagged(undefined, undefined))
    expect(c.newTags).toEqual([])
    expect(c.newItems[0]!.tagIds).toEqual([])
  })

  it('snapshotAfterIntake holds the new tags and the tags of the new items', () => {
    const s = base()
    const c = build(tagged(['smd', 'T1'], [{ id: 'T1', name: 'Kit A' }]), s)
    const after = snapshotAfterIntake(s, c)
    expect(after.tags.map((t) => [t.id, t.name])).toEqual([['smd', 'SMD'], ['T1', 'Kit A']])
    expect(after.items.find((i) => i.id === 'NEW')!.tagIds).toEqual(['smd', 'T1'])
    // Applied again (a retry) it adds nothing.
    expect(snapshotAfterIntake(after, c).tags).toHaveLength(2)
  })
})

describe('draft helpers', () => {
  it('emptyIntakeDraft has no new items and no lines', () => {
    expect(emptyIntakeDraft()).toEqual({ newItems: [], lines: [] })
  })

  it('pruneNewItems keeps new items without lines, draft folders and attributes; drops tags no new item references', () => {
    const kept = { ...resistorItem('KEPT'), tagIds: ['T1'] }
    const content: IntakeDraftContent = {
      ...draft([line('KEPT', { res: '1k' }), line('M')], [kept, resistorItem('NO_LINES')]),
      newTags: [{ id: 'T1', name: 'Kit A' }, { id: 'T2', name: 'Kit B' }],
      newFolders: [{ id: 'F1', name: 'Inductors', parentId: null }],
      newAttributes: [{ id: 'A1', name: 'Inductance', kind: 'number', unit: 'H', siPrefixes: true, options: [] }],
    }
    const pruned = pruneNewItems(content)
    expect(pruned.newItems.map((n) => n.id)).toEqual(['KEPT', 'NO_LINES'])
    expect(pruned.newTags).toEqual([{ id: 'T1', name: 'Kit A' }])
    expect(pruned.newFolders).toEqual(content.newFolders)
    expect(pruned.newAttributes).toEqual(content.newAttributes)
    expect(pruned.lines).toHaveLength(2)
  })
})

describe('draft folders, attributes and standalone items', () => {
  const tag = (id: string, name: string) => ({ id, inventoryId: 'inv', name, color: null, createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' })
  /** Electronics with a root folder Passives, an archived root folder Old parts, and a tag SMD. */
  const base = () =>
    makeSnapshot({
      ...electronics(),
      folders: [folder('PAS', 'Passives'), folder('AF', 'Old parts', null, ARCHIVED)],
      tags: [tag('smd', 'SMD')],
    })
  const inductance: DraftNewAttribute = { id: 'IND', name: 'Inductance', kind: 'number', unit: 'H', siPrefixes: true, options: [] }
  const inductor = (over: Partial<DraftNewItem> = {}): DraftNewItem => ({
    id: 'L1',
    name: 'Inductor 0805',
    folderId: null,
    unitKey: 'pcs',
    attributes: [{ attributeId: 'IND', value: null, axis: true }],
    ...over,
  })
  const plain = (over: Partial<DraftNewItem> = {}): DraftNewItem => ({
    id: 'P', name: 'ESP32', folderId: null, unitKey: 'pcs', attributes: [], ...over,
  })
  const content = (parts: Partial<IntakeDraftContent>): IntakeDraftContent => ({ newItems: [], lines: [], ...parts })
  const build = (c: IntakeDraftContent, s = base()) => buildIntakeCommit(intakeOf(c), resolveIntake(c, s), s, 'rev-1') as IntakeCommit
  const entity = (c: IntakeDraftContent, kind: 'folder' | 'attribute' | 'item', id: string, s = base()) =>
    resolveIntake(c, s).entities.find((e) => e.kind === kind && e.id === id)

  it('nested draft folders go parents first; an item in the inner one points at it', () => {
    const c = content({
      newFolders: [
        { id: 'B', name: 'Shielded', parentId: 'A' },
        { id: 'A', name: 'Inductors', parentId: 'PAS' },
      ],
      newItems: [plain({ folderId: 'B' })],
    })
    const r = resolveIntake(c, base())
    expect(r.ok).toBe(true)
    expect(r.entities).toEqual([
      { kind: 'folder', id: 'B', problem: null },
      { kind: 'folder', id: 'A', problem: null },
      { kind: 'item', id: 'P', problem: null },
    ])
    const cmd = build(c)
    expect(cmd.newFolders).toEqual([
      { id: 'A', parentId: 'PAS', name: 'Inductors' },
      { id: 'B', parentId: 'A', name: 'Shielded' },
    ])
    expect(cmd.newItems[0]!.folderId).toBe('B')
    expect(validateCommand(normalizeCommand(cmd), base())).toBeNull()
  })

  it('a draft attribute is an axis of a new item; its values parse by its own rules', () => {
    const l = line('L1', { IND: '4.7µ' })
    const c = content({ newAttributes: [inductance], newItems: [inductor()], lines: [l] })
    const cmd = build(c)
    expect(cmd.newAttributes).toEqual([{ id: 'IND', name: 'Inductance', kind: 'number', options: [], unit: 'H', siPrefixes: true }])
    expect(cmd.newItems[0]!.attributes).toEqual([{ attributeId: 'IND', value: null, axisPosition: 0 }])
    expect(cmd.newVariants).toEqual([{ id: l.ids.variantId, itemId: 'L1', values: [{ attributeId: 'IND', value: '0.0000047' }] }])
    expect(cmd.lines[0]!.variantLabel).toBe('4.7 µH')
    expect(validateCommand(normalizeCommand(cmd), base())).toBeNull()
  })

  it('the commit carries a draft attribute trimmed: name, unit and options', () => {
    const c = content({ newAttributes: [{ ...inductance, name: ' Inductance ', unit: ' H ' }], newItems: [plain()] })
    expect(build(c).newAttributes).toEqual([{ id: 'IND', name: 'Inductance', kind: 'number', options: [], unit: 'H', siPrefixes: true }])
    const list = content({ newAttributes: [{ id: 'PK', name: ' Pack ', kind: 'enum', unit: '', siPrefixes: false, options: [' A ', 'B '] }], newItems: [plain()] })
    expect(build(list).newAttributes).toEqual([{ id: 'PK', name: 'Pack', kind: 'enum', options: ['A', 'B'], unit: '', siPrefixes: false }])
  })

  it('a shared value on a draft attribute is canonical, and one that does not fit marks the item', () => {
    const shared = (value: string) => inductor({ attributes: [{ attributeId: 'IND', value, axis: false }] })
    expect(build(content({ newAttributes: [inductance], newItems: [shared('10u')] })).newItems[0]!.attributes).toEqual([
      { attributeId: 'IND', value: '0.00001', axisPosition: null },
    ])
    const bad = content({ newAttributes: [inductance], newItems: [shared('ten')] })
    expect(entity(bad, 'item', 'L1')!.problem).toEqual({ code: 'invalid_value' })
    expect(resolveIntake(bad, base()).ok).toBe(false)
  })

  it('a draft folder named as an existing or earlier draft folder under the same parent is a duplicate', () => {
    const dup = content({ newFolders: [{ id: 'D', name: ' passives ', parentId: null }] })
    expect(entity(dup, 'folder', 'D')!.problem).toEqual({ code: 'duplicate_name', existingId: 'PAS' })
    expect(resolveIntake(dup, base()).ok).toBe(false)
    const twice = content({
      newFolders: [
        { id: 'X', name: 'Inductors', parentId: 'PAS' },
        { id: 'Y', name: 'INDUCTORS', parentId: 'PAS' },
        { id: 'Z', name: 'Inductors', parentId: null },
      ],
    })
    expect(resolveIntake(twice, base()).entities.map((e) => e.problem)).toEqual([
      null,
      { code: 'duplicate_name', existingId: 'X' },
      null,
    ])
    // An archived folder with the name does not count.
    expect(entity(content({ newFolders: [{ id: 'D', name: 'Old parts', parentId: null }] }), 'folder', 'D')!.problem).toBeNull()
  })

  it('a draft attribute named as an existing or earlier draft attribute is a duplicate', () => {
    const dup = content({ newAttributes: [{ ...inductance, name: 'resistance ' }] })
    expect(entity(dup, 'attribute', 'IND')!.problem).toEqual({ code: 'duplicate_name', existingId: 'res' })
    expect(resolveIntake(dup, base()).ok).toBe(false)
    const twice = content({ newAttributes: [inductance, { ...inductance, id: 'IND2', name: 'INDUCTANCE' }] })
    expect(entity(twice, 'attribute', 'IND2')!.problem).toEqual({ code: 'duplicate_name', existingId: 'IND' })
  })

  it('a draft folder under an archived or missing folder has its parent gone; a parent below itself is a cycle', () => {
    const gone = content({
      newFolders: [
        { id: 'A', name: 'In archive', parentId: 'AF' },
        { id: 'B', name: 'Nowhere', parentId: 'GONE' },
      ],
    })
    expect(resolveIntake(gone, base()).entities.map((e) => e.problem)).toEqual([{ code: 'parent_gone' }, { code: 'parent_gone' }])
    const cycle = content({
      newFolders: [
        { id: 'A', name: 'A', parentId: 'B' },
        { id: 'B', name: 'B', parentId: 'A' },
        { id: 'C', name: 'C', parentId: 'C' },
      ],
    })
    const r = resolveIntake(cycle, base())
    expect(r.ok).toBe(false)
    expect(r.entities.map((e) => e.problem)).toEqual([{ code: 'cycle' }, { code: 'cycle' }, { code: 'cycle' }])
  })

  it('a draft folder or attribute with a bad name or kind has an invalid value', () => {
    expect(entity(content({ newFolders: [{ id: 'A', name: '  ', parentId: null }] }), 'folder', 'A')!.problem).toEqual({ code: 'invalid_value' })
    expect(entity(content({ newAttributes: [{ ...inductance, name: 'x'.repeat(MAX_NAME_LENGTH + 1) }] }), 'attribute', 'IND')!.problem).toEqual({
      code: 'invalid_value',
    })
    expect(entity(content({ newAttributes: [{ ...inductance, kind: 'colour' as never }] }), 'attribute', 'IND')!.problem).toEqual({
      code: 'invalid_value',
    })
  })

  it('a new item whose folder is archived or gone, even without lines, has its parent gone', () => {
    expect(entity(content({ newItems: [plain({ folderId: 'AF' })] }), 'item', 'P')!.problem).toEqual({ code: 'parent_gone' })
    expect(entity(content({ newItems: [plain({ folderId: 'GONE' })] }), 'item', 'P')!.problem).toEqual({ code: 'parent_gone' })
    expect(entity(content({ newItems: [plain({ name: ' ' })] }), 'item', 'P')!.problem).toEqual({ code: 'invalid_value' })
  })

  it('two lines creating the same 4.7 µH variant of a new item: the second is a duplicate line', () => {
    const a = line('L1', { IND: '4.7µ' })
    const b = line('L1', { IND: '4.7 µH' })
    const r = resolveIntake(content({ newAttributes: [inductance], newItems: [inductor()], lines: [a, b] }), base())
    expect(r.ok).toBe(false)
    expect(r.lines.map((l) => l.resolution)).toEqual([
      { kind: 'newItem', itemId: 'L1', variantId: a.ids.variantId },
      { kind: 'problem', code: 'duplicate_line' },
    ])
  })

  it('two top-up lines of one existing variant both add', () => {
    const r = resolveIntake(draft([line('R', { res: '1k' }), line('R', { res: '1000' })]), base())
    expect(r.ok).toBe(true)
    for (const l of r.lines) expect(l.resolution).toEqual({ kind: 'add', itemId: 'R', variantId: 'r1k', unarchive: false })
  })

  it('a new item without lines commits with no stock; a draft that does nothing cannot be committed', () => {
    const c = content({ newItems: [plain()] })
    const r = resolveIntake(c, base())
    expect(r.ok).toBe(true)
    const cmd = build(c)
    expect(cmd.newItems.map((n) => n.id)).toEqual(['P'])
    expect(cmd.receipts).toEqual([])
    expect(cmd.lines).toEqual([])
    expect(validateCommand(normalizeCommand(cmd), base())).toBeNull()
    expect(resolveIntake(emptyIntakeDraft(), base()).ok).toBe(false)
    expect(resolveIntake(content({ newTags: [{ id: 'T1', name: 'Kit' }] }), base()).ok).toBe(false)
    expect(resolveIntake(content({ newFolders: [{ id: 'A', name: 'Inductors', parentId: null }] }), base()).ok).toBe(true)
  })

  it('the photo and description of a new item go to its gallery and its row', () => {
    const file = { provider: 'imgbb', fileId: 'f1', url: 'https://i.ibb.co/f1/full.jpg', urls: null, width: 1600, height: 1200, deleteHandle: null }
    const cmd = build(content({ newItems: [plain({ description: 'Wi-Fi module', photo: file, photoId: 'IPH' })] }))
    expect(cmd.newItems[0]!.description).toBe('Wi-Fi module')
    expect(cmd.photos).toEqual([{ id: 'IPH', itemId: 'P', variantId: null, replaces: undefined, ...file }])
    expect(validateCommand(normalizeCommand(cmd), base())).toBeNull()
    // A photo without its id cannot be committed twice safely: the item is marked.
    expect(entity(content({ newItems: [plain({ photo: file })] }), 'item', 'P')!.problem).toEqual({ code: 'invalid_value' })
  })

  it('a line of a new item without axes carrying the item photo adds it once', () => {
    const file = { provider: 'imgbb', fileId: 'f1', url: 'https://i.ibb.co/f1/full.jpg' }
    const l = line('P', {}, { photo: { ...file, replace: false } })
    const cmd = build(content({ newItems: [plain({ photo: file, photoId: 'IPH' })], lines: [l] }))
    expect(cmd.photos.map((p) => p.id)).toEqual(['IPH'])
  })

  it('created names the folders, attributes, new tags and items the commit makes', () => {
    const c = content({
      newFolders: [{ id: 'A', name: ' Inductors ', parentId: 'PAS' }],
      newAttributes: [inductance],
      newTags: [{ id: 'T1', name: 'Kit A' }, { id: 'T2', name: 'smd' }],
      newItems: [inductor({ folderId: 'A', tagIds: ['T1', 'T2'] }), plain()],
      lines: [line('L1', { IND: '1µ' })],
    })
    expect(build(c).created).toEqual({
      folders: [{ id: 'A', name: 'Inductors', parentId: 'PAS' }],
      attributes: [{ id: 'IND', name: 'Inductance' }],
      tags: [{ id: 'T1', name: 'Kit A' }],
      items: [
        { id: 'L1', name: 'Inductor 0805', folderId: 'A' },
        { id: 'P', name: 'ESP32', folderId: null },
      ],
    })
  })

  it('snapshotAfterIntake holds the new folders, attributes and item descriptions; a retry adds nothing', () => {
    const s = base()
    const c = content({
      newFolders: [{ id: 'A', name: 'Inductors', parentId: 'PAS' }],
      newAttributes: [inductance],
      newItems: [inductor({ folderId: 'A', description: 'Shielded' })],
      lines: [line('L1', { IND: '1µ' })],
    })
    const cmd = build(c, s)
    const after = snapshotAfterIntake(s, cmd)
    expect(after.folders.find((f) => f.id === 'A')).toMatchObject({ name: 'Inductors', parentId: 'PAS', icon: null, archivedAt: null })
    expect(after.attributes.find((a) => a.id === 'IND')).toMatchObject({ name: 'Inductance', kind: 'number', unit: 'H', siPrefixes: true, pinned: false })
    expect(after.items.find((i) => i.id === 'L1')).toMatchObject({ folderId: 'A', description: 'Shielded', icon: null, color: null })
    const again = snapshotAfterIntake(after, cmd)
    expect(again.folders).toHaveLength(after.folders.length)
    expect(again.attributes).toHaveLength(after.attributes.length)
    // The command validates against the copy it already landed in (a retry).
    expect(validateCommand(normalizeCommand(cmd), after)).toBeNull()
  })

  it('a draft saved before draft entities resolves and commits as before', () => {
    const old = { newItems: [{ id: 'NEW', name: 'Resistor 0.6 W', folderId: null, unitKey: 'pcs', attributes: [{ attributeId: 'res', value: null, axis: true }] }], lines: [line('NEW', { res: '1k' }), line('M')] } as IntakeDraftContent
    const r = resolveIntake(old, base())
    expect(r.ok).toBe(true)
    expect(r.entities).toEqual([{ kind: 'item', id: 'NEW', problem: null }])
    const cmd = build(old)
    expect(cmd.newFolders).toEqual([])
    expect(cmd.newAttributes).toEqual([])
    expect(cmd.newItems[0]!.description).toBeNull()
    expect(cmd.photos).toEqual([])
    expect(cmd.receipts).toHaveLength(2)
    expect(cmd.created).toEqual({ folders: [], attributes: [], tags: [], items: [{ id: 'NEW', name: 'Resistor 0.6 W', folderId: null }] })
    expect(validateCommand(normalizeCommand(cmd), base())).toBeNull()
  })
})

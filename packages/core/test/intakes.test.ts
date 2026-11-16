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

  it('two lines with the same new value share one new variant', () => {
    const a = line('R', { res: '47k' })
    const b = line('R', { res: '47 kΩ' })
    const r = resolveIntake(draft([a, b]), electronics())
    expect(r.ok).toBe(true)
    expect(r.lines[0]!.resolution).toEqual({ kind: 'newValue', itemId: 'R', variantId: a.ids.variantId, sharedWith: null })
    expect(r.lines[1]!.resolution).toEqual({ kind: 'newValue', itemId: 'R', variantId: a.ids.variantId, sharedWith: a.id })
  })

  it('lines on a new item of the draft make its variants', () => {
    const lines = [line('NEW', { res: '1k' }), line('NEW', { res: '4k7' }), line('NEW', { res: '10k' })]
    const r = resolveIntake(draft(lines, [resistorItem()]), electronics())
    expect(r.ok).toBe(true)
    expect(r.lines.map((l) => l.resolution)).toEqual(lines.map((l) => ({ kind: 'newItem', itemId: 'NEW', variantId: l.ids.variantId })))
    expect(new Set(lines.map((l) => l.ids.variantId)).size).toBe(3)
  })

  it('a line on a new item without axes has no variant', () => {
    const plain: DraftNewItem = { id: 'P', name: 'ESP32', folderId: null, unitKey: 'pcs', attributes: [] }
    const r = resolveIntake(draft([line('P'), line('P')], [plain]), electronics())
    expect(r.ok).toBe(true)
    for (const l of r.lines) expect(l.resolution).toEqual({ kind: 'newItem', itemId: 'P', variantId: null })
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

  it('builds new items before their variants, shared variants once, receipts and lines per line', () => {
    const s = resistors()
    const lines = [
      line('NEW', { res: '1k' }, { totalPrice: 120, sourceUrl: 'https://lcsc.com/C1' }),
      line('NEW', { res: '1 kΩ' }),
      line('R', { res: '4k7' }),
      line('R', { res: '47k' }),
      line('R', { res: '22k' }),
    ]
    const c = build(draft(lines, [resistorItem(), { ...resistorItem('UNUSED'), name: 'Dropped' }]), {
      ...s,
      attributes: [...s.attributes, attribute('pkg', 'Package', 'enum', { options: ['0805', 'THT'] })],
    })
    expect(c).toMatchObject({ type: 'intake.commit', intakeId: 'intake1', inventoryId: 'inv', baseRev: 'rev-1', baseDraftRev: 'rev-d' })
    expect(c.header).toEqual({ shop: 'LCSC', orderNumber: 'WM2511-0042', purchasedOn: '2026-11-12', note: null })
    expect(c.newItems).toEqual([
      {
        id: 'NEW', folderId: null, name: 'Resistor 0.6 W', unitKey: 'pcs', tagIds: [],
        attributes: [
          { attributeId: 'pkg', value: 'THT', axisPosition: null },
          { attributeId: 'res', value: null, axisPosition: 0 },
        ],
      },
    ])
    expect(c.newVariants).toEqual([
      { id: lines[0]!.ids.variantId, itemId: 'NEW', values: [{ attributeId: 'res', value: '1000' }] },
      { id: lines[4]!.ids.variantId, itemId: 'R', values: [{ attributeId: 'res', value: '22000' }] },
    ])
    expect(c.unarchiveVariants).toEqual(['r47k'])
    expect(c.receipts.map((r) => [r.movementId, r.itemId, r.variantId])).toEqual([
      [lines[0]!.ids.movementId, 'NEW', lines[0]!.ids.variantId],
      [lines[1]!.ids.movementId, 'NEW', lines[0]!.ids.variantId],
      [lines[2]!.ids.movementId, 'R', 'r4k7'],
      [lines[3]!.ids.movementId, 'R', 'r47k'],
      [lines[4]!.ids.movementId, 'R', lines[4]!.ids.variantId],
    ])
    expect(c.receipts[0]).toMatchObject({ quantity: '10', totalPrice: 120, sourceUrl: 'https://lcsc.com/C1' })
    expect(c.lines.map((l) => [l.kind, l.itemName, l.variantLabel])).toEqual([
      ['newItem', 'Resistor 0.6 W', '1 kΩ'],
      ['newItem', 'Resistor 0.6 W', '1 kΩ'],
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
      line('R', { res: '47k' }, { photo }), // the same new variant: it already gets the first line's photo
      line('M', {}, { photo }),
      line('M', {}, { photo }),
    ]
    const c = build(draft(lines))
    expect(c.photos.map((p) => [p.id, p.itemId, p.variantId, p.replaces])).toEqual([
      [lines[0]!.ids.photoId, 'R', lines[0]!.ids.variantId, undefined],
      [lines[2]!.ids.photoId, 'M', null, undefined],
      [lines[3]!.ids.photoId, 'M', null, undefined],
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

  it('a new tag only a deleted line referenced is not created', () => {
    const content = {
      ...tagged(['T1'], [{ id: 'T1', name: 'Kit A' }, { id: 'T2', name: 'Kit B' }], [line('NEW'), line('M')]),
    }
    content.newItems.push({ ...resistorItem('GONE'), attributes: [], tagIds: ['T2'] })
    const c = build(content)
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

  it('pruneNewItems drops new items that no line references', () => {
    const kept = resistorItem('KEPT')
    const pruned = pruneNewItems(draft([line('KEPT', { res: '1k' }), line('M')], [kept, resistorItem('ORPHAN')]))
    expect(pruned.newItems).toEqual([kept])
    expect(pruned.lines).toHaveLength(2)
  })
})

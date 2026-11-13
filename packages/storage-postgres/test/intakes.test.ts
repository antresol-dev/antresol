import {
  buildIntakeCommit,
  newId,
  patchSnapshot,
  resolveIntake,
  StorageError,
  type Command,
  type DraftLine,
  type Id,
  type Intake,
  type IntakeDraftContent,
  type IntakeHeader,
  type InventoryStorage,
  type Quantity,
} from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { attributeCreate, itemCreate, makeStorage, normSnapshot, sizeAxis, sorted, TEST_ACTOR, variantsCreate } from './helpers'

const q = (s: string) => s as Quantity
type IntakeCommit = Extract<Command, { type: 'intake.commit' }>
const HEADER: IntakeHeader = { shop: 'LCSC', orderNumber: 'A-1', purchasedOn: '2026-11-13', note: null }

const line = (itemId: Id, axisValues: { attributeId: Id; value: string }[], quantity: string, extra: Partial<DraftLine> = {}): DraftLine => ({
  id: newId(),
  itemId,
  axisValues,
  quantity: q(quantity),
  totalPrice: null,
  sourceUrl: null,
  photo: null,
  ids: { movementId: newId(), variantId: newId(), photoId: newId() },
  ...extra,
})

async function setup() {
  const storage = await makeStorage()
  const inv = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'Lab', description: null, currency: 'EUR' }, TEST_ACTOR)
  return { storage, inv }
}

/** A capacitor with a Size axis, variant S active and L archived; an Ohm number attribute for a new item. */
async function workshop() {
  const { storage, inv } = await setup()
  const [cap, size, ohm, vS, vL] = [newId(), newId(), newId(), newId(), newId()]
  const run = (c: Command) => storage.apply(c, TEST_ACTOR)
  await run(itemCreate(inv, cap, 'Capacitor'))
  for (const c of sizeAxis(inv, cap, size)) await run(c)
  await run(variantsCreate(cap, [[vS, { [size]: 'S' }], [vL, { [size]: 'L' }]]))
  await run({ type: 'archive', target: 'variant', id: vL, archiveId: newId() })
  await run(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
  return { storage, inv, cap, size, ohm, vS, vL }
}

/** A draft that creates a resistor with an Ohm axis and three values (one line with a photo), adds to the capacitor's
 *  S and brings L back from the archive. */
function draftFor(w: Awaited<ReturnType<typeof workshop>>): IntakeDraftContent {
  const resistor = newId()
  const ohm = (value: string) => [{ attributeId: w.ohm, value }]
  return {
    newItems: [{ id: resistor, name: 'Resistor', folderId: null, unitKey: 'pcs', attributes: [{ attributeId: w.ohm, value: null, axis: true }] }],
    lines: [
      line(resistor, ohm('1000'), '100', {
        totalPrice: 120,
        sourceUrl: 'https://shop.example/r1k',
        photo: { provider: 'uploadcare', fileId: 'f1', url: 'https://u.example/f1', replace: false },
      }),
      line(resistor, ohm('4k7'), '100'),
      line(resistor, ohm('10k'), '50'),
      line(w.cap, [{ attributeId: w.size, value: 'S' }], '5'),
      line(w.cap, [{ attributeId: w.size, value: 'l' }], '2'),
    ],
  }
}

async function intakeOf(storage: InventoryStorage, inv: Id, id: Id): Promise<Intake> {
  const found = (await storage.listIntakes(inv)).intakes.find((i) => i.id === id)
  if (!found) throw new Error(`intake ${id} not listed`)
  return found
}

/** Saves the draft, then builds its commit against a fresh load. */
async function savedAndBuilt(w: Awaited<ReturnType<typeof workshop>>) {
  const id = newId()
  const content = draftFor(w)
  const saved = await w.storage.saveIntakeDraft({ id, inventoryId: w.inv, header: HEADER, content }, null, TEST_ACTOR)
  expect(saved.saved).toBe(true)
  const { snapshot, rev } = await w.storage.loadInventoryWithRev(w.inv)
  const intake = await intakeOf(w.storage, w.inv, id)
  const resolved = resolveIntake(intake.draft!, snapshot)
  expect(resolved.ok).toBe(true)
  const command = buildIntakeCommit(intake, resolved, snapshot, rev) as IntakeCommit
  return { id, content, snapshot, rev, command, resistor: content.newItems[0]!.id }
}

async function counts(storage: InventoryStorage, inv: Id) {
  const s = await storage.loadInventory(inv)
  return {
    items: s.items.length,
    variants: s.variants.length,
    photos: s.photos.length,
    movements: (await storage.loadAllMovements(inv)).length,
  }
}

describe('intake drafts', () => {
  it('saving a new draft leaves the source revision, changes intakesRev and lists the draft', async () => {
    const { storage, inv } = await setup()
    const { rev } = await storage.listInventories()
    const before = await storage.intakesRev()
    const id = newId()
    const content: IntakeDraftContent = { newItems: [], lines: [] }
    const saved = await storage.saveIntakeDraft({ id, inventoryId: inv, header: HEADER, content }, null, TEST_ACTOR)
    if (!saved.saved) throw new Error('not saved')
    expect((await storage.listInventories()).rev).toBe(rev)
    const after = await storage.intakesRev()
    expect(after).not.toBe(before)
    expect(saved.intakesRev).toBe(after)
    // What it was before the write: a device whose list was read at it may keep that list, patched (nothing else came in).
    expect(saved.previousIntakesRev).toBe(before)
    const listed = await storage.listIntakes(inv)
    expect(listed.intakesRev).toBe(after)
    expect(listed.intakes).toHaveLength(1)
    expect(listed.intakes[0]).toMatchObject({
      id,
      inventoryId: inv,
      status: 'draft',
      header: HEADER,
      draft: content,
      lines: null,
      draftRev: saved.draftRev,
      createdBy: TEST_ACTOR.device,
      updatedBy: TEST_ACTOR.device,
      committedAt: null,
    })
  })

  it('saves over the current draftRev; a stale one is refused with the current draft, force writes anyway', async () => {
    const w = await workshop()
    const id = newId()
    const draft = (content: IntakeDraftContent, header = HEADER) => ({ id, inventoryId: w.inv, header, content })
    const first = await w.storage.saveIntakeDraft(draft({ newItems: [], lines: [] }), null, TEST_ACTOR)
    if (!first.saved) throw new Error('not saved')

    const one = { newItems: [], lines: [line(w.cap, [{ attributeId: w.size, value: 'S' }], '1')] }
    const second = await w.storage.saveIntakeDraft(draft(one), first.draftRev, TEST_ACTOR)
    if (!second.saved) throw new Error('not saved')
    expect(second.draftRev).not.toBe(first.draftRev)

    // Another device saved meanwhile: this device's base is first.draftRev.
    const two = { newItems: [], lines: [line(w.cap, [{ attributeId: w.size, value: 'S' }], '2')] }
    const stale = await w.storage.saveIntakeDraft(draft(two, { ...HEADER, note: 'mine' }), first.draftRev, TEST_ACTOR)
    if (stale.saved || stale.reason !== 'changed') throw new Error('expected changed')
    expect(stale.current).toMatchObject({ id, draft: one, header: HEADER, draftRev: second.draftRev, status: 'draft' })
    expect((await intakeOf(w.storage, w.inv, id)).draft).toEqual(one)

    const forced = await w.storage.saveIntakeDraft(draft(two), first.draftRev, TEST_ACTOR, { force: true })
    if (!forced.saved) throw new Error('not saved')
    expect(forced.draftRev).not.toBe(second.draftRev)
    expect(await intakeOf(w.storage, w.inv, id)).toMatchObject({ draft: two, draftRev: forced.draftRev })
  })

  it('a save into a committed intake is refused as committed, even with force', async () => {
    const w = await workshop()
    const { id, command } = await savedAndBuilt(w)
    await w.storage.apply(command, TEST_ACTOR)
    const committed = await intakeOf(w.storage, w.inv, id)
    for (const options of [undefined, { force: true }]) {
      const r = await w.storage.saveIntakeDraft(
        { id, inventoryId: w.inv, header: HEADER, content: { newItems: [], lines: [] } },
        committed.draftRev,
        TEST_ACTOR,
        options,
      )
      expect(r).toEqual({ saved: false, reason: 'committed' })
    }
    expect(await intakeOf(w.storage, w.inv, id)).toEqual(committed)
  })

  it('deleteIntakeDraft removes a draft and leaves a committed intake', async () => {
    const w = await workshop()
    const { id: committedId, command } = await savedAndBuilt(w)
    await w.storage.apply(command, TEST_ACTOR)
    const draftId = newId()
    await w.storage.saveIntakeDraft({ id: draftId, inventoryId: w.inv, header: HEADER, content: { newItems: [], lines: [] } }, null, TEST_ACTOR)
    const { rev } = await w.storage.listInventories()
    const before = await w.storage.intakesRev()

    const deleted = await w.storage.deleteIntakeDraft(draftId)
    expect(deleted.intakesRev).not.toBe(before)
    expect(deleted.previousIntakesRev).toBe(before)
    expect(deleted.intakesRev).toBe(await w.storage.intakesRev())
    expect((await w.storage.listIntakes(w.inv)).intakes.map((i) => i.id)).toEqual([committedId])

    const kept = await w.storage.deleteIntakeDraft(committedId)
    expect(kept.intakesRev).toBe(deleted.intakesRev)
    expect((await w.storage.listIntakes(w.inv)).intakes.map((i) => i.id)).toEqual([committedId])
    expect((await w.storage.listInventories()).rev).toBe(rev)
  })

  it('updateIntakeHeader of a committed intake changes only its header, never the source revision', async () => {
    const w = await workshop()
    const { id, command } = await savedAndBuilt(w)
    await w.storage.apply(command, TEST_ACTOR)
    const committed = await intakeOf(w.storage, w.inv, id)
    const { rev } = await w.storage.listInventories()
    const header: IntakeHeader = { shop: 'Mouser', orderNumber: null, purchasedOn: '2026-11-01', note: 'late' }

    const before = await w.storage.intakesRev()
    const r = await w.storage.updateIntakeHeader(id, header, { device: 'Other' })
    expect(r.intakesRev).toBe(await w.storage.intakesRev())
    expect(r.previousIntakesRev).toBe(before)
    const updated = await intakeOf(w.storage, w.inv, id)
    expect(updated).toMatchObject({ header, status: 'committed', lines: committed.lines, draft: null, updatedBy: 'Other' })
    expect(updated.draftRev).not.toBe(committed.draftRev)
    expect(r.draftRev).toBe(updated.draftRev)
    expect(updated.committedAt).toBe(committed.committedAt)
    expect((await w.storage.listInventories()).rev).toBe(rev)
  })

  it('updateIntakeHeader of a draft returns its new draftRev: the next save over it is not a false conflict', async () => {
    const w = await workshop()
    const id = newId()
    const content = { newItems: [], lines: [line(w.cap, [{ attributeId: w.size, value: 'S' }], '1')] }
    const first = await w.storage.saveIntakeDraft({ id, inventoryId: w.inv, header: HEADER, content }, null, TEST_ACTOR)
    if (!first.saved) throw new Error('not saved')
    const header = { ...HEADER, shop: 'Mouser' }
    const r = await w.storage.updateIntakeHeader(id, header, TEST_ACTOR)
    expect(r.draftRev).not.toBe(first.draftRev)
    expect((await intakeOf(w.storage, w.inv, id)).draftRev).toBe(r.draftRev)
    const next = await w.storage.saveIntakeDraft({ id, inventoryId: w.inv, header, content: { newItems: [], lines: [] } }, r.draftRev, TEST_ACTOR)
    expect(next.saved).toBe(true)
    await expect(w.storage.updateIntakeHeader(newId(), header, TEST_ACTOR)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a save over a draft deleted on another device writes it again (the last write wins)', async () => {
    const w = await workshop()
    const id = newId()
    const empty = { newItems: [], lines: [] }
    const first = await w.storage.saveIntakeDraft({ id, inventoryId: w.inv, header: HEADER, content: empty }, null, TEST_ACTOR)
    if (!first.saved) throw new Error('not saved')
    await w.storage.deleteIntakeDraft(id)
    const content = { newItems: [], lines: [line(w.cap, [{ attributeId: w.size, value: 'S' }], '3')] }
    const again = await w.storage.saveIntakeDraft({ id, inventoryId: w.inv, header: HEADER, content }, first.draftRev, TEST_ACTOR)
    if (!again.saved) throw new Error('not saved')
    expect(await intakeOf(w.storage, w.inv, id)).toMatchObject({ status: 'draft', draft: content, draftRev: again.draftRev })
  })

  it('lists the intakes of the inventory only, newest change first', async () => {
    const { storage, inv } = await setup()
    const other = newId()
    await storage.apply({ type: 'inventory.create', id: other, name: 'Other', description: null, currency: 'EUR' }, TEST_ACTOR)
    const [a, b, c] = [newId(), newId(), newId()]
    const empty = { newItems: [], lines: [] }
    await storage.saveIntakeDraft({ id: a, inventoryId: inv, header: HEADER, content: empty }, null, TEST_ACTOR)
    await storage.saveIntakeDraft({ id: b, inventoryId: inv, header: HEADER, content: empty }, null, TEST_ACTOR)
    await storage.saveIntakeDraft({ id: c, inventoryId: other, header: HEADER, content: empty }, null, TEST_ACTOR)
    await storage.updateIntakeHeader(a, { ...HEADER, note: 'touched' }, TEST_ACTOR)
    expect((await storage.listIntakes(inv)).intakes.map((i) => i.id)).toEqual([a, b])
    expect((await storage.listIntakes(other)).intakes.map((i) => i.id)).toEqual([c])
  })
})

describe('intake.commit', () => {
  it('writes new items, variants, unarchived variants, photos and receipts marked with the intake, in one write', async () => {
    const w = await workshop()
    const { id, command, snapshot, rev, resistor } = await savedAndBuilt(w)
    const intakesBefore = await w.storage.intakesRev()

    const r = await w.storage.apply(command, TEST_ACTOR)

    expect(r.prevRev).toBe(rev)
    const after = await w.storage.loadInventory(w.inv)
    expect(after.items.find((i) => i.id === resistor)).toMatchObject({ name: 'Resistor', unitKey: 'pcs', archivedAt: null })
    const variants = after.variants.filter((v) => v.itemId === resistor)
    expect(variants).toHaveLength(3)
    const values = after.variantAttributeValues.filter((x) => variants.some((v) => v.id === x.variantId)).map((x) => x.value)
    expect(values.sort()).toEqual(['1000', '10000', '4700'])
    expect(after.itemAttributes.find((x) => x.itemId === resistor)).toEqual({ itemId: resistor, attributeId: w.ohm, value: null, axisPosition: 0 })
    expect(after.variants.find((v) => v.id === w.vL)).toMatchObject({ archivedAt: null, archiveId: null })
    expect(after.stock.find((l) => l.variantId === w.vS)?.quantity).toBe('5')
    expect(after.stock.find((l) => l.variantId === w.vL)?.quantity).toBe('2')
    expect(after.photos).toEqual([expect.objectContaining({ itemId: resistor, variantId: command.photos[0]!.variantId, fileId: 'f1' })])

    const journal = (await w.storage.loadAllMovements(w.inv)).filter((m) => m.intakeId === id)
    expect(journal).toHaveLength(5)
    expect(journal.every((m) => m.kind === 'receipt')).toBe(true)
    expect(journal.find((m) => m.sourceUrl === 'https://shop.example/r1k')).toMatchObject({ totalPrice: 120, quantity: '100' })
    expect((await w.storage.loadMovements(w.cap)).every((m) => m.intakeId === id)).toBe(true)

    const intake = await intakeOf(w.storage, w.inv, id)
    expect(intake).toMatchObject({ status: 'committed', draft: null, header: HEADER })
    expect(intake.lines).toEqual(command.lines)
    expect(intake.committedAt).not.toBeNull()
    expect(await w.storage.intakesRev()).not.toBe(intakesBefore)

    // One patch over both items, equal to a fresh load.
    expect(sorted(r.patch!.itemIds, (x) => x)).toEqual(sorted([resistor, w.cap], (x) => x))
    expect(normSnapshot(patchSnapshot(snapshot, r.patch!))).toEqual(normSnapshot(after))
  })

  it('a retry after the revision moved on succeeds and adds nothing (Review Focus 1)', async () => {
    const w = await workshop()
    const { id, command } = await savedAndBuilt(w)
    await w.storage.apply(command, TEST_ACTOR)
    await w.storage.apply({ type: 'folder.create', id: newId(), inventoryId: w.inv, parentId: null, name: 'Shelf', description: null }, TEST_ACTOR)
    const before = await counts(w.storage, w.inv)
    const intake = await intakeOf(w.storage, w.inv, id)
    const intakesRev = await w.storage.intakesRev()

    const r = await w.storage.apply(command, TEST_ACTOR)

    expect(r.patch).not.toBeNull()
    expect(await counts(w.storage, w.inv)).toEqual(before)
    expect(await intakeOf(w.storage, w.inv, id)).toEqual(intake)
    expect(await w.storage.intakesRev()).toBe(intakesRev)
  })

  it('a stale baseRev is refused as a conflict while the intake is a draft; nothing is written', async () => {
    const w = await workshop()
    const { id, command } = await savedAndBuilt(w)
    await w.storage.apply({ type: 'folder.create', id: newId(), inventoryId: w.inv, parentId: null, name: 'Shelf', description: null }, TEST_ACTOR)
    const before = await counts(w.storage, w.inv)
    const { rev } = await w.storage.listInventories()
    const intake = await intakeOf(w.storage, w.inv, id)
    const intakesRev = await w.storage.intakesRev()

    const error = await w.storage.apply(command, TEST_ACTOR).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).code).toBe('conflict')
    expect(await counts(w.storage, w.inv)).toEqual(before)
    expect((await w.storage.listInventories()).rev).toBe(rev)
    expect(await intakeOf(w.storage, w.inv, id)).toEqual(intake)
    expect(await w.storage.intakesRev()).toBe(intakesRev)
  })

  it('a draft saved again after the commit was built is refused as a conflict; nothing is written', async () => {
    const w = await workshop()
    const { id, content, command } = await savedAndBuilt(w)
    const built = await intakeOf(w.storage, w.inv, id)
    // Another device saves the draft (e.g. one more line) after this device built its commit.
    const newer = { ...content, lines: [...content.lines, line(w.cap, [{ attributeId: w.size, value: 'S' }], '1')] }
    const saved = await w.storage.saveIntakeDraft({ id, inventoryId: w.inv, header: HEADER, content: newer }, built.draftRev, { device: 'Other' })
    if (!saved.saved) throw new Error('not saved')
    const before = await counts(w.storage, w.inv)
    const { rev } = await w.storage.listInventories()
    const intake = await intakeOf(w.storage, w.inv, id)
    const intakesRev = await w.storage.intakesRev()

    const error = await w.storage.apply(command, TEST_ACTOR).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).code).toBe('conflict')
    expect(await counts(w.storage, w.inv)).toEqual(before)
    expect((await w.storage.listInventories()).rev).toBe(rev)
    expect(await intakeOf(w.storage, w.inv, id)).toEqual(intake)
    expect(intake.draft).toEqual(newer)
    expect(await w.storage.intakesRev()).toBe(intakesRev)
  })

  it('a committed intake goes with its inventory when the inventory is deleted', async () => {
    const w = await workshop()
    const { command } = await savedAndBuilt(w)
    await w.storage.apply(command, TEST_ACTOR)
    await w.storage.apply({ type: 'archive', target: 'inventory', id: w.inv, archiveId: newId() }, TEST_ACTOR)
    await w.storage.apply({ type: 'deletePermanently', target: 'inventory', id: w.inv }, TEST_ACTOR)
    expect((await w.storage.listInventories()).inventories).toEqual([])
    expect((await w.storage.listIntakes(w.inv)).intakes).toEqual([])
  })
})

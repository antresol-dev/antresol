import {
  buildIntakeCommit,
  customUnitKey,
  newId,
  resolveIntake,
  type Command,
  type DraftLine,
  type Id,
  type InventorySnapshot,
  type InventoryStorage,
  type Quantity,
} from '@antresol/core'
import { attributeCreate, RENDITION_FIELDS, TEST_ACTOR, variantsCreate } from './helpers'

const q = (s: string) => s as Quantity

/** Every kind of row and reference the schema has, and text an array literal must quote (commas, quotes, braces,
 *  backslashes, 'NULL', an empty option): nested and archived folders, tags, list/number/pinned attributes, a
 *  custom unit used by an item, axes and variants (one archived), shared values, photos of an item and of a variant (that
 *  one with renditions, size and delete handle), every movement kind including a transfer, an archived item and a folder
 *  archived with its item. */
export async function seedRich(storage: InventoryStorage, name = 'Workshop'): Promise<Id> {
  const run = (c: Command) => storage.apply(c, TEST_ACTOR)
  const inv = newId()
  const [a, b, c, d] = [newId(), newId(), newId(), newId()]
  const [t1, t2] = [newId(), newId()]
  const [text, size, ohm, unit] = [newId(), newId(), newId(), newId()]
  const [resistor, wire, old, boxed] = [newId(), newId(), newId(), newId()]
  const [v1, v2, v3] = [newId(), newId(), newId()]
  await run({ type: 'inventory.create', id: inv, name, description: 'Garage', currency: 'EUR' })
  await run({ type: 'folder.create', id: a, inventoryId: inv, parentId: null, name: 'A', description: null })
  await run({ type: 'folder.create', id: b, inventoryId: inv, parentId: a, name: 'B, "inner" {x} \\ ü', description: 'NULL' })
  await run({ type: 'folder.create', id: c, inventoryId: inv, parentId: b, name: 'C', description: null })
  await run({ type: 'folder.create', id: d, inventoryId: inv, parentId: null, name: 'D', description: null })
  await run({ type: 'tag.create', id: t1, inventoryId: inv, name: 'smd' })
  await run({ type: 'tag.create', id: t2, inventoryId: inv, name: 'tht' })
  await run(attributeCreate(inv, text, 'Package'))
  await run(attributeCreate(inv, size, 'Size', 'enum', { options: ['S', 'M', 'L', 'XL, "wide" {x} \\', ''] }))
  await run(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
  await run({ type: 'attribute.update', id: ohm, pinned: true })
  await run({ type: 'unit.create', id: unit, inventoryId: inv, name: 'Metre', symbol: 'm', prefixPowers: [-3, 3] })
  await run({
    type: 'item.create', id: resistor, inventoryId: inv, folderId: c, name: 'Resistor', description: '0.25 W\nline two', unitKey: 'pcs',
    tagIds: [t1, t2], initialReceipt: null,
  })
  await run({ type: 'item.setAttribute', itemId: resistor, attributeId: text, value: '0603' })
  await run({ type: 'item.addAxis', itemId: resistor, attributeId: ohm, firstVariantId: newId() })
  await run({ type: 'item.addAxis', itemId: resistor, attributeId: size, firstVariantId: newId() })
  await run(variantsCreate(resistor, [[v1, { [ohm]: '1000', [size]: 'S' }], [v2, { [ohm]: '4700', [size]: 'M' }], [v3, { [ohm]: '10000', [size]: 'L' }]]))
  await run({ type: 'variant.update', id: v2, description: '1 %' })
  await run({
    type: 'item.create', id: wire, inventoryId: inv, folderId: a, name: 'Wire', description: null, unitKey: customUnitKey(unit),
    tagIds: [t2], initialReceipt: { movementId: newId(), quantity: q('12.5'), totalPrice: 990, sourceUrl: 'https://shop.example/w' },
  })
  await run({ type: 'item.create', id: old, inventoryId: inv, folderId: null, name: 'Old', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null })
  await run({ type: 'item.create', id: boxed, inventoryId: inv, folderId: d, name: 'Boxed', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null })
  await run({ type: 'stock.receive', movementId: newId(), itemId: resistor, variantId: v1, quantity: q('100'), totalPrice: 230, sourceUrl: null, note: 'lot 1' })
  await run({ type: 'stock.receive', movementId: newId(), itemId: resistor, variantId: v1, quantity: q('50'), totalPrice: 150, sourceUrl: null, note: null })
  await run({ type: 'stock.use', movementId: newId(), itemId: resistor, variantId: v1, quantity: q('4'), note: 'VCO' })
  await run({ type: 'stock.return', movementId: newId(), itemId: resistor, variantId: v1, quantity: q('1'), note: null })
  await run({ type: 'stock.set', movementId: newId(), itemId: resistor, variantId: v1, target: q('120'), note: 'counted' })
  await run({
    type: 'stock.transfer', transferId: newId(), outMovementId: newId(), inMovementId: newId(), itemId: resistor,
    fromVariantId: v1, toVariantId: v2, quantity: q('20'),
  })
  await run({ type: 'stock.use', movementId: newId(), itemId: wire, variantId: null, quantity: q('0.75'), note: null })
  await run({ type: 'stock.receive', movementId: newId(), itemId: old, variantId: null, quantity: q('3'), totalPrice: null, sourceUrl: null, note: null })
  await run({ type: 'photo.add', id: newId(), itemId: resistor, variantId: null, provider: 'uploadcare', fileId: 'f1', url: 'https://u.example/f1' })
  await run({ type: 'photo.add', id: newId(), itemId: resistor, variantId: v2, provider: 'imgbb', fileId: 'f2', url: 'https://i.ibb.co/abc/full.jpg', ...RENDITION_FIELDS })
  await run({ type: 'archive', target: 'variant', id: v3, archiveId: newId() })
  await run({ type: 'archive', target: 'item', id: old, archiveId: newId() })
  await run({ type: 'archive', target: 'folder', id: d, archiveId: newId() })
  await seedIntakes(storage, inv, { folder: c, unit, ohm, size, resistor, wire, v1, v2 })
  return inv
}

const draftLine = (itemId: Id, axisValues: { attributeId: Id; value: string }[], quantity: string, extra: Partial<DraftLine> = {}): DraftLine => ({
  id: newId(), itemId, axisValues, quantity: q(quantity), totalPrice: null, sourceUrl: null, photo: null,
  ids: { movementId: newId(), variantId: newId(), photoId: newId() }, ...extra,
})

/** A committed intake (a new item with a custom unit, an existing variant, a new value, an item without axes, a photo) and
 *  a draft that still holds its own new item. */
async function seedIntakes(
  storage: InventoryStorage,
  inv: Id,
  x: { folder: Id; unit: Id; ohm: Id; size: Id; resistor: Id; wire: Id; v1: Id; v2: Id },
): Promise<void> {
  const header = { shop: 'LCSC, "x" {y}', orderNumber: 'A-1', purchasedOn: '2026-11-13', note: 'NULL' }
  const fresh = newId()
  const [committed, draft] = [newId(), newId()]
  const ohm = (value: string) => [{ attributeId: x.ohm, value }]
  const content = {
    newItems: [{ id: fresh, name: 'Capacitor', folderId: x.folder, unitKey: customUnitKey(x.unit), attributes: [{ attributeId: x.ohm, value: null, axis: true }] }],
    lines: [
      draftLine(fresh, ohm('100'), '5', { totalPrice: 500, photo: { provider: 'imgbb', fileId: 'f9', url: 'https://i.ibb.co/abc/full.jpg', ...RENDITION_FIELDS, replace: false } }),
      draftLine(x.resistor, [...ohm('1000'), { attributeId: x.size, value: 'S' }], '10', { totalPrice: 100, sourceUrl: 'https://shop.example/r' }),
      draftLine(x.resistor, [...ohm('2200'), { attributeId: x.size, value: 'M' }], '3'),
      draftLine(x.wire, [], '2.5'),
    ],
  }
  const saved = await storage.saveIntakeDraft({ id: committed, inventoryId: inv, header, content }, null, TEST_ACTOR)
  if (!saved.saved) throw new Error('seed: draft not saved')
  const { snapshot, rev } = await storage.loadInventoryWithRev(inv)
  const intake = (await storage.listIntakes(inv)).intakes.find((i) => i.id === committed)!
  const resolved = resolveIntake(intake.draft!, snapshot)
  if (!resolved.ok) throw new Error('seed: intake does not resolve')
  await storage.apply(buildIntakeCommit(intake, resolved, snapshot, rev), TEST_ACTOR)

  const later = newId()
  const open = {
    newItems: [{ id: later, name: 'Inductor', folderId: x.folder, unitKey: customUnitKey(x.unit), attributes: [] }],
    lines: [draftLine(later, [], '7'), draftLine(x.resistor, [...ohm('4700'), { attributeId: x.size, value: 'M' }], '1', { totalPrice: null })],
  }
  const second = await storage.saveIntakeDraft({ id: draft, inventoryId: inv, header: { ...header, shop: null, note: null }, content: open }, null, TEST_ACTOR)
  if (!second.saved) throw new Error('seed: second draft not saved')
}

/** The snapshot with every id and reference renamed by `m` (null stays null), as the new-ids restore should give it. */
export function renamed(s: InventorySnapshot, m: (id: Id) => Id): InventorySnapshot {
  const opt = (id: Id | null) => (id === null ? null : m(id))
  const unitKey = (key: string) => (key.startsWith('custom:') ? customUnitKey(m(key.slice('custom:'.length))) : key)
  return {
    inventory: { ...s.inventory, id: m(s.inventory.id), archiveId: opt(s.inventory.archiveId) },
    folders: s.folders.map((f) => ({ ...f, id: m(f.id), inventoryId: m(f.inventoryId), parentId: opt(f.parentId), archiveId: opt(f.archiveId) })),
    items: s.items.map((i) => ({
      ...i, id: m(i.id), inventoryId: m(i.inventoryId), folderId: opt(i.folderId), unitKey: unitKey(i.unitKey),
      tagIds: i.tagIds.map(m).sort(), archiveId: opt(i.archiveId),
    })),
    variants: s.variants.map((v) => ({ ...v, id: m(v.id), itemId: m(v.itemId), archiveId: opt(v.archiveId) })),
    tags: s.tags.map((t) => ({ ...t, id: m(t.id), inventoryId: m(t.inventoryId) })),
    attributes: s.attributes.map((a) => ({ ...a, id: m(a.id), inventoryId: m(a.inventoryId) })),
    units: s.units.map((u) => ({ ...u, id: m(u.id), inventoryId: m(u.inventoryId) })),
    itemAttributes: s.itemAttributes.map((r) => ({ ...r, itemId: m(r.itemId), attributeId: m(r.attributeId) })),
    variantAttributeValues: s.variantAttributeValues.map((r) => ({ ...r, variantId: m(r.variantId), attributeId: m(r.attributeId) })),
    photos: s.photos.map((p) => ({ ...p, id: m(p.id), itemId: m(p.itemId), variantId: opt(p.variantId) })),
    stock: s.stock.map((l) => ({ ...l, itemId: m(l.itemId), variantId: opt(l.variantId) })),
  }
}

import { PGlite } from '@electric-sql/pglite'
import {
  cmpQ,
  customUnitKey,
  itemAxes,
  newId,
  normalizeCommand,
  patchSnapshot,
  StorageError,
  validateCommand,
  type Actor,
  type ApplyResult,
  type Attribute,
  type Command,
  type Id,
  type InventorySnapshot,
  type InventoryStorage,
  type Quantity,
} from '@graymatter/core'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PgExecutor } from '../src/executor'
import { createPgliteExecutor } from '../src/executors/pglite'
import { openPostgresStorage } from '../src/storage'
import { attributeCreate, normSnapshot as norm, sliceOf, sorted, TEST_ACTOR, variantsCreate } from './helpers'

// One database for the file: every run of the property seeds an inventory of its own (inventories are independent).
let exec: PgExecutor
let storage: InventoryStorage
beforeAll(async () => {
  exec = createPgliteExecutor(new PGlite())
  storage = (await openPostgresStorage(exec)).storage
})
afterAll(async () => {
  await exec.close()
})

type Snap = InventorySnapshot

const byId = (row: { id: Id }) => row.id

// ---- the seeded inventory ----

/** 2 folders, a tag, a custom unit nobody uses yet, four attributes (list, two numbers, text) and 3 items: one with a
 *  number axis and two variants (and stock), one with two axes and two variants, one with shared values only. */
async function seed(): Promise<{ inv: Id; items: Id[] }> {
  const inv = newId()
  const [shelf, box, tag, unit] = [newId(), newId(), newId(), newId()]
  const [color, ohm, volt, size] = [newId(), newId(), newId(), newId()]
  const items = [newId(), newId(), newId()]
  const item = (id: Id, name: string, folderId: Id | null, extra: Partial<Extract<Command, { type: 'item.create' }>>) =>
    ({
      type: 'item.create', id, inventoryId: inv, folderId, name, description: null, unitKey: 'pcs', tagIds: [],
      initialReceipt: null, ...extra,
    }) satisfies Command
  const axis = (itemId: Id, attributeId: Id): Command => ({ type: 'item.addAxis', itemId, attributeId, firstVariantId: newId() })
  const commands: Command[] = [
    { type: 'inventory.create', id: inv, name: 'Workshop', description: null, currency: 'USD' },
    { type: 'folder.create', id: shelf, inventoryId: inv, parentId: null, name: 'Shelf', description: null },
    { type: 'folder.create', id: box, inventoryId: inv, parentId: shelf, name: 'Box', description: 'Blue box' },
    { type: 'tag.create', id: tag, inventoryId: inv, name: 'fragile' },
    attributeCreate(inv, color, 'Color', 'enum', { options: ['red', 'blue'] }),
    attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }),
    attributeCreate(inv, volt, 'Voltage', 'number', { unit: 'V' }),
    attributeCreate(inv, size, 'Size'),
    { type: 'unit.create', id: unit, inventoryId: inv, name: 'Roll', symbol: 'roll', prefixPowers: [] },
    item(items[0]!, 'Resistor', shelf, {
      tagIds: [tag],
      initialReceipt: { movementId: newId(), quantity: '10', totalPrice: 500, sourceUrl: null },
    }),
    item(items[1]!, 'Cable', box, { unitKey: 'm' }),
    item(items[2]!, 'Glue', null, { description: 'Two-part' }),
    axis(items[0]!, ohm),
    variantsCreate(items[0]!, [[newId(), { [ohm]: '1000' }], [newId(), { [ohm]: '10000' }]]),
    axis(items[1]!, size),
    axis(items[1]!, color),
    variantsCreate(items[1]!, [[newId(), { [size]: 'S', [color]: 'red' }], [newId(), { [size]: 'M', [color]: 'blue' }]]),
    { type: 'item.setAttribute', itemId: items[2]!, attributeId: volt, value: '12' },
    { type: 'item.setAttribute', itemId: items[2]!, attributeId: color, value: 'blue' },
  ]
  for (const c of commands) await storage.apply(c, TEST_ACTOR)
  return { inv, items }
}

// ---- the command generator ----

/** Turns the numbers generated for one step into choices. Each choice is `n % options`, so shrinking toward 0 picks the
 *  first option (null first where null is allowed). */
class Picks {
  private next = 0
  constructor(private readonly numbers: readonly number[]) {}
  nat(options: number): number {
    const n = this.numbers[this.next++ % this.numbers.length] ?? 0
    return options > 0 ? n % options : 0
  }
  bool(): boolean {
    return this.nat(2) === 1
  }
  one<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error('nothing to pick from: the generator is not ready')
    return xs[this.nat(xs.length)]!
  }
  oneOrNull<T>(xs: readonly T[]): T | null {
    const i = this.nat(xs.length + 1)
    return i === 0 ? null : xs[i - 1]!
  }
  maybe<T>(value: () => T): T | undefined {
    return this.bool() ? value() : undefined
  }
  some<T>(xs: readonly T[]): T[] {
    return xs.filter(() => this.bool())
  }
}

// Value pools. Some values are invalid on purpose (an empty name, a duplicate, a foreign enum option): validateCommand
// rejects them and the step is skipped, as the app would.
const NAMES = ['Shelf', 'Box', 'box', ' Drawer ', 'Bin', '']
const DESCRIPTIONS = [null, 'Top shelf', '  ']
const CURRENCIES = ['USD', 'EUR', 'JPY']
const QUANTITIES: Quantity[] = ['1', '2', '0.5', '3.25', '0.000001', '12']
const PRICES = [null, 0, 150, 1999]
const URLS = [null, 'https://shop.example/p/1']
const NOTES = [null, 'restock']
const TEXT_VALUES = ['blue', '42', 'S', ' Red ', 'red']
/** Canonical numbers, and one ('4.7k') that only a client parses: validateCommand rejects it. */
const NUMBER_VALUES = ['1000', '4700', '10000', '0.0000001', '50', '-40', '4.7k']
const UNITS = ['', 'Ω', 'V', 'mm']
const PREFIXES = [[], [3], [-3, 3], [-6, -3]]
const BUILTIN_UNIT_KEYS = ['pcs', 'm', 'g', 'l']

const ids = (rows: { id: Id }[]) => rows.map(byId)
const variantIdsOf = (s: Snap, itemId: Id) => ids(s.variants.filter((v) => v.itemId === itemId))
const positiveStock = (s: Snap) => s.stock.filter((l) => cmpQ(l.quantity, '0') > 0)
/** Positive stock lines whose item has another bucket to move into. */
const transferable = (s: Snap) => positiveStock(s).filter((l) => variantIdsOf(s, l.itemId).length > 0)
const archiveIds = (s: Snap): Id[] => {
  const rows = [s.inventory, ...s.folders, ...s.items, ...s.variants]
  return [...new Set(rows.map((r) => r.archiveId).filter((id): id is Id => id !== null))]
}
const archived = <T extends { archivedAt: string | null }>(rows: T[]) => rows.filter((r) => r.archivedAt !== null)
/** Values that fit the attribute's kind, and one that does not (a foreign option, a number only a client parses). */
const valuesFor = (a: Attribute): string[] =>
  a.kind === 'enum' ? [...a.options, 'purple'] : a.kind === 'number' ? NUMBER_VALUES : TEXT_VALUES
const axisRows = (s: Snap) => s.itemAttributes.filter((r) => r.axisPosition !== null)
const itemsWithAxes = (s: Snap) => [...new Set(axisRows(s).map((r) => r.itemId))]

/** A stock bucket of a random item: the item itself or one of its variants. */
function bucket(s: Snap, p: Picks): { itemId: Id; variantId: Id | null } {
  const itemId = p.one(ids(s.items))
  return { itemId, variantId: p.oneOrNull(variantIdsOf(s, itemId)) }
}

function unitKey(s: Snap, p: Picks): string {
  return s.units.length > 0 && p.bool() ? customUnitKey(p.one(ids(s.units))) : p.one(BUILTIN_UNIT_KEYS)
}

/** A target kind and id for archive / deletePermanently, the inventory itself being the rarest. */
function target(
  p: Picks,
  inventory: Id[],
  rest: { folder: Id[]; item: Id[]; variant: Id[] },
): { target: 'inventory' | 'folder' | 'item' | 'variant'; id: Id } {
  const kinds = (['folder', 'item', 'variant'] as const).filter((k) => rest[k].length > 0)
  const options = [...kinds, ...kinds, ...kinds, ...(inventory.length > 0 ? (['inventory'] as const) : [])]
  const kind = p.one(options)
  return { target: kind, id: p.one(kind === 'inventory' ? inventory : rest[kind]) }
}

interface Generator {
  weight: number
  /** False when the snapshot has nothing for the command to work on. */
  ready?: (s: Snap) => boolean
  build: (s: Snap, p: Picks) => Command
}

const has = (key: 'folders' | 'items' | 'variants' | 'tags' | 'attributes' | 'units' | 'photos') => (s: Snap) =>
  s[key].length > 0

/** One generator per command type: the keys are every `Command['type']`, so a new command type does not compile until
 *  it is generated here, and the coverage check below lists any type no run applied. */
const GENERATORS: Record<Command['type'], Generator> = {
  'inventory.create': {
    weight: 1,
    build: (_, p) => ({
      type: 'inventory.create', id: newId(), name: p.one(NAMES), description: p.one(DESCRIPTIONS),
      currency: p.one(CURRENCIES),
    }),
  },
  'inventory.update': {
    weight: 2,
    build: (s, p) => ({
      type: 'inventory.update', id: s.inventory.id, name: p.maybe(() => p.one(NAMES)),
      description: p.maybe(() => p.one(DESCRIPTIONS)),
    }),
  },
  'folder.create': {
    weight: 2,
    build: (s, p) => ({
      type: 'folder.create', id: newId(), inventoryId: s.inventory.id, parentId: p.oneOrNull(ids(s.folders)),
      name: p.one(NAMES), description: p.one(DESCRIPTIONS),
    }),
  },
  'folder.update': {
    weight: 2,
    ready: has('folders'),
    build: (s, p) => ({
      type: 'folder.update', id: p.one(ids(s.folders)), name: p.maybe(() => p.one(NAMES)),
      description: p.maybe(() => p.one(DESCRIPTIONS)),
    }),
  },
  'folder.move': {
    weight: 2,
    ready: has('folders'),
    build: (s, p) => ({ type: 'folder.move', id: p.one(ids(s.folders)), parentId: p.oneOrNull(ids(s.folders)) }),
  },
  'item.create': {
    weight: 2,
    build: (s, p) => ({
      type: 'item.create',
      id: newId(),
      inventoryId: s.inventory.id,
      folderId: p.oneOrNull(ids(s.folders)),
      name: p.one(NAMES),
      description: p.one(DESCRIPTIONS),
      unitKey: unitKey(s, p),
      tagIds: p.some(ids(s.tags)),
      initialReceipt: p.bool()
        ? { movementId: newId(), quantity: p.one(QUANTITIES), totalPrice: p.one(PRICES), sourceUrl: p.one(URLS) }
        : null,
    }),
  },
  'item.update': {
    weight: 2,
    ready: has('items'),
    build: (s, p) => ({
      type: 'item.update',
      id: p.one(ids(s.items)),
      name: p.maybe(() => p.one(NAMES)),
      description: p.maybe(() => p.one(DESCRIPTIONS)),
      folderId: p.maybe(() => p.oneOrNull(ids(s.folders))),
      unitKey: p.maybe(() => unitKey(s, p)),
      tagIds: p.maybe(() => p.some(ids(s.tags))),
    }),
  },
  'item.setAttribute': {
    weight: 2,
    ready: (s) => s.items.length > 0 && s.attributes.length > 0,
    build: (s, p) => {
      const attribute = p.one(s.attributes)
      return {
        type: 'item.setAttribute', itemId: p.one(ids(s.items)), attributeId: attribute.id,
        value: p.oneOrNull(valuesFor(attribute)),
      }
    },
  },
  'item.removeAttribute': {
    weight: 2,
    ready: (s) => s.items.length > 0 && s.attributes.length > 0,
    build: (s, p) => {
      // Mostly an attribute the item has, shared or an axis, so the delete removes something.
      const row = s.itemAttributes.length > 0 && p.bool() ? p.one(s.itemAttributes) : null
      return {
        type: 'item.removeAttribute',
        itemId: row?.itemId ?? p.one(ids(s.items)),
        attributeId: row?.attributeId ?? p.one(ids(s.attributes)),
      }
    },
  },
  'item.addAxis': {
    weight: 3,
    ready: (s) => s.items.length > 0 && s.attributes.length > 0,
    build: (s, p) => {
      // Mostly a shared attribute the item has, so its value moves to the variants or becomes the first variant.
      const shared = s.itemAttributes.filter((r) => r.axisPosition === null)
      const row = shared.length > 0 && p.bool() ? p.one(shared) : null
      return {
        type: 'item.addAxis',
        itemId: row?.itemId ?? p.one(ids(s.items)),
        attributeId: row?.attributeId ?? p.one(ids(s.attributes)),
        firstVariantId: newId(),
      }
    },
  },
  'item.removeAxis': {
    weight: 3,
    ready: (s) => axisRows(s).length > 0,
    build: (s, p) => {
      const row = p.one(axisRows(s))
      return { type: 'item.removeAxis', itemId: row.itemId, attributeId: row.attributeId }
    },
  },
  'item.reorderAxes': {
    weight: 2,
    ready: (s) => itemsWithAxes(s).length > 0,
    build: (s, p) => {
      const itemId = p.one(itemsWithAxes(s))
      const axes = ids(itemAxes(s, itemId))
      const at = p.nat(axes.length)
      const rotated = [...axes.slice(at), ...axes.slice(0, at)]
      return { type: 'item.reorderAxes', itemId, attributeIds: p.bool() ? rotated.reverse() : rotated }
    },
  },
  'variant.createMany': {
    weight: 3,
    ready: has('items'),
    build: (s, p) => {
      // Mostly an item with axes; one without is refused (axis_required).
      const withAxes = itemsWithAxes(s)
      const itemId = withAxes.length > 0 && p.nat(4) > 0 ? p.one(withAxes) : p.one(ids(s.items))
      const axes = itemAxes(s, itemId)
      return variantsCreate(
        itemId,
        Array.from({ length: 1 + p.nat(2) }, () => [
          newId(),
          Object.fromEntries(axes.map((a) => [a.id, p.one(valuesFor(a))])),
        ]),
      )
    },
  },
  'variant.update': {
    weight: 2,
    ready: has('variants'),
    build: (s, p) => ({ type: 'variant.update', id: p.one(ids(s.variants)), description: p.one(DESCRIPTIONS) }),
  },
  'variant.setAttribute': {
    weight: 3,
    ready: (s) => s.variants.length > 0 && s.attributes.length > 0,
    build: (s, p) => {
      const variant = p.one(s.variants)
      // Mostly an axis of the variant's item; any other attribute is refused (not_an_axis). Null erases the value.
      const axes = itemAxes(s, variant.itemId)
      const attribute = axes.length > 0 && p.nat(4) > 0 ? p.one(axes) : p.one(s.attributes)
      return {
        type: 'variant.setAttribute', variantId: variant.id, attributeId: attribute.id,
        value: p.oneOrNull(valuesFor(attribute)),
      }
    },
  },
  'tag.create': {
    weight: 2,
    build: (s, p) => ({ type: 'tag.create', id: newId(), inventoryId: s.inventory.id, name: p.one(NAMES) }),
  },
  'tag.rename': {
    weight: 2,
    ready: has('tags'),
    build: (s, p) => ({ type: 'tag.rename', id: p.one(ids(s.tags)), name: p.one(NAMES) }),
  },
  'tag.delete': { weight: 1, ready: has('tags'), build: (s, p) => ({ type: 'tag.delete', id: p.one(ids(s.tags)) }) },
  'attribute.create': {
    weight: 2,
    build: (s, p) => {
      const kind = p.one(['text', 'enum', 'number'] as const)
      return attributeCreate(s.inventory.id, newId(), p.one(NAMES), kind, {
        options: kind === 'enum' ? p.one([['red', 'blue'], ['S', 'M', 'L']]) : [],
        unit: kind === 'number' ? p.one(UNITS) : '',
        siPrefixes: kind === 'number' && p.bool(),
      })
    },
  },
  'attribute.update': {
    weight: 2,
    ready: has('attributes'),
    build: (s, p) => {
      const attribute = p.one(s.attributes)
      return {
        type: 'attribute.update', id: attribute.id, name: p.maybe(() => p.one(NAMES)),
        options: attribute.kind === 'enum' ? p.maybe(() => p.one([['red', 'blue', 'green'], ['blue']])) : undefined,
        unit: attribute.kind === 'number' ? p.maybe(() => p.one(UNITS)) : undefined,
        siPrefixes: attribute.kind === 'number' ? p.maybe(() => p.bool()) : undefined,
      }
    },
  },
  'attribute.delete': {
    weight: 1,
    ready: has('attributes'),
    build: (s, p) => ({ type: 'attribute.delete', id: p.one(ids(s.attributes)) }),
  },
  'unit.create': {
    weight: 2,
    build: (s, p) => ({
      type: 'unit.create', id: newId(), inventoryId: s.inventory.id, name: p.one(NAMES), symbol: p.one(['roll', 'pk']),
      prefixPowers: p.one(PREFIXES),
    }),
  },
  'unit.update': {
    weight: 2,
    ready: has('units'),
    build: (s, p) => ({
      type: 'unit.update', id: p.one(ids(s.units)), name: p.maybe(() => p.one(NAMES)),
      symbol: p.maybe(() => p.one(['roll', 'pk'])), prefixPowers: p.maybe(() => p.one(PREFIXES)),
    }),
  },
  'unit.delete': { weight: 1, ready: has('units'), build: (s, p) => ({ type: 'unit.delete', id: p.one(ids(s.units)) }) },
  'stock.receive': {
    weight: 3,
    ready: has('items'),
    build: (s, p) => ({
      type: 'stock.receive', movementId: newId(), ...bucket(s, p), quantity: p.one(QUANTITIES),
      totalPrice: p.one(PRICES), sourceUrl: p.one(URLS), note: p.one(NOTES),
    }),
  },
  'stock.use': {
    weight: 3,
    ready: (s) => positiveStock(s).length > 0,
    build: (s, p) => {
      const line = p.one(positiveStock(s))
      return {
        type: 'stock.use', movementId: newId(), itemId: line.itemId, variantId: line.variantId,
        quantity: p.bool() ? line.quantity : p.one(QUANTITIES), note: p.one(NOTES),
      }
    },
  },
  'stock.return': {
    weight: 2,
    ready: has('items'),
    build: (s, p) => ({
      type: 'stock.return', movementId: newId(), ...bucket(s, p), quantity: p.one(QUANTITIES), note: p.one(NOTES),
    }),
  },
  'stock.set': {
    weight: 2,
    ready: has('items'),
    build: (s, p) => ({
      type: 'stock.set', movementId: newId(), ...bucket(s, p), target: p.one(['0', '1', '5', '2.5']),
      note: p.one(NOTES),
    }),
  },
  'stock.transfer': {
    weight: 2,
    ready: (s) => transferable(s).length > 0,
    build: (s, p) => {
      const from = p.one(transferable(s))
      const others = [null, ...variantIdsOf(s, from.itemId)].filter((v) => v !== from.variantId)
      return {
        type: 'stock.transfer', transferId: newId(), outMovementId: newId(), inMovementId: newId(),
        itemId: from.itemId, fromVariantId: from.variantId, toVariantId: p.one(others),
        quantity: p.bool() ? from.quantity : p.one(QUANTITIES),
      }
    },
  },
  'photo.add': {
    weight: 4,
    ready: has('items'),
    build: (s, p) => {
      const id = newId()
      return {
        type: 'photo.add', id, ...bucket(s, p), provider: 'imgbb', fileId: id, url: `https://i.example/${id}`,
      }
    },
  },
  'photo.remove': {
    weight: 4,
    ready: has('photos'),
    build: (s, p) => ({ type: 'photo.remove', id: p.one(ids(s.photos)) }),
  },
  'photo.reorder': {
    weight: 4,
    ready: has('photos'),
    build: (s, p) => {
      const itemId = p.one(s.photos).itemId
      const own = ids(sorted(s.photos.filter((x) => x.itemId === itemId), (x) => String(x.position).padStart(9, '0')))
      const at = p.nat(own.length)
      const rotated = [...own.slice(at), ...own.slice(0, at)]
      return { type: 'photo.reorder', itemId, orderedIds: p.bool() ? rotated.reverse() : rotated }
    },
  },
  archive: {
    weight: 4,
    build: (s, p) => ({
      type: 'archive',
      ...target(p, [s.inventory.id], { folder: ids(s.folders), item: ids(s.items), variant: ids(s.variants) }),
      archiveId: newId(),
    }),
  },
  restore: {
    weight: 5,
    ready: (s) => archiveIds(s).length > 0,
    build: (s, p) => ({ type: 'restore', archiveId: p.one(archiveIds(s)) }),
  },
  deletePermanently: {
    weight: 5,
    ready: (s) => archiveIds(s).length > 0,
    build: (s, p) => ({
      type: 'deletePermanently',
      ...target(p, ids(archived([s.inventory])), {
        folder: ids(archived(s.folders)),
        item: ids(archived(s.items)),
        variant: ids(archived(s.variants)),
      }),
    }),
  },
}

const COMMAND_TYPES = Object.keys(GENERATORS) as Command['type'][]

/** The command type of a step: a weighted choice among the generators that have something to work on. */
function chooseType(s: Snap, n: number): Command['type'] {
  const ready = COMMAND_TYPES.filter((t) => GENERATORS[t].ready?.(s) ?? true)
  let k = n % ready.reduce((sum, t) => sum + GENERATORS[t].weight, 0)
  for (const t of ready) {
    k -= GENERATORS[t].weight
    if (k < 0) return t
  }
  throw new Error('unreachable')
}

const stepArb = fc.record({ kind: fc.nat(), numbers: fc.array(fc.nat(), { minLength: 16, maxLength: 16 }) })

/** Commands that passed validateCommand against an up-to-date copy and still failed in the database, with the reason:
 *  each one is a bug (a constraint the SQL breaks, e.g. the unique axis position), never an expected skip. */
const refusedByDatabase: string[] = []

/** Applies a command the way the app does: normalized, validated against the copy, sent. Null when skipped: rejected by
 *  validateCommand, or by the database (recorded in `refusedByDatabase`). */
async function send(c: Command, copy: Snap, actor: Actor = TEST_ACTOR): Promise<ApplyResult | null> {
  if (validateCommand(c, copy)) return null
  try {
    return await storage.apply(c, actor)
  } catch (e) {
    if (e instanceof StorageError && e.code === 'failed') {
      refusedByDatabase.push(`${c.type}: ${e.message}`)
      return null
    }
    throw e
  }
}

describe('patch property', () => {
  it('patch equals a fresh load after every command', { timeout: 180_000 }, async () => {
    const applied = new Map<Command['type'], number>()
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { maxLength: 15, size: 'max' }), fc.context(), async (steps, ctx) => {
        const { inv } = await seed()
        // The local copy: patched after each write, replaced by a fresh load when a write returns no patch.
        let copy = (await storage.loadInventoryWithRev(inv)).snapshot
        for (const [i, step] of steps.entries()) {
          const c = normalizeCommand(GENERATORS[chooseType(copy, step.kind)].build(copy, new Picks(step.numbers)))
          const r = await send(c, copy)
          if (!r) continue
          ctx.log(`#${i} ${JSON.stringify(c)} -> ${r.patch ? `patch for ${r.patch.inventoryId}` : 'reload'}`)
          applied.set(c.type, (applied.get(c.type) ?? 0) + 1)

          if (c.type === 'deletePermanently' && c.target === 'inventory') {
            // Nothing left to load: the inventory is gone, and so is the run.
            const list = await storage.listInventories()
            expect(r.patch).toBeNull()
            expect(r.rev).toBe(list.rev)
            expect(list.inventories.map(byId)).not.toContain(inv)
            return
          }

          const after = await storage.loadInventoryWithRev(inv)
          expect(r.rev).toBe(after.rev)
          if (r.patch) {
            // A patch for another inventory (inventory.create) leaves this copy as it is, and it must still match.
            if (r.patch.inventoryId === inv) copy = patchSnapshot(copy, r.patch)
            expect(norm(copy), `after #${i} ${c.type}`).toEqual(norm(after.snapshot))
          } else {
            copy = after.snapshot
          }
        }
      }),
      // A failure shrinks for at most the time limit, then reports the smallest case found so far. failOnInterrupt: a
      // run cut short before a failure fails too, instead of passing with fewer than 200 runs.
      { numRuns: 200, plugins: [fc.interruptAfterTimeLimit(120_000, { failOnInterrupt: true })] },
    )
    expect(COMMAND_TYPES.filter((t) => !applied.has(t)), 'command types no run applied').toEqual([])
    expect(refusedByDatabase, 'valid commands the database refused').toEqual([])
  })

  it('a foreign write between own writes shows as a different prevRev', async () => {
    const other: Actor = { device: 'Other · Vitest' }
    const { inv, items } = await seed()
    const [mine, theirs] = [items[0]!, items[1]!]
    const loaded = await storage.loadInventoryWithRev(inv)
    let copy = loaded.snapshot

    const r1 = await send(
      { type: 'stock.receive', movementId: newId(), itemId: mine, variantId: null, quantity: '3', totalPrice: 90,
        sourceUrl: null, note: null },
      copy,
    )
    expect(r1!.prevRev).toBe(loaded.rev) // nobody wrote since the load
    copy = patchSnapshot(copy, r1!.patch!)

    // Another device renames the item this device writes to next, and receives stock of an item it does not touch.
    await storage.apply({ type: 'item.update', id: mine, name: 'Resistor 1/4 W' }, other)
    const foreign = await storage.apply(
      { type: 'stock.receive', movementId: newId(), itemId: theirs, variantId: null, quantity: '7', totalPrice: null,
        sourceUrl: null, note: null },
      other,
    )

    const r2 = await send(
      { type: 'stock.use', movementId: newId(), itemId: mine, variantId: null, quantity: '2', note: null },
      copy,
    )
    expect(r2!.prevRev).not.toBe(r1!.rev)
    expect(r2!.prevRev).toBe(foreign.rev)

    const after = await storage.loadInventoryWithRev(inv)
    expect(r2!.rev).toBe(after.rev)
    const patched = patchSnapshot(copy, r2!.patch!)
    expect(r2!.patch!.itemIds).toEqual([mine])
    // The touched item matches the database, the foreign rename included ...
    expect(sliceOf(patched, mine)).toEqual(sliceOf(after.snapshot, mine))
    expect(patched.items.find((i) => i.id === mine)!.name).toBe('Resistor 1/4 W')
    // ... the item only the other device touched does not: the copy is stale, which prevRev !== r1.rev reveals.
    expect(sliceOf(patched, theirs)).not.toEqual(sliceOf(after.snapshot, theirs))
    expect(norm(patched)).not.toEqual(norm(after.snapshot))
  })
})

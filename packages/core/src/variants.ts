import type { Id } from './ids'
import type { Attribute, InventorySnapshot, ItemAttribute, Variant, VariantAttributeValue } from './model'
import { compareNumberValues, formatNumberValue, isCanonicalNumber } from './numbers'

/** A variant is its values on the item's axes: no name, no manual order. Spec 2026-11-11 variants §3, §4.6–4.8, §4.10. */

const EMPTY = '—'
const SEPARATOR = ' · '

const compareIds = (a: Id, b: Id): number => (a < b ? -1 : a > b ? 1 : 0)

// ---- lookups ----
// Snapshots are never changed in place (patchSnapshot builds new arrays), so the lookups are cached by the identity of
// the arrays they are built from: a patched or reloaded snapshot gets fresh ones.

const axesCache = new WeakMap<readonly ItemAttribute[], WeakMap<readonly Attribute[], Map<Id, readonly Attribute[]>>>()
const valuesCache = new WeakMap<readonly VariantAttributeValue[], Map<Id, Map<Id, string | null>>>()

function axesByItem(s: InventorySnapshot): Map<Id, readonly Attribute[]> {
  let byAttributes = axesCache.get(s.itemAttributes)
  if (!byAttributes) axesCache.set(s.itemAttributes, (byAttributes = new WeakMap()))
  let axes = byAttributes.get(s.attributes)
  if (!axes) {
    const attributes = new Map(s.attributes.map((a) => [a.id, a] as const))
    const links = new Map<Id, { position: number; attribute: Attribute }[]>()
    for (const r of s.itemAttributes) {
      const attribute = attributes.get(r.attributeId)
      if (r.axisPosition === null || !attribute) continue
      const list = links.get(r.itemId) ?? []
      list.push({ position: r.axisPosition, attribute })
      links.set(r.itemId, list)
    }
    axes = new Map()
    for (const [itemId, list] of links) {
      list.sort((a, b) => a.position - b.position || compareIds(a.attribute.id, b.attribute.id))
      axes.set(itemId, list.map((l) => l.attribute))
    }
    byAttributes.set(s.attributes, axes)
  }
  return axes
}

function axesOf(s: InventorySnapshot, itemId: Id): readonly Attribute[] {
  return axesByItem(s).get(itemId) ?? []
}

function valueOf(s: InventorySnapshot, variantId: Id, attributeId: Id): string | null {
  let values = valuesCache.get(s.variantAttributeValues)
  if (!values) {
    values = new Map()
    for (const r of s.variantAttributeValues) {
      const own = values.get(r.variantId) ?? new Map<Id, string | null>()
      own.set(r.attributeId, r.value)
      values.set(r.variantId, own)
    }
    valuesCache.set(s.variantAttributeValues, values)
  }
  return values.get(variantId)?.get(attributeId) ?? null
}

const isEmpty = (x: string | null | undefined): x is null | undefined => x == null || x.trim() === ''

/** What a value is compared by for uniqueness (spec §4.7); null when empty. */
function valueKey(a: Attribute, x: string | null | undefined): string | null {
  if (isEmpty(x)) return null
  return a.kind === 'text' ? x.trim().toLowerCase() : x
}

// ---- public ----

/** The item's axes in axis order. Shared attributes are not axes. */
export function itemAxes(s: InventorySnapshot, itemId: Id): Attribute[] {
  return [...axesOf(s, itemId)]
}

/** A number is shown by the attribute's unit and prefix rules (`4700` -> `4.7 kΩ`); text and list values as they are.
 *  A stored number that is not canonical (none should be) shows as it is rather than breaking the screen. */
export function formatAttributeValue(a: Attribute, value: string): string {
  return a.kind === 'number' && isCanonicalNumber(value) ? formatNumberValue(value, a) : value
}

/** The variant's axis values in axis order, joined by ` · `; an empty value shows as `—`. */
export function variantLabel(s: InventorySnapshot, v: Variant): string {
  const parts = axesOf(s, v.itemId).map((a) => {
    const x = valueOf(s, v.id, a.id)
    return isEmpty(x) ? EMPTY : formatAttributeValue(a, x)
  })
  return parts.length > 0 ? parts.join(SEPARATOR) : EMPTY
}

/** A label for the screen: the spaces inside each value (`4.7 kΩ`) become no-break spaces so a value and its unit stay on
 *  one line, and only the ` · ` separators can wrap. Never stored, searched or exported; `variantLabel` stays plain. */
export function keepValuesTogether(label: string): string {
  return label.split(SEPARATOR).map((part) => part.replace(/ /g, '\u00a0')).join(SEPARATOR)
}

/** `variantLabel` for display, see `keepValuesTogether`. */
export function variantDisplayLabel(s: InventorySnapshot, v: Variant): string {
  return keepValuesTogether(variantLabel(s, v))
}

/** Two non-empty values of one axis. Values that do not fit the kind (none should) go after the ones that do. */
function compareValues(a: Attribute, x: string, y: string): number {
  const text = () => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })
  if (a.kind === 'number') {
    const nx = isCanonicalNumber(x)
    const ny = isCanonicalNumber(y)
    if (nx && ny) return compareNumberValues(x, y)
    if (nx !== ny) return nx ? -1 : 1
    return text()
  }
  if (a.kind === 'enum') {
    const ix = a.options.indexOf(x)
    const iy = a.options.indexOf(y)
    if (ix >= 0 && iy >= 0) return ix - iy
    if (ix >= 0 || iy >= 0) return ix >= 0 ? -1 : 1
    return text()
  }
  return text()
}

/**
 * Variants of an item by their axes in axis order: numbers by value, lists by the order of the options, text naturally;
 * empty values last; equal sets of values by id (spec §4.8). Variants of different items go by item id.
 */
export function compareVariants(s: InventorySnapshot, a: Variant, b: Variant): number {
  if (a.itemId !== b.itemId) return compareIds(a.itemId, b.itemId)
  for (const axis of axesOf(s, a.itemId)) {
    const x = valueOf(s, a.id, axis.id)
    const y = valueOf(s, b.id, axis.id)
    if (isEmpty(x) || isEmpty(y)) {
      if (isEmpty(x) !== isEmpty(y)) return isEmpty(x) ? 1 : -1
      continue
    }
    const c = compareValues(axis, x, y)
    if (c !== 0) return c
  }
  return compareIds(a.id, b.id)
}

/** Spec §4.7: a number by its canonical string, a list value exactly, text without case and outer spaces; empty
 *  equals only empty. */
export function sameAxisValue(a: Attribute, x: string | null, y: string | null): boolean {
  return valueKey(a, x) === valueKey(a, y)
}

/**
 * A variant of the item, archived ones included, with these values on every axis (a missing value is empty), other
 * than `exceptVariantId`. An active variant is preferred, then the lowest id. Null when the item has no axes.
 */
export function duplicateOf(
  s: InventorySnapshot,
  itemId: Id,
  values: ReadonlyMap<Id, string | null>,
  exceptVariantId?: Id,
): Variant | null {
  const axes = axesOf(s, itemId)
  if (axes.length === 0) return null
  const wanted = axes.map((a) => valueKey(a, values.get(a.id)))
  let found: Variant | null = null
  for (const v of s.variants) {
    if (v.itemId !== itemId || v.id === exceptVariantId) continue
    if (!axes.every((a, n) => valueKey(a, valueOf(s, v.id, a.id)) === wanted[n])) continue
    if (!found || preferred(v, found)) found = v
  }
  return found
}

/** An active variant before an archived one, then the lower id. */
function preferred(v: Variant, than: Variant): boolean {
  const active = v.archivedAt === null
  return active !== (than.archivedAt === null) ? active : compareIds(v.id, than.id) < 0
}

/** New axis values for one variant, as variant.setValues carries them: null erases, an attribute not named keeps its
 *  value. */
export interface VariantValuesRow {
  variantId: Id
  values: { attributeId: Id; value: string | null }[]
}

/**
 * Each row whose variant, once ALL the rows are applied at once, has the same values on every axis as another variant of
 * the item (archived ones included), with that variant: an active one preferred, then the lowest id. In row order; empty
 * when the final state has no such pair, so two variants may trade values (Plan 9 spec §C). Values for attributes that
 * are not axes of the item are ignored here (validateCommand refuses them).
 */
export function duplicatesAfter(
  s: InventorySnapshot,
  itemId: Id,
  rows: readonly VariantValuesRow[],
): { variantId: Id; duplicate: Variant }[] {
  const axes = axesOf(s, itemId)
  if (axes.length === 0) return []
  const changes = new Map(rows.map((r) => [r.variantId, new Map(r.values.map((x) => [x.attributeId, x.value] as const))]))
  const keyOf = (variantId: Id): string => {
    const own = changes.get(variantId)
    return JSON.stringify(
      axes.map((a) => valueKey(a, own?.has(a.id) ? own.get(a.id) : valueOf(s, variantId, a.id))),
    )
  }
  const byKey = new Map<string, Variant[]>()
  for (const v of s.variants) {
    if (v.itemId !== itemId) continue
    const key = keyOf(v.id)
    byKey.set(key, [...(byKey.get(key) ?? []), v])
  }
  const found: { variantId: Id; duplicate: Variant }[] = []
  for (const r of rows) {
    let duplicate: Variant | null = null
    for (const v of byKey.get(keyOf(r.variantId)) ?? []) {
      if (v.id !== r.variantId && (!duplicate || preferred(v, duplicate))) duplicate = v
    }
    if (duplicate) found.push({ variantId: r.variantId, duplicate })
  }
  return found
}

export interface AxisRemoval {
  /** Why the axis cannot go: it is the last one and the item has variants, or the remaining axes leave variants equal. */
  blocked: 'axis_required' | 'duplicate_variant' | null
  /** Groups of variants (in variant order) that would become equal; empty unless blocked by duplicate_variant. */
  collisions: Variant[][]
  /** The value every variant has on this axis, the same string and none empty; it becomes the item's value when the
   *  axis turns shared. */
  sharedValue: string | null
  /** Every non-empty value of the variants on this axis, in variant order: these are deleted. */
  removedValues: { variantId: Id; value: string }[]
}

/**
 * What taking the axis off the item does (spec §4.6), archived variants included: item.removeAxis and
 * item.removeAttribute refuse when `blocked` is set, and the interface shows the same preview before asking.
 * An attribute that is not an axis of the item gives an empty preview.
 */
export function axisRemovalPreview(s: InventorySnapshot, itemId: Id, attributeId: Id): AxisRemoval {
  const axes = axesOf(s, itemId)
  const axis = axes.find((a) => a.id === attributeId)
  if (!axis) return { blocked: null, collisions: [], sharedValue: null, removedValues: [] }

  const variants = s.variants.filter((v) => v.itemId === itemId).sort((a, b) => compareVariants(s, a, b))
  const removedValues: { variantId: Id; value: string }[] = []
  for (const v of variants) {
    const x = valueOf(s, v.id, attributeId)
    if (!isEmpty(x)) removedValues.push({ variantId: v.id, value: x })
  }
  const first = removedValues[0]?.value
  const sharedValue =
    first !== undefined && removedValues.length === variants.length && removedValues.every((r) => r.value === first)
      ? first
      : null

  const remaining = axes.filter((a) => a !== axis)
  if (remaining.length === 0) {
    return { blocked: variants.length > 0 ? 'axis_required' : null, collisions: [], sharedValue, removedValues }
  }
  const groups = new Map<string, Variant[]>()
  for (const v of variants) {
    const key = JSON.stringify(remaining.map((a) => valueKey(a, valueOf(s, v.id, a.id))))
    const group = groups.get(key)
    if (group) group.push(v)
    else groups.set(key, [v])
  }
  const collisions = [...groups.values()].filter((g) => g.length > 1)
  return { blocked: collisions.length > 0 ? 'duplicate_variant' : null, collisions, sharedValue, removedValues }
}

export interface AxisAddition {
  /** The item gets its first variant from the shared value. */
  createsVariant: boolean
  /** The shared value that is lost: the attribute had one, no variant takes it and the item has no variants to copy it to. */
  dropsValue: string | null
}

/**
 * What making a shared attribute an axis does (spec §4.6), archived variants counted as variants: with no variants and
 * no other axis the shared value becomes the first variant; with variants it is copied to each of them; with another
 * axis and no variants it has nowhere to go and is dropped. item.addAxis never rejects; the interface asks before a drop.
 */
export function addAxisPreview(s: InventorySnapshot, itemId: Id, attributeId: Id): AxisAddition {
  const none: AxisAddition = { createsVariant: false, dropsValue: null }
  const link = s.itemAttributes.find((r) => r.itemId === itemId && r.attributeId === attributeId)
  if (!link || link.axisPosition !== null || isEmpty(link.value)) return none
  if (s.variants.some((v) => v.itemId === itemId)) return none
  return axesOf(s, itemId).length === 0 ? { createsVariant: true, dropsValue: null } : { createsVariant: false, dropsValue: link.value }
}

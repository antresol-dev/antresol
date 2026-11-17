import type { Id } from './ids'
import type { DraftNewAttribute, DraftNewFolder, DraftNewUnit, EntityProblem, IntakeDraftContent } from './intakes'
import { isColorHex, isIconName, MAX_ATTRIBUTE_UNIT_LENGTH, MAX_NAME_LENGTH, MAX_PINNED_ATTRIBUTES } from './limits'
import type { Attribute, AttributeKind, CustomUnit, InventorySnapshot } from './model'
import { folderTwin, sameName, unitTwin } from './names'
import { folderArchived } from './tree'
import { customUnitKey, SI_PREFIXES } from './units'

export { sameName }

/** The folders, units, attributes, tags and added list values an intake draft creates (spec 2026-11-16 intake entities
 *  §3, §7; 2026-11-17 full entities §3, §4): what keeps each from being created against a copy of the inventory, and
 *  the order the commit creates them in. */

const KINDS: readonly AttributeKind[] = ['text', 'enum', 'number']
const NO_AUDIT = { createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }

export const goodName = (name: string) => {
  const t = name.trim()
  return t !== '' && t.length <= MAX_NAME_LENGTH
}
/** An optional icon of a draft row: absent or null, or an icon name. */
export const goodIcon = (icon: unknown) => icon == null || (typeof icon === 'string' && isIconName(icon))
/** An optional colour of a draft row: absent or null, or #RRGGBB in either case (the commit writes capitals). */
export const goodColor = (color: unknown) => color == null || (typeof color === 'string' && isColorHex(color.toUpperCase()))
/** A draft colour as the commit writes it: capitals, or null. */
export const colorOf = (color: string | null | undefined): string | null => (color == null ? null : color.toUpperCase())

/** List values as stored: trimmed, the empty ones and repeats (no case) left out, the first spelling kept. */
function distinctValues(values: readonly string[], taken: readonly string[] = []): string[] {
  const seen = new Set(taken.map((v) => v.trim().toLowerCase()))
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    const key = t.toLowerCase()
    if (t === '' || seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** A draft attribute as the attribute the commit makes of it: trimmed, a unit only on a number, list options without
 *  empty ones or repeats (no case). */
export function draftAttribute(a: DraftNewAttribute, inventoryId: Id): Attribute {
  const number = a.kind === 'number'
  return {
    id: a.id,
    inventoryId,
    name: a.name.trim(),
    kind: a.kind,
    options: distinctValues(a.options),
    unit: number ? a.unit.trim() : '',
    siPrefixes: number && a.siPrefixes,
    pinned: a.pinned === true,
    ...NO_AUDIT,
  }
}

/** The values the draft appends to each existing list attribute of the copy (`addedOptions`), in the order given:
 *  trimmed, without empty ones, without values the list has already or that come twice (no case). Entries naming
 *  anything but a list of the copy are left out (see addedOptionProblems); an attribute with nothing to append too. */
export function addedOptionValues(draft: IntakeDraftContent, s: InventorySnapshot): Map<Id, string[]> {
  const out = new Map<Id, string[]>()
  for (const entry of draft.addedOptions ?? []) {
    const a = s.attributes.find((x) => x.id === entry.attributeId)
    if (!a || a.kind !== 'enum') continue
    const values = distinctValues(entry.values, [...a.options, ...(out.get(a.id) ?? [])])
    if (values.length > 0) out.set(a.id, [...(out.get(a.id) ?? []), ...values])
  }
  return out
}

/** The copy with the draft's added list values appended to its lists: what lines and new items of the draft are read
 *  against. The copy itself when the draft adds none. */
export function withAddedOptions(draft: IntakeDraftContent, s: InventorySnapshot): InventorySnapshot {
  const added = addedOptionValues(draft, s)
  if (added.size === 0) return s
  return { ...s, attributes: s.attributes.map((a) => (added.has(a.id) ? { ...a, options: [...a.options, ...added.get(a.id)!] } : a)) }
}

/** The attributes a new item of the draft may use, by id: the copy's (with the draft's added list values) and the
 *  draft's (one in the copy wins). */
export function intakeAttributes(draft: IntakeDraftContent, s: InventorySnapshot): Map<Id, Attribute> {
  const all = new Map<Id, Attribute>((draft.newAttributes ?? []).map((a) => [a.id, draftAttribute(a, s.inventory.id)] as const))
  for (const a of withAddedOptions(draft, s).attributes) all.set(a.id, a)
  return all
}

/** A draft unit as the unit the commit makes of it: name and symbol trimmed. */
export function draftUnit(u: DraftNewUnit, inventoryId: Id): CustomUnit {
  return { id: u.id, inventoryId, name: u.name.trim(), symbol: u.symbol.trim(), prefixPowers: [...u.prefixPowers], ...NO_AUDIT }
}

/** The custom units a new item of the draft may use (`customUnitKey(id)`): the copy's and the draft's (one in the copy
 *  wins). */
export function intakeUnits(draft: IntakeDraftContent, s: InventorySnapshot): CustomUnit[] {
  const known = new Set(s.units.map((u) => u.id))
  return [...s.units, ...(draft.newUnits ?? []).filter((u) => !known.has(u.id)).map((u) => draftUnit(u, s.inventory.id))]
}

/**
 * What keeps each draft folder from being created, in draft order: a bad name or icon (invalid_value); a parent chain
 * through draft folders that comes back to itself (cycle); a parent that is neither a draft folder nor an active
 * folder of the copy (parent_gone); a name equal (trim, no case) to a folder of the copy under the same parent
 * (duplicate_name, or duplicate_archived when only an archived folder has it) or to an earlier draft folder there
 * (duplicate_name), naming that folder.
 */
export function draftFolderProblems(draft: IntakeDraftContent, s: InventorySnapshot): { id: Id; problem: EntityProblem | null }[] {
  const folders = draft.newFolders ?? []
  const byId = new Map(folders.map((f) => [f.id, f] as const))
  const problemOf = (f: DraftNewFolder, index: number): EntityProblem | null => {
    if (!goodName(f.name) || !goodIcon(f.icon)) return { code: 'invalid_value' }
    const seen = new Set<Id>([f.id])
    for (let cur = f.parentId; cur !== null && byId.has(cur); cur = byId.get(cur)!.parentId) {
      if (seen.has(cur)) return { code: 'cycle' }
      seen.add(cur)
    }
    if (f.parentId !== null && !byId.has(f.parentId)) {
      if (!s.folders.some((x) => x.id === f.parentId) || folderArchived(s, f.parentId)) return { code: 'parent_gone' }
    }
    const twin = folderTwin(s, f.parentId, f.name, f.id)
    if (twin) return { code: twin.archivedAt === null ? 'duplicate_name' : 'duplicate_archived', existingId: twin.id }
    const earlier = folders.slice(0, index).find((x) => x.parentId === f.parentId && sameName(x.name, f.name))
    return earlier ? { code: 'duplicate_name', existingId: earlier.id } : null
  }
  return folders.map((f, i) => ({ id: f.id, problem: problemOf(f, i) }))
}

/** What keeps each draft attribute from being created, in draft order: a bad name, kind or unit (invalid_value); a name
 *  equal (trim, no case) to any attribute of the copy or an earlier draft attribute (duplicate_name); a pin over
 *  MAX_PINNED_ATTRIBUTES, counting the copy's pins and the earlier pinned draft attributes (pinned_limit). */
export function draftAttributeProblems(draft: IntakeDraftContent, s: InventorySnapshot): { id: Id; problem: EntityProblem | null }[] {
  const attributes = draft.newAttributes ?? []
  let pins = s.attributes.filter((a) => a.pinned).length
  const problemOf = (a: DraftNewAttribute, index: number): EntityProblem | null => {
    if (!goodName(a.name) || !KINDS.includes(a.kind)) return { code: 'invalid_value' }
    if (a.kind === 'number' && a.unit.trim().length > MAX_ATTRIBUTE_UNIT_LENGTH) return { code: 'invalid_value' }
    const existing =
      s.attributes.find((x) => x.id !== a.id && sameName(x.name, a.name)) ??
      attributes.slice(0, index).find((x) => sameName(x.name, a.name))
    if (existing) return { code: 'duplicate_name', existingId: existing.id }
    if (a.pinned === true && !s.attributes.some((x) => x.id === a.id)) {
      if (pins >= MAX_PINNED_ATTRIBUTES) return { code: 'pinned_limit' }
      pins++
    }
    return null
  }
  return attributes.map((a, i) => ({ id: a.id, problem: problemOf(a, i) }))
}

const goodPrefixes = (p: unknown) =>
  Array.isArray(p) && p.every((x) => typeof x === 'number' && Number.isInteger(x) && Object.hasOwn(SI_PREFIXES, x))

/** What keeps each draft unit from being created, in draft order: a bad name, symbol or prefix (invalid_value); a name
 *  (no case) or symbol (with case) of a built-in or custom unit of the copy, or of an earlier draft unit
 *  (duplicate_name, naming that unit by its key: 'm', 'custom:<id>'). */
export function draftUnitProblems(draft: IntakeDraftContent, s: InventorySnapshot): { id: Id; problem: EntityProblem | null }[] {
  const units = draft.newUnits ?? []
  const problemOf = (u: DraftNewUnit, index: number): EntityProblem | null => {
    if (!goodName(u.name) || !goodName(u.symbol) || !goodPrefixes(u.prefixPowers)) return { code: 'invalid_value' }
    const twin = unitTwin(s, u, u.id)
    if (twin) return { code: 'duplicate_name', existingId: twin.key }
    const earlier = units.slice(0, index).find((x) => sameName(x.name, u.name) || x.symbol.trim() === u.symbol.trim())
    return earlier ? { code: 'duplicate_name', existingId: customUnitKey(earlier.id) } : null
  }
  return units.map((u, i) => ({ id: u.id, problem: problemOf(u, i) }))
}

/** What keeps each draft tag from being created, in draft order: a bad name or colour (invalid_value). A tag named as
 *  an existing or earlier one is that tag, no problem. */
export function draftTagProblems(draft: IntakeDraftContent): { id: Id; problem: EntityProblem | null }[] {
  return (draft.newTags ?? []).map((t) => ({ id: t.id, problem: goodName(t.name) && goodColor(t.color) ? null : { code: 'invalid_value' as const } }))
}

/** What keeps each entry of added list values from being appended, by attribute id in draft order: an attribute that
 *  is not a list of the copy, or a value that is empty or too long (invalid_value). */
export function addedOptionProblems(draft: IntakeDraftContent, s: InventorySnapshot): { id: Id; problem: EntityProblem | null }[] {
  return (draft.addedOptions ?? []).map((entry) => {
    const a = s.attributes.find((x) => x.id === entry.attributeId)
    const fine = !!a && a.kind === 'enum' && entry.values.every((v) => goodName(v))
    return { id: entry.attributeId, problem: fine ? null : { code: 'invalid_value' as const } }
  })
}

/** The draft folders with every parent before its children. Throws on a cycle (resolve the draft first). */
export function foldersParentsFirst(folders: readonly DraftNewFolder[]): DraftNewFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f] as const))
  const out: DraftNewFolder[] = []
  const done = new Set<Id>()
  const visiting = new Set<Id>()
  const visit = (f: DraftNewFolder) => {
    if (done.has(f.id)) return
    if (visiting.has(f.id)) throw new Error(`foldersParentsFirst: folder ${f.id} is its own ancestor`)
    visiting.add(f.id)
    const parent = f.parentId === null ? undefined : byId.get(f.parentId)
    if (parent) visit(parent)
    done.add(f.id)
    out.push(f)
  }
  for (const f of folders) visit(f)
  return out
}

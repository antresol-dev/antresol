import type { Id } from './ids'
import type { Folder, InventorySnapshot, Item } from './model'
import { BUILTIN_UNITS, customUnitKey } from './units'

/** Names equal after trimming, without case: the hard duplicate rule of every name. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Hard duplicates (spec 2026-11-17 §3): names compare trimmed and without case (`sameName`); unit symbols compare
 *  trimmed and with case. A living twin wins over an archived one. `exceptId` is the row being changed or retried. */

/** The twin with the name among `rows` (all of them siblings), a living one before an archived one. */
function twinOf<T extends { id: Id; name: string; archivedAt: string | null }>(rows: readonly T[], name: string, exceptId?: Id): T | undefined {
  const twins = rows.filter((r) => r.id !== exceptId && sameName(r.name, name))
  return twins.find((r) => r.archivedAt === null) ?? twins[0]
}

/** The item of the folder (archived ones included) that already has this name; a living one first. */
export function itemTwin(s: InventorySnapshot, folderId: Id | null, name: string, exceptId?: Id): Item | undefined {
  return twinOf(
    s.items.filter((i) => i.folderId === folderId),
    name,
    exceptId,
  )
}

/** The folder under the parent (archived ones included) that already has this name; a living one first. */
export function folderTwin(s: InventorySnapshot, parentId: Id | null, name: string, exceptId?: Id): Folder | undefined {
  return twinOf(
    s.folders.filter((f) => f.parentId === parentId),
    name,
    exceptId,
  )
}

const takenBy = (twin: { archivedAt: string | null } | undefined): 'active' | 'archived' | null =>
  twin === undefined ? null : twin.archivedAt === null ? 'active' : 'archived'

/** Another item of the folder (archived ones included) already has this name: 'active' (a living twin) or 'archived'. */
export function itemNameTaken(s: InventorySnapshot, folderId: Id | null, name: string, exceptId?: Id): 'active' | 'archived' | null {
  return takenBy(itemTwin(s, folderId, name, exceptId))
}

/** Another folder under the parent (archived ones included) already has this name. */
export function folderNameTaken(s: InventorySnapshot, parentId: Id | null, name: string, exceptId?: Id): 'active' | 'archived' | null {
  return takenBy(folderTwin(s, parentId, name, exceptId))
}

/** The unit (built-in or custom) whose name (no case) or symbol (with case) the given parts take: its key ('m',
 *  'custom:<id>') and which part clashes. Give only the parts being set; the name is looked at first. */
export function unitTwin(
  s: InventorySnapshot,
  unit: { name?: string; symbol?: string },
  exceptId?: Id,
): { key: string; by: 'name' | 'symbol' } | null {
  const others = [
    ...Object.values(BUILTIN_UNITS),
    ...s.units.filter((u) => u.id !== exceptId).map((u) => ({ key: customUnitKey(u.id), name: u.name, symbol: u.symbol })),
  ]
  const byName = unit.name === undefined ? undefined : others.find((u) => sameName(u.name, unit.name!))
  if (byName) return { key: byName.key, by: 'name' }
  const bySymbol = unit.symbol === undefined ? undefined : others.find((u) => u.symbol.trim() === unit.symbol!.trim())
  return bySymbol ? { key: bySymbol.key, by: 'symbol' } : null
}

/** A unit name (no case) or symbol (with case) already used by a built-in unit or another custom one. Give only the
 *  parts being set; the name is reported first. */
export function unitClash(
  s: InventorySnapshot,
  unit: { name?: string; symbol?: string },
  exceptId?: Id,
): 'name' | 'symbol' | null {
  return unitTwin(s, unit, exceptId)?.by ?? null
}

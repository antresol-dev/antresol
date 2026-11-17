import type { Id } from './ids'
import { sameName } from './intake-entities'
import type { InventorySnapshot } from './model'
import { BUILTIN_UNITS } from './units'

/** Hard duplicates (spec 2026-11-17 §3): names compare trimmed and without case (`sameName`); unit symbols compare
 *  trimmed and with case. A living twin wins over an archived one. `exceptId` is the row being changed or retried. */

/** Another item of the folder (archived ones included) already has this name: 'active' (a living twin) or 'archived'. */
export function itemNameTaken(s: InventorySnapshot, folderId: Id | null, name: string, exceptId?: Id): 'active' | 'archived' | null {
  const twins = s.items.filter((i) => i.id !== exceptId && i.folderId === folderId && sameName(i.name, name))
  if (twins.length === 0) return null
  return twins.some((i) => i.archivedAt === null) ? 'active' : 'archived'
}

/** Another folder under the parent (archived ones included) already has this name. */
export function folderNameTaken(s: InventorySnapshot, parentId: Id | null, name: string, exceptId?: Id): 'active' | 'archived' | null {
  const twins = s.folders.filter((f) => f.id !== exceptId && f.parentId === parentId && sameName(f.name, name))
  if (twins.length === 0) return null
  return twins.some((f) => f.archivedAt === null) ? 'active' : 'archived'
}

/** A unit name (no case) or symbol (with case) already used by a built-in unit or another custom one. Give only the
 *  parts being set; the name is reported first. */
export function unitClash(
  s: InventorySnapshot,
  unit: { name?: string; symbol?: string },
  exceptId?: Id,
): 'name' | 'symbol' | null {
  const others = [...Object.values(BUILTIN_UNITS), ...s.units.filter((u) => u.id !== exceptId)]
  if (unit.name !== undefined && others.some((u) => sameName(u.name, unit.name!))) return 'name'
  if (unit.symbol !== undefined && others.some((u) => u.symbol.trim() === unit.symbol!.trim())) return 'symbol'
  return null
}

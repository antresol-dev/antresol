import type { Folder, Id, InventorySnapshot, SearchHit } from '@graymatter/core'
import { nearestSuggestion, type NearestSuggestion } from './nearest'
import { isShareLike, type ShareInput } from './share'
import type { InventoryRef } from './types'
import { byName, pathOf, searchRows, snapshotIndex, type SearchRow } from './views'
import type { InventoryEntry } from './workspace'

export { snapshotSearch } from './views'

/** What a paste into the palette hands to the share sheet: a web address or a long shop title (isShareLike); null for
 *  anything else, which is pasted into the field as usual ("tl072.pdf"). */
export function pastedShare(text: string): ShareInput | null {
  const t = text.trim()
  return isShareLike(t) ? { text: t } : null
}

/** Core search's normalization: lowercase, letters and digits only. "TL-072" → "tl072". */
export function compactText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export interface TextPart {
  text: string
  match: boolean
}

const KEPT = /[\p{L}\p{N}]/u

/** Splits `text` around the first place where it contains `query`, both compared by compactText; characters dropped by
 *  compaction inside the match stay in the matched part ("TL-072" for "tl072"). One unmatched part when the query
 *  compacts to '' or does not occur. */
export function highlightParts(text: string, query: string): TextPart[] {
  const q = compactText(query)
  if (q === '') return [{ text, match: false }]
  // The compact text, and for each of its UTF-16 units where its character starts and ends in `text`.
  let compact = ''
  const starts: number[] = []
  const ends: number[] = []
  let at = 0
  for (const ch of text) {
    const end = at + ch.length
    for (const c of ch.toLowerCase()) {
      if (!KEPT.test(c)) continue
      compact += c
      for (let unit = 0; unit < c.length; unit++) {
        starts.push(at)
        ends.push(end)
      }
    }
    at = end
  }
  const found = compact.indexOf(q)
  if (found === -1) return [{ text, match: false }]
  const from = starts[found]!
  const to = ends[found + q.length - 1]!
  const parts: TextPart[] = []
  if (from > 0) parts.push({ text: text.slice(0, from), match: false })
  parts.push({ text: text.slice(from, to), match: true })
  if (to < text.length) parts.push({ text: text.slice(to), match: false })
  return parts
}

export interface FolderHit {
  id: Id
  name: string
  /** Parent folder names joined ' / ', '' at the root. */
  path: string
}

/** Active folders (not under an archived one) whose compact name contains the compact query: exact first, then prefix,
 *  then the rest; ties by name. [] for a query that compacts to ''. */
export function matchFolders(s: InventorySnapshot, query: string, limit = 5): FolderHit[] {
  const q = compactText(query)
  if (q === '' || limit <= 0) return []
  const ix = snapshotIndex(s)
  const hits: { folder: Folder; tier: number; path: Folder[] }[] = []
  for (const folder of s.folders) {
    if (folder.archivedAt !== null) continue
    const name = compactText(folder.name)
    const at = name.indexOf(q)
    if (at === -1) continue
    // Empty when an ancestor is archived.
    const path = pathOf(ix, folder.id)
    if (path.length === 0) continue
    hits.push({ folder, tier: name === q ? 0 : at === 0 ? 1 : 2, path })
  }
  hits.sort((a, b) => a.tier - b.tier || byName(a.folder, b.folder))
  return hits.slice(0, limit).map(({ folder, path }) => ({
    id: folder.id,
    name: folder.name,
    path: path
      .slice(0, -1)
      .map((f) => f.name)
      .join(' / '),
  }))
}

export type PaletteAction =
  | { kind: 'addItem'; name: string }
  | { kind: 'newFolder'; parentId: Id | null; parentName: string }
  | { kind: 'switchInventory'; ref: InventoryRef; name: string }
  | { kind: 'go'; section: 'archive' | 'dictionaries' | 'settings' }

export interface PaletteContext {
  query: string
  /** The folder the screen shows (the item's folder on the item card); null outside the items section. */
  folder: { id: Id | null; name: string } | null
  inventories: InventoryEntry[]
  current: InventoryRef | null
  sections: ('archive' | 'dictionaries' | 'settings')[]
  canWrite: boolean
}

const sameRef = (a: InventoryRef, b: InventoryRef | null): boolean =>
  !!b && a.sourceId === b.sourceId && a.inventoryId === b.inventoryId

/** In this order: addItem (a non-empty query and canWrite), newFolder (with a folder and canWrite), switchInventory for each other inventory, go for each section.
 *  With a non-empty query only actions whose label (from `labelOf`) contains it compactly. */
export function paletteActions(ctx: PaletteContext, labelOf: (a: PaletteAction) => string): PaletteAction[] {
  const actions: PaletteAction[] = []
  const typed = ctx.query.trim()
  if (typed !== '' && ctx.canWrite) actions.push({ kind: 'addItem', name: typed })
  if (ctx.folder && ctx.canWrite) actions.push({ kind: 'newFolder', parentId: ctx.folder.id, parentName: ctx.folder.name })
  for (const e of ctx.inventories) {
    if (!sameRef(e.ref, ctx.current)) actions.push({ kind: 'switchInventory', ref: e.ref, name: e.inventory.name })
  }
  for (const section of ctx.sections) actions.push({ kind: 'go', section })
  const q = compactText(ctx.query)
  // Adding is always offered: the query is its name, whatever its label says.
  return q === '' ? actions : actions.filter((a) => a.kind === 'addItem' || compactText(labelOf(a)).includes(q))
}

export type PaletteRow =
  | { kind: 'nearest'; key: string; suggestion: NearestSuggestion }
  | { kind: 'item'; key: string; hit: SearchRow; name: TextPart[]; variant: TextPart[] | null }
  | { kind: 'folder'; key: string; hit: FolderHit; name: TextPart[] }
  | { kind: 'action'; key: string; action: PaletteAction; label: string }
export interface PaletteGroup {
  key: 'nearest' | 'items' | 'folders' | 'actions'
  rows: PaletteRow[]
}

const ITEM_LIMIT = 20

const actionKey = (a: PaletteAction): string =>
  a.kind === 'addItem'
    ? 'action:add-item'
    : a.kind === 'newFolder'
    ? 'action:new-folder'
    : a.kind === 'switchInventory'
      ? `action:switch:${a.ref.sourceId}:${a.ref.inventoryId}`
      : `action:go:${a.section}`

/** Nearest (the suggestion row when the query is a value nobody has), Items (core search's best 20, in its order, names and variants highlighted), Folders (matchFolders), Actions
 *  (paletteActions); groups without rows are dropped. Rows have keys unique across the groups. */
export function paletteResults(
  s: InventorySnapshot | null,
  search: { search(query: string, limit?: number): SearchHit[] } | null,
  ctx: PaletteContext,
  labelOf: (a: PaletteAction) => string,
): PaletteGroup[] {
  const q = ctx.query.trim()
  const items: PaletteRow[] =
    s && search && q
      ? searchRows(s, search.search(q, ITEM_LIMIT)).map((hit) => ({
          kind: 'item',
          key: `item:${hit.itemId}:${hit.variantId ?? ''}`,
          hit,
          name: highlightParts(hit.name, q),
          variant: hit.variantName === null ? null : highlightParts(hit.variantName, q),
        }))
      : []
  const folders: PaletteRow[] = s
    ? matchFolders(s, q).map((hit) => ({ kind: 'folder', key: `folder:${hit.id}`, hit, name: highlightParts(hit.name, q) }))
    : []
  const actions: PaletteRow[] = paletteActions({ ...ctx, query: q }, labelOf).map((action) => ({
    kind: 'action',
    key: actionKey(action),
    action,
    label: labelOf(action),
  }))
  // "No 4.7 kΩ — nearest: 4.3 kΩ (12) · 5.1 kΩ (40)": the query reads as a value of a number attribute nothing holds.
  const suggestion = s && q ? nearestSuggestion(s, q) : null
  const nearest: PaletteRow[] = suggestion ? [{ kind: 'nearest', key: 'nearest', suggestion }] : []
  const groups: PaletteGroup[] = [
    { key: 'nearest', rows: nearest },
    { key: 'items', rows: items },
    { key: 'folders', rows: folders },
    { key: 'actions', rows: actions },
  ]
  return groups.filter((g) => g.rows.length > 0)
}

/** The phone's order, where results grow upwards from the field: the groups and the rows inside them reversed, so the
 *  best result sits right above the field. A new array; `groups` is unchanged. */
export function bottomUp(groups: PaletteGroup[]): PaletteGroup[] {
  return [...groups].reverse().map((g) => ({ ...g, rows: [...g.rows].reverse() }))
}

/** The row `step` rows below (1) or above (-1) the selected one in screen order, stopping at both ends; the first row
 *  when nothing is selected; null for no rows. */
export function stepSelection(rows: PaletteRow[], selectedKey: string | null, step: 1 | -1): PaletteRow | null {
  if (rows.length === 0) return null
  const at = rows.findIndex((r) => r.key === selectedKey)
  if (at === -1) return rows[0]!
  return rows[Math.min(Math.max(at + step, 0), rows.length - 1)]!
}

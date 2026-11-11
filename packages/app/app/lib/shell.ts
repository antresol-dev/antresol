import type { Id, InventorySnapshot } from '@graymatter/core'
import type { InventoryRef } from './types'
import { pathOf, snapshotIndex } from './views'
import type { InventoryEntry } from './workspace'

export type Section = 'items' | 'archive' | 'dictionaries' | 'settings'

/** Sections in the app panel between the inventory switcher and Settings. */
export const NAV_SECTIONS: { key: Exclude<Section, 'settings'>; to: string }[] = [
  { key: 'items', to: '/' },
  { key: 'dictionaries', to: '/dictionaries' },
  { key: 'archive', to: '/archive' },
]

const SECTION_BY_ROUTE: Record<string, Section> = {
  'index': 'items',
  'folder-id': 'items',
  'item-id': 'items',
  'archive': 'archive',
  'dictionaries': 'dictionaries',
  'settings': 'settings',
  'settings-sources-id': 'settings',
  'settings-sources-new': 'settings',
}

/** index, folder-id, item-id → items; archive; dictionaries; settings, settings-sources-id, settings-sources-new → settings; anything else → null. */
export function sectionOf(routeName: string | null | undefined): Section | null {
  if (!routeName || !Object.hasOwn(SECTION_BY_ROUTE, routeName)) return null
  return SECTION_BY_ROUTE[routeName]!
}

/** Screens that show the current inventory: items, archive, dictionaries. Back and forward onto one of their history
 *  entries switch to the inventory the entry was opened in; other screens (Settings) are not tied to an inventory. */
export function inventoryScoped(routeName: string | null | undefined): boolean {
  const section = sectionOf(routeName)
  return section !== null && section !== 'settings'
}

/** The tree panel shows in the items section only. */
export function showsTree(routeName: string | null | undefined): boolean {
  return sectionOf(routeName) === 'items'
}

const idParam = (params: Record<string, string | string[]>): string | null =>
  typeof params.id === 'string' && params.id !== '' ? params.id : null

/** The current tree row: 'root' on index; the folder on folder-id; the item's folder ('root' when it has none) on item-id;
 *  null on other routes, without a snapshot, or when the item is unknown. */
export function treeCurrent(
  s: InventorySnapshot | null,
  routeName: string | null | undefined,
  params: Record<string, string | string[]>,
): Id | 'root' | null {
  if (!s) return null
  if (routeName === 'index') return 'root'
  if (routeName === 'folder-id') return idParam(params)
  if (routeName === 'item-id') {
    const id = idParam(params)
    const item = id === null ? undefined : s.items.find((i) => i.id === id)
    if (!item) return null
    return item.folderId ?? 'root'
  }
  return null
}

/** aria-current of a tree row (`current`: it is treeCurrent's row): 'page' when the screen is the row itself (the root on
 *  index, the folder on its own screen), 'true' when it is current for another screen (an item card's folder). */
export function treeAriaCurrent(
  row: Id | 'root',
  current: boolean,
  routeName: string | null | undefined,
  params: Record<string, string | string[]>,
): 'page' | 'true' | undefined {
  if (!current) return undefined
  const page = row === 'root' ? routeName === 'index' : routeName === 'folder-id' && idParam(params) === row
  return page ? 'page' : 'true'
}

/** The open folder or item screen shows `folderId` itself, a folder below it or an item below it: archiving that
 *  folder leaves the screen with nothing to show. */
export function showsInside(
  s: InventorySnapshot | null,
  routeName: string | null | undefined,
  params: Record<string, string | string[]>,
  folderId: Id,
): boolean {
  const current = treeCurrent(s, routeName, params)
  if (!s || current === null || current === 'root') return false
  return pathOf(snapshotIndex(s), current).some((f) => f.id === folderId)
}

/** The current inventory's name for the switcher, the palette and the bottom search bar: the snapshot's once it is the
 *  current inventory's (also before the list of inventories arrives), until then (a switch) the listed one; '' without one. */
export function currentInventoryName(state: {
  snapshot: InventorySnapshot | null
  current: InventoryRef | null
  inventories: readonly InventoryEntry[]
}): string {
  const current = state.current
  if (!current) return ''
  if (state.snapshot && state.snapshot.inventory.id === current.inventoryId) return state.snapshot.inventory.name
  const entry = state.inventories.find(
    (e) => e.ref.sourceId === current.sourceId && e.ref.inventoryId === current.inventoryId,
  )
  return entry?.inventory.name ?? ''
}

/** The PWA shortcut in the launch URL (`?action=add` / `?action=search`); anything else gives null. */
export function launchAction(query: Record<string, unknown>): 'add' | 'search' | null {
  const action = query.action
  return action === 'add' || action === 'search' ? action : null
}

/** True once a launch shortcut may decide what to open: there is a current inventory and its source has stopped
 *  `connecting` (so an offline start already knows the inventory is read-only). */
export function launchReady(state: { current: InventoryRef | null; sources: { config: { id: string }; status: string }[] }): boolean {
  const cur = state.current
  if (!cur) return false
  const status = state.sources.find((s) => s.config.id === cur.sourceId)?.status
  return status !== 'connecting'
}

const THEME_COLOR = { light: '#EDEFF3', dark: '#24272E' } as const // the --background tokens

/** `theme-color` metas: both media-scoped ones while the preference is "system"; otherwise one for the chosen theme. */
export function themeColorMeta(
  preference: string,
  resolved: string,
): { key: string; name: string; content: string; media?: string }[] {
  if (preference === 'system') {
    return [
      { key: 'theme-color-light', name: 'theme-color', content: THEME_COLOR.light, media: '(prefers-color-scheme: light)' },
      { key: 'theme-color-dark', name: 'theme-color', content: THEME_COLOR.dark, media: '(prefers-color-scheme: dark)' },
    ]
  }
  return [{ key: 'theme-color', name: 'theme-color', content: resolved === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light }]
}

import type { Id, InventorySnapshot } from '@graymatter/core'
import { pathOf, snapshotIndex } from './views'

export type Section = 'items' | 'archive' | 'dictionaries' | 'settings'

/** Sections in the app panel between the inventory switcher and Settings. Task 12 adds dictionaries. */
export const NAV_SECTIONS: { key: Exclude<Section, 'settings'>; to: string }[] = [
  { key: 'items', to: '/' },
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

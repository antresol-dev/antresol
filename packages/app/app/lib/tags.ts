import type { InventorySnapshot, Tag } from '@graymatter/core'

export interface TagMatches {
  tags: Tag[]
  canCreate: boolean
}

const byName = (a: Tag, b: Tag): number => a.name.localeCompare(b.name, 'en')

/** Case-insensitive substring match by name, sorted by name; canCreate when the trimmed query is non-empty and no tag has exactly that name (case-insensitive). */
export function tagMatches(s: InventorySnapshot, query: string): TagMatches {
  const q = query.trim().toLowerCase()
  return {
    tags: s.tags.filter((t) => t.name.toLowerCase().includes(q)).sort(byName),
    canCreate: q !== '' && !s.tags.some((t) => t.name.toLowerCase() === q),
  }
}

import MiniSearch from 'minisearch'
import type { Id } from './ids'
import type { InventorySnapshot } from './model'

export interface SearchHit {
  itemId: Id
  variantId: Id | null
}

interface Doc {
  id: string
  itemId: Id
  variantId: Id | null
  name: string
  compact: string
  extra: string
}

const DEFAULT_LIMIT = 50

/** Lowercase, keep only letters and digits: "TL-072" -> "tl072". */
const compact = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

const SEARCH_OPTIONS = { prefix: true, fuzzy: 0.3 } as const

export function createSearch(s: InventorySnapshot): { search(query: string, limit?: number): SearchHit[] } {
  const archivedFolders = new Set(s.folders.filter((f) => f.archivedAt !== null).map((f) => f.id))
  const folderParent = new Map(s.folders.map((f) => [f.id, f.parentId] as const))
  const folderHidden = (id: Id | null): boolean => {
    const seen = new Set<Id>()
    let cur = id
    while (cur !== null && !seen.has(cur)) {
      if (archivedFolders.has(cur)) return true
      seen.add(cur)
      cur = folderParent.get(cur) ?? null
    }
    return false
  }

  const tagNames = new Map(s.tags.map((t) => [t.id, t.name] as const))
  const itemAttrs = new Map<Id, string[]>()
  for (const a of s.itemAttributes) {
    if (a.value) itemAttrs.set(a.itemId, [...(itemAttrs.get(a.itemId) ?? []), a.value])
  }
  const variantAttrs = new Map<Id, string[]>()
  for (const a of s.variantAttributeValues) {
    if (a.value) variantAttrs.set(a.variantId, [...(variantAttrs.get(a.variantId) ?? []), a.value])
  }

  const docs: Doc[] = []
  const activeItems = s.items.filter((i) => i.archivedAt === null && !folderHidden(i.folderId))
  const activeIds = new Set(activeItems.map((i) => i.id))
  for (const i of activeItems) {
    const tags = i.tagIds.map((t) => tagNames.get(t)).filter((t): t is string => !!t)
    docs.push({
      id: `i:${i.id}`,
      itemId: i.id,
      variantId: null,
      name: i.name,
      compact: [i.name, ...tags, ...(itemAttrs.get(i.id) ?? [])].map(compact).join(' '),
      extra: [...tags, ...(itemAttrs.get(i.id) ?? []), i.description ?? ''].join(' '),
    })
  }
  for (const v of s.variants) {
    if (v.archivedAt !== null || !activeIds.has(v.itemId)) continue
    const attrs = variantAttrs.get(v.id) ?? []
    docs.push({
      id: `v:${v.id}`,
      itemId: v.itemId,
      variantId: v.id,
      name: v.name,
      compact: [v.name, ...attrs].map(compact).join(' '),
      extra: [...attrs, v.description ?? ''].join(' '),
    })
  }

  const index = new MiniSearch<Doc>({
    fields: ['name', 'compact', 'extra'],
    storeFields: ['itemId', 'variantId'],
    searchOptions: { ...SEARCH_OPTIONS, boost: { name: 2 } },
  })
  index.addAll(docs)

  return {
    search(query, limit = DEFAULT_LIMIT) {
      if (query.trim() === '' || limit <= 0) return []
      const compactQuery = compact(query)
      const scored = new Map<string, { score: number; itemId: Id; variantId: Id | null }>()
      const collect = (q: string, fields?: string[]) => {
        if (q === '') return
        for (const r of index.search(q, fields ? { fields } : {})) {
          const prev = scored.get(r.id)
          if (!prev || r.score > prev.score) {
            scored.set(r.id, { score: r.score, itemId: r.itemId as Id, variantId: r.variantId as Id | null })
          }
        }
      }
      collect(query, ['name', 'extra'])
      collect(compactQuery, ['compact'])

      const best = new Map<Id, { score: number; variantId: Id | null }>()
      for (const r of scored.values()) {
        const prev = best.get(r.itemId)
        if (!prev || r.score > prev.score) best.set(r.itemId, { score: r.score, variantId: r.variantId })
      }
      return [...best.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, limit)
        .map(([itemId, b]) => ({ itemId, variantId: b.variantId }))
    },
  }
}

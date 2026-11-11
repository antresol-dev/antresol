import MiniSearch from 'minisearch'
import type { Id } from './ids'
import type { InventorySnapshot, Item, Variant } from './model'

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

/** A decimal comma between digits is a decimal point: "4,7k" -> "4.7k". */
const decimalComma = (s: string): string => s.replace(/(\p{N}),(?=\p{N})/gu, '$1.')

/** Lowercase, keep letters, digits and decimal points between digits: "TL-072" -> "tl072", "4.7k" -> "4.7k". */
const compact = (s: string): string =>
  decimalComma(s.toLowerCase()).replace(/(?<=\p{N})\.(?=\p{N})|[^\p{L}\p{N}]+/gu, (m) => (m === '.' ? '.' : ''))

/** Split on whitespace and punctuation, but keep a point between digits inside the token ("4.7k"). */
const tokenize = (s: string): string[] =>
  decimalComma(s)
    .split(/(?<!\p{N})\.|\.(?!\p{N})|[^\p{L}\p{N}.]+/u)
    .filter((t) => t !== '')

/** Ranking tiers: exact beats prefix beats fuzzy; score only orders hits within a tier. */
const TIERS = [
  { prefix: false, fuzzy: false },
  { prefix: true, fuzzy: false },
  // Part numbers one or two characters apart are different parts: at most one edit, long terms only.
  { prefix: false, fuzzy: (term: string) => (term.length >= 5 ? 1 : false) },
] as const
/** A match on the whole compact query is stronger than a match on one raw token. */
const COMPACT_BOOST = 2

const compareIds = (a: Id, b: Id): number => (a < b ? -1 : a > b ? 1 : 0)
/** The order documents enter the index in, which is the order of hits that tie. Never the snapshot's row order: a fresh
 *  load holds rows in SQL order, a patched snapshot holds the rows a write returned at the end. */
const itemOrder = (a: Item, b: Item): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || compareIds(a.id, b.id)
const variantOrder = (a: Variant, b: Variant): number =>
  compareIds(a.itemId, b.itemId) || a.position - b.position || compareIds(a.id, b.id)

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
  const activeItems = s.items.filter((i) => i.archivedAt === null && !folderHidden(i.folderId)).sort(itemOrder)
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
  for (const v of [...s.variants].sort(variantOrder)) {
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
    tokenize,
    storeFields: ['itemId', 'variantId'],
    searchOptions: { boost: { name: 2 } },
  })
  index.addAll(docs)

  return {
    search(query, limit = DEFAULT_LIMIT) {
      if (query.trim() === '' || limit <= 0) return []
      const compactQuery = compact(query)
      type Rank = { tier: number; score: number }
      const better = (a: Rank, b: Rank) => a.tier < b.tier || (a.tier === b.tier && a.score > b.score)
      const ranks = new Map<string, Rank & { itemId: Id; variantId: Id | null }>()
      const collect = (q: string, fields: string[], boost: number) => {
        if (q === '') return
        TIERS.forEach((opts, tier) => {
          for (const r of index.search(q, { fields, ...opts })) {
            const cand = { tier, score: r.score * boost }
            const prev = ranks.get(r.id)
            if (!prev || better(cand, prev)) {
              ranks.set(r.id, { ...cand, itemId: r.itemId as Id, variantId: r.variantId as Id | null })
            }
          }
        })
      }
      collect(query, ['name', 'extra'], 1)
      collect(compactQuery, ['compact'], COMPACT_BOOST)

      const byItem = new Map<Id, { rank: Rank; variant: (Rank & { id: Id }) | null }>()
      for (const r of ranks.values()) {
        const e = byItem.get(r.itemId) ?? { rank: r, variant: null }
        if (better(r, e.rank)) e.rank = r
        if (r.variantId !== null && (!e.variant || better(r, e.variant))) e.variant = { ...r, id: r.variantId }
        byItem.set(r.itemId, e)
      }
      return [...byItem.entries()]
        .sort((a, b) => (better(a[1].rank, b[1].rank) ? -1 : better(b[1].rank, a[1].rank) ? 1 : 0))
        .slice(0, limit)
        .map(([itemId, e]) => ({ itemId, variantId: e.variant?.id ?? null }))
    },
  }
}

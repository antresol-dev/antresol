import MiniSearch from 'minisearch'
import type { Id } from './ids'
import type { Attribute, InventorySnapshot, Item, Variant } from './model'
import { compareNumberValues, isCanonicalNumber, parseNumberValue, type NumberValue } from './numbers'
import { variantLabel } from './variants'

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
/** An equal number is as good as an exact text match; it outranks the score of any text hit within the exact tier. */
const NUMBER_SCORE = 100

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

export interface SearchOptions {
  /** false: exact and prefix hits only, no typo tolerance ("is this one I already have?"). Default true. */
  fuzzy?: boolean
  /** 'AND': a text hit needs every token of the query (default 'OR': any token). Number matches are unaffected. */
  combineWith?: 'AND' | 'OR'
}

export function createSearch(s: InventorySnapshot): { search(query: string, limit?: number, options?: SearchOptions): SearchHit[] } {
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

  // Number values by indexed document (spec 4.11): shared values on the item, axis values on the variant.
  const numberAttrs = new Map(s.attributes.filter((a) => a.kind === 'number').map((a) => [a.id, a] as const))
  const numbers = new Map<string, { attr: Attribute; value: string }[]>()
  const addNumber = (docId: string, attributeId: Id, value: string | null) => {
    const attr = numberAttrs.get(attributeId)
    // Only canonical values: one malformed stored value must not break every search.
    if (attr && value && isCanonicalNumber(value)) numbers.set(docId, [...(numbers.get(docId) ?? []), { attr, value }])
  }
  for (const a of s.itemAttributes) if (a.axisPosition === null) addNumber(`i:${a.itemId}`, a.attributeId, a.value)
  for (const a of s.variantAttributeValues) addNumber(`v:${a.variantId}`, a.attributeId, a.value)

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
    const label = variantLabel(s, v)
    docs.push({
      id: `v:${v.id}`,
      itemId: v.itemId,
      variantId: v.id,
      name: label,
      compact: [label, ...attrs].map(compact).join(' '),
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
  const docById = new Map(docs.map((d) => [d.id, d] as const))

  return {
    search(query, limit = DEFAULT_LIMIT, options = {}) {
      if (query.trim() === '' || limit <= 0) return []
      const compactQuery = compact(query)
      type Rank = { tier: number; score: number }
      const better = (a: Rank, b: Rank) => a.tier < b.tier || (a.tier === b.tier && a.score > b.score)
      const ranks = new Map<string, Rank & { itemId: Id; variantId: Id | null }>()
      const collect = (q: string, fields: string[], boost: number) => {
        if (q === '') return
        TIERS.forEach((opts, tier) => {
          if (opts.fuzzy && options.fuzzy === false) return
          for (const r of index.search(q, { fields, ...opts, combineWith: options.combineWith ?? 'OR' })) {
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

      // Each word is read by the rules of each number attribute and must equal one of that attribute's values. The
      // whole query counts as a word too ("4 k7"). A number match adds to the text match, it does not replace it.
      const words = [...new Set([...query.split(/\s+/), query.trim()].filter((w) => w !== ''))]
      // The words as read by one set of rules (unit and prefixes), parsed once per search rather than per stored value.
      const readings = new Map<string, NumberValue[]>()
      const read = (attr: Attribute): NumberValue[] => {
        const key = `${attr.siPrefixes}|${attr.unit}`
        let parsed = readings.get(key)
        if (!parsed) {
          parsed = words.map((w) => parseNumberValue(w, attr)).filter((n): n is NumberValue => n !== null)
          readings.set(key, parsed)
        }
        return parsed
      }
      for (const [docId, values] of numbers) {
        const doc = docById.get(docId)
        if (!doc) continue
        const hit = values.some(({ attr, value }) => read(attr).some((n) => compareNumberValues(n, value) === 0))
        if (!hit) continue
        const cand = { tier: 0, score: NUMBER_SCORE }
        const prev = ranks.get(docId)
        if (!prev || better(cand, prev)) ranks.set(docId, { ...cand, itemId: doc.itemId, variantId: doc.variantId })
      }

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

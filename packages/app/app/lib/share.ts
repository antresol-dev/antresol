import {
  addQ,
  cmpQ,
  compareNumberValues,
  formatAmount,
  isCanonicalNumber,
  parseNumberValue,
  type Attribute,
  type Id,
  type InventorySnapshot,
  type Quantity,
  type SourceReceipt,
} from '@graymatter/core'
import { existingMatches, kiloK, type MatchRow } from './quick-add'
import { nearestSuggestion, suffixed, unitOf, VALUE_WORD, type NearestSuggestion } from './nearest'
import { pathOf, snapshotIndex, stockQuantity } from './views'

/** What the system share sheet (PWA share target, GET) or a paste hands over. On Android the link comes inside `text`. */
export interface ShareInput {
  title?: string | null
  text?: string | null
  url?: string | null
}
export interface ParsedShare {
  /** The shop title without lot sizes, sales words and signs: what is searched. */
  query: string
  /** The first web address shared (the url parameter first). */
  url: string | null
  /** What earlier receipts are matched by (lotKey). */
  lotKey: string | null
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'“”‘’]+/giu

/** `u` as a web address (http or https), trimmed; null for anything else. */
function webUrl(u: string | null | undefined): string | null {
  const t = u?.trim() ?? ''
  if (t === '') return null
  try {
    const parsed = new URL(t)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? t : null
  } catch {
    return null
  }
}

function firstUrl(text: string): string | null {
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const url = webUrl(m[0].replace(/[).,;:!?\]}>]+$/u, ''))
    if (url) return url
  }
  return null
}

/** A pattern that matches only whole words: no letter or digit right before or after it. */
const words = (source: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'giu')

/** Shop noise (spec 4.10, the list is the builder's): share-sheet phrases, sales words, lot sizes and prices. Longer
 *  phrases come before the words inside them. */
const NOISE: RegExp[] = [
  words('i just found this on aliexpress|found this on aliexpress|check out this product|check this out|look what i found'),
  words('aliexpress(?:\\s+\\d+)?'),
  words('100\\s*%\\s*(?:new|original|brand new)|new original|original new|brand new|new arrival|free shipping|fast shipping|fast delivery|hot sale|big sale|high quality|top quality|best price|in stock|wholesale|promotion|genuine|original|new|sale'),
  words('lot of \\d+|\\d+\\s*(?:pcs|pc|pieces|piece|шт)\\.?(?:\\s*/\\s*lot)?|pcs/lot|lot'),
  words('(?:us\\s*)?[$€£¥₽]\\s*\\d+(?:[.,]\\d+)?'),
]
/** Brackets and signs that never belong to a value; "/", "%", ".", ",", "-" stay inside words ("1/4W", "4.7K", "DIP-8"). */
const SIGNS = /[()[\]{}【】〔〕「」『』《》〈〉<>"“”„'‘’!?*~#|+=;:•·_&@^$€£¥₽]/gu
const EDGE_PUNCTUATION = /^[,./\\\-–—]+|[,./\\\-–—]+$/gu

/** The shop title as a query: without addresses, lot sizes ("600PCS", "Lot of 10"), sales words ("Free shipping",
 *  "New", "Original"), prices, brackets and signs. */
export function cleanTitle(text: string): string {
  let t = text.replace(URL_IN_TEXT, ' ')
  for (const re of NOISE) t = t.replace(re, ' ')
  return t
    .replace(SIGNS, ' ')
    .split(/\s+/)
    .map((w) => w.replace(EDGE_PUNCTUATION, ''))
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .join(' ')
}

/** What a receipt's link is matched by: the item id of an AliExpress address (`/item/<digits>.html` or `/i/<digits>.html`, any AliExpress
 *  host); elsewhere the address without scheme, `www.`, parameters or a trailing slash, lowercased. Null for a short
 *  AliExpress link (`a.aliexpress.com/_…`, which the browser cannot resolve), a bare host, or what is not a web address. */
export function lotKey(url: string): string | null {
  const ok = webUrl(url)
  if (!ok) return null
  const u = new URL(ok)
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host.split('.').includes('aliexpress')) return /\/(?:item|i)\/(\d+)\.html/i.exec(u.pathname)?.[1] ?? null
  const path = u.pathname.replace(/\/+$/, '')
  return path === '' ? null : `${host}${path}`.toLowerCase()
}

export function parseShare(input: ShareInput): ParsedShare {
  const title = input.title?.trim() ?? ''
  const text = input.text?.trim() ?? ''
  const url = webUrl(input.url) ?? firstUrl(text) ?? firstUrl(title)
  const fromText = cleanTitle(text)
  return { query: fromText !== '' ? fromText : cleanTitle(title), url, lotKey: url ? lotKey(url) : null }
}

/** A paste that opens the share sheet (Review Focus 5): a web address anywhere in it, or a long title (at least 40
 *  characters and 4 words). An ordinary query never does, even one that looks like a file or a host ("tl072.pdf"). */
export function isShareLike(text: string): boolean {
  const t = text.trim()
  if (firstUrl(t) !== null) return true
  return t.length >= 40 && t.split(/\s+/).length >= 4
}

/** The share route's query (`/share?title=…&text=…&url=…`) as share input; a repeated parameter counts once. */
export function shareParams(query: Record<string, unknown>): ShareInput {
  const one = (v: unknown): string | null =>
    typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null
  return { title: one(query.title), text: one(query.text), url: one(query.url) }
}

/** Up to five things the inventory has that look like the shared title (as existingMatches). */
export function shareMatches(query: string, s: InventorySnapshot, limit = 5): MatchRow[] {
  return existingMatches(query, s, limit)
}

export interface ValueChip {
  /** The word as written in the title: "10K". */
  text: string
  /** The stock of everything with that value, with the unit as a suffix ("100", "3 m"); '' when the units differ;
   *  null when nothing has the value. */
  number: string | null
  inStock: boolean
  /** Nothing has the value: the nearest smaller and larger ones ("No 4.7 kΩ — nearest: 4.3 kΩ (12) · 5.1 kΩ (40)"). */
  nearest?: NearestSuggestion
}

interface Holder {
  itemId: Id
  /** undefined: the whole item (a shared value). */
  variantId?: Id
  value: string
}

/** Each word of the title read by the rules of each number attribute of the inventory, as search reads it (Plan 7),
 *  with the stock of what has that value: "10K ✓ 120", "47K —". One chip per value, in title order. */
export function valueChips(query: string, s: InventorySnapshot): ValueChip[] {
  const ix = snapshotIndex(s)
  const numberAttributes = s.attributes.filter((a) => a.kind === 'number')
  if (numberAttributes.length === 0) return []
  const visible = (itemId: Id): boolean => {
    const item = ix.items.get(itemId)
    return !!item && item.archivedAt === null && (item.folderId === null || pathOf(ix, item.folderId).length > 0)
  }
  const holders = new Map<Id, Holder[]>()
  const hold = (attributeId: Id, h: Holder) => {
    if (h.value === '' || !isCanonicalNumber(h.value) || !visible(h.itemId)) return
    holders.set(attributeId, [...(holders.get(attributeId) ?? []), h])
  }
  for (const a of s.itemAttributes) if (a.axisPosition === null && a.value !== null) hold(a.attributeId, { itemId: a.itemId, value: a.value })
  const variants = new Map(s.variants.map((v) => [v.id, v] as const))
  for (const v of s.variantAttributeValues) {
    const variant = variants.get(v.variantId)
    if (!variant || variant.archivedAt !== null || v.value === null) continue
    hold(v.attributeId, { itemId: variant.itemId, variantId: variant.id, value: v.value })
  }

  const chips: ValueChip[] = []
  const seen = new Set<string>()
  for (const raw of query.split(/\s+/)) {
    const word = raw.replace(/[,;]+$/u, '')
    if (!VALUE_WORD.test(word)) continue
    const reading = kiloK(word)
    const parsed = numberAttributes.flatMap((a: Attribute) => {
      const value = parseNumberValue(reading, a)
      return value === null ? [] : [{ a, value }]
    })
    if (parsed.length === 0) continue
    const found = parsed.flatMap(({ a, value }) =>
      (holders.get(a.id) ?? []).filter((h) => compareNumberValues(h.value, value) === 0),
    )
    // The same value written another way ("10k", "10000Ω") is the same chip.
    const key = (found.length > 0 ? found.map((h) => `${h.itemId}:${h.variantId ?? ''}`) : parsed.map((p) => `${p.a.id}=${p.value}`))
      .sort()
      .join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const near = found.length === 0 ? nearestSuggestion(s, word) : null
    chips.push({ text: word, ...stockOf(s, found), ...(near ? { nearest: near } : {}) })
  }
  return chips
}

function stockOf(s: InventorySnapshot, holders: Holder[]): { number: string | null; inStock: boolean } {
  if (holders.length === 0) return { number: null, inStock: false }
  // Each bucket once: an item holding the value and one of its variants holding it too would count it twice.
  const unique = new Map(holders.map((h) => [`${h.itemId}:${h.variantId ?? ''}`, h] as const))
  let sum: Quantity = '0'
  let inStock = false
  const units = new Set<string>()
  for (const h of unique.values()) {
    const q = stockQuantity(s, h.itemId, h.variantId)
    if (cmpQ(q, '0') > 0) inStock = true
    sum = addQ(sum, q)
    units.add(unitOf(s, h.itemId).key)
  }
  return { number: units.size === 1 ? suffixed(sum, unitOf(s, [...unique.values()][0]!.itemId)) : '', inStock }
}

export interface BoughtRow {
  itemId: Id
  variantId: Id | null
  name: string
  variantName: string | null
  at: string
  /** "100 pcs" */
  bought: string
  /** What the bucket holds now (the whole item for a receipt without a variant): "37 pcs". */
  left: string
}

/** Earlier receipts of the shared lot (findReceiptsBySource), newest first as given, for items still in the inventory:
 *  "Bought on Aug 12, 2026: 100 pcs · 37 left". */
export function boughtRows(receipts: SourceReceipt[], s: InventorySnapshot): BoughtRow[] {
  const ix = snapshotIndex(s)
  const rows: BoughtRow[] = []
  for (const r of receipts) {
    const item = ix.items.get(r.itemId)
    if (!item || item.archivedAt !== null || (item.folderId !== null && pathOf(ix, item.folderId).length === 0)) continue
    const variant = r.variantId === null ? undefined : ix.variants.get(r.variantId)
    const live = variant && !variant.archived ? r.variantId : null
    const unit = unitOf(s, item.id)
    rows.push({
      itemId: item.id,
      variantId: live,
      name: item.name,
      variantName: live && variant ? variant.name : null,
      at: r.at,
      bought: formatAmount(r.quantity, unit),
      left: formatAmount(stockQuantity(s, item.id, live ?? undefined), unit),
    })
  }
  return rows
}

/** "Find in shops" (spec 4.10): search links by the item's name, no API. */
const SHOPS: [name: string, template: string][] = [
  ['LCSC', 'https://www.lcsc.com/search?q={q}'],
  ['AliExpress', 'https://www.aliexpress.com/wholesale?SearchText={q}'],
  ['Mouser', 'https://www.mouser.com/c/?q={q}'],
  ['Tayda', 'https://www.taydaelectronics.com/catalogsearch/result/?q={q}'],
  ['Thonk', 'https://www.thonk.co.uk/?s={q}&post_type=product'],
  ['Octopart', 'https://octopart.com/search?q={q}'],
]

export function shopLinks(name: string): { name: string; url: string }[] {
  const q = encodeURIComponent(name.trim())
  return SHOPS.map(([shop, template]) => ({ name: shop, url: template.replace('{q}', q) }))
}

import { BUILTIN_UNITS, cmpQ, resolveUnit, type Command, type Id, type InventorySnapshot, type SearchHit } from '@antresol/core'
import { amountExample, parseAmountText, parseMoneyText } from './amounts'
import { searchRows, snapshotSearch, type SearchRow } from './views'

export interface QuickAddInput {
  folderId: Id | null
  name: string
  unitKey: string
  amount: string
  price: string
  url: string
  /** The link the form opened with (from the share sheet). Left as it is and without an amount, it is not a receipt's
   *  link the person asked for: the item is created without it instead of demanding an amount. */
  prefilledUrl?: string
}
/** Ids the form keeps for as long as the dialog is open, so a retried submit sends the same command. */
export interface QuickAddIds {
  itemId: Id
  movementId: Id
}
export type QuickAddResult = { command: Extract<Command, { type: 'item.create' }> } | { errorKey: string; params?: Record<string, string> }

/** The quick add form as an `item.create` command, or the i18n key of what to fix. Everything about the name, the
 *  link's scheme and the limits is checked again by core when the command is applied. */
export function buildQuickAdd(input: QuickAddInput, s: InventorySnapshot, ids: QuickAddIds): QuickAddResult {
  const name = input.name.trim()
  if (name === '') return { errorKey: 'errors.domain.name_required' }
  const amountText = input.amount.trim()
  const priceText = input.price.trim()
  const typedUrl = input.url.trim()
  const url = typedUrl !== '' && typedUrl === input.prefilledUrl?.trim() && amountText === '' ? '' : typedUrl

  let quantity: string | null = null
  if (amountText !== '') {
    const unit = resolveUnit(input.unitKey, s.units)
    const parsed = unit ? parseAmountText(amountText, unit) : null
    if (parsed === null) return { errorKey: 'quickAdd.invalidAmount', params: { example: amountExample(unit ?? BUILTIN_UNITS.pcs) } }
    if (cmpQ(parsed, '0') > 0) quantity = parsed
  }
  if (quantity === null) {
    return priceText !== '' || url !== ''
      ? { errorKey: 'quickAdd.needsAmount' }
      : { command: create(input, s, name, null, ids) }
  }
  let totalPrice: number | null = null
  if (priceText !== '') {
    totalPrice = parseMoneyText(priceText, s.inventory.currency)
    if (totalPrice === null) return { errorKey: 'quickAdd.invalidPrice' }
  }
  return { command: create(input, s, name, { movementId: ids.movementId, quantity, totalPrice, sourceUrl: url === '' ? null : url }, ids) }
}

function create(
  input: QuickAddInput,
  s: InventorySnapshot,
  name: string,
  initialReceipt: Extract<Command, { type: 'item.create' }>['initialReceipt'],
  ids: QuickAddIds,
): Extract<Command, { type: 'item.create' }> {
  return {
    type: 'item.create',
    id: ids.itemId,
    inventoryId: s.inventory.id,
    folderId: input.folderId,
    name,
    description: null,
    unitKey: input.unitKey,
    tagIds: [],
    initialReceipt,
  }
}

/** A thing the inventory already has, as the quick add and share sheets list it: "NE5532P · Op-amps · 4 pcs". */
export type MatchRow = SearchRow

/** @internal Shops write kilo as "K" ("10K", "4K7"); K is no SI prefix, so it is read as "k" after a digit. */
export const kiloK = (text: string): string => text.replace(/(?<=\p{N})K/gu, 'k')

/** The base of a part number with a letter suffix: "tl072cp" -> "tl072", "NE5532P" -> "ne5532", "ATmega328P-PU" ->
 *  "atmega328"; null when there is none ("tl072", "10k", "DIP-8"). */
function partBase(word: string): string | null {
  const w = word.toLowerCase()
  if (!/^[\p{L}\p{N}-]+$/u.test(w)) return null
  const base = /^(.*\p{N})[\p{L}-]+$/u.exec(w)?.[1]
  return base && base.length >= 4 && /\p{L}/u.test(base) ? base : null
}

const compactLength = (s: string): number => s.replace(/[^\p{L}\p{N}]+/gu, '').length

/** The words worth searching: a one-character piece ("1" of "1/4W" or "1%", "R") would match every word starting with
 *  it as a prefix. Pieces split like core search's tokens; a decimal point between digits stays ("4.7k"). */
function searchWords(text: string): string {
  return text
    .split(/(?<!\p{N})\.|\.(?!\p{N})|[^\p{L}\p{N}.-]+/u)
    .filter((w) => compactLength(w) >= 2)
    .join(' ')
}

/** Up to `limit` items (or variants) the inventory already has under this name (spec 4.9), best first: exact and prefix
 *  hits of core search without typo tolerance, values read by the number attributes' rules, and the base of a part
 *  number both ways ("TL072CP" also finds "TL072"). Nothing for a name shorter than two letters or digits.
 *  `everyWord`: an item must match every significant word of the name (quick add: "LM358 DIP-8" must not find a TL072
 *  that merely has Package = DIP-8); the share sheet keeps any-word matching for its long shop titles. */
export function existingMatches(name: string, s: InventorySnapshot, limit = 3, opts: { everyWord?: boolean } = {}): MatchRow[] {
  const query = searchWords(kiloK(name.trim()))
  if (compactLength(query) < 2 || limit <= 0) return []
  const search = snapshotSearch(s)
  const hits: SearchHit[] = []
  const seen = new Set<Id>()
  const add = (found: SearchHit[]) => {
    for (const h of found) {
      if (seen.has(h.itemId)) continue
      seen.add(h.itemId)
      hits.push(h)
    }
  }
  const ALL = 1000
  const words = query.split(/\s+/)
  const find = (text: string, n: number): SearchHit[] => search.search(text, n, { fuzzy: false, combineWith: 'AND' })
  if (opts.everyWord && words.length > 1) {
    // Per word: the word itself or its part-number base; an item has to be in every word's set.
    let keep: Set<Id> | null = null as Set<Id> | null
    for (const word of words) {
      const base = partBase(word)
      const ids = new Set(find(word, ALL).map((h) => h.itemId))
      if (base) for (const h of find(base, ALL)) ids.add(h.itemId)
      const prev: Set<Id> | null = keep
      keep = prev ? new Set([...prev].filter((id) => ids.has(id))) : ids
      if (keep.size === 0) return []
    }
    const ok = keep ?? new Set<Id>()
    add(find(query, ALL).filter((h) => ok.has(h.itemId)))
    // Items that matched every word but not the whole query in one piece: the best hit of each word's own search.
    for (const word of words) add(find(word, ALL).filter((h) => ok.has(h.itemId)))
    return searchRows(s, hits.slice(0, limit))
  }
  add(search.search(query, limit, { fuzzy: false }))
  for (const word of words) {
    if (hits.length >= limit) break
    const base = partBase(word)
    if (base) add(search.search(base, limit, { fuzzy: false }))
  }
  return searchRows(s, hits.slice(0, limit))
}

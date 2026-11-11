import { cmpQ, resolveUnit, type Command, type Id, type InventorySnapshot, type SearchHit } from '@graymatter/core'
import { parseAmountText, parseMoneyText } from './amounts'
import { searchRows, snapshotSearch, type SearchRow } from './views'

export interface QuickAddInput {
  folderId: Id | null
  name: string
  unitKey: string
  amount: string
  price: string
  url: string
}
/** Ids the form keeps for as long as the dialog is open, so a retried submit sends the same command. */
export interface QuickAddIds {
  itemId: Id
  movementId: Id
}
export type QuickAddResult = { command: Extract<Command, { type: 'item.create' }> } | { errorKey: string }

/** The quick add form as an `item.create` command, or the i18n key of what to fix. Everything about the name, the
 *  link's scheme and the limits is checked again by core when the command is applied. */
export function buildQuickAdd(input: QuickAddInput, s: InventorySnapshot, ids: QuickAddIds): QuickAddResult {
  const name = input.name.trim()
  if (name === '') return { errorKey: 'errors.domain.name_required' }
  const amountText = input.amount.trim()
  const priceText = input.price.trim()
  const url = input.url.trim()

  let quantity: string | null = null
  if (amountText !== '') {
    const unit = resolveUnit(input.unitKey, s.units)
    const parsed = unit ? parseAmountText(amountText, unit) : null
    if (parsed === null) return { errorKey: 'quickAdd.invalidAmount' }
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
 *  number both ways ("TL072CP" also finds "TL072"). Nothing for a name shorter than two letters or digits. */
export function existingMatches(name: string, s: InventorySnapshot, limit = 3): MatchRow[] {
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
  add(search.search(query, limit, { fuzzy: false }))
  for (const word of query.split(/\s+/)) {
    if (hits.length >= limit) break
    const base = partBase(word)
    if (base) add(search.search(base, limit, { fuzzy: false }))
  }
  return searchRows(s, hits.slice(0, limit))
}

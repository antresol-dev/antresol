import type { Id } from '@antresol/core'

/** What the quick add form held when the person left it through "Open" on a match. */
export interface QuickAddDraft {
  inventoryId: Id
  folderId: Id | null
  name: string
  unitKey: string
  amount: string
  price: string
  url: string
  /** The link the form had been opened with from the share sheet (see QuickAddInput.prefilledUrl). */
  prefilledUrl?: string
  photo: File | null
}

// Lives as long as the page: a reload or a new session starts without it (spec H).
let draft: QuickAddDraft | null = null

/** Whether there is anything to keep: a name, an amount, a price, a link of the person's own or a photo. */
export function isWorthKeeping(d: QuickAddDraft): boolean {
  const ownUrl = d.url.trim() !== '' && d.url.trim() !== d.prefilledUrl?.trim()
  return d.name.trim() !== '' || d.amount.trim() !== '' || d.price.trim() !== '' || ownUrl || d.photo !== null
}

/** Remembers the draft; an empty one is dropped instead. */
export function saveDraft(d: QuickAddDraft): void {
  draft = isWorthKeeping(d) ? d : null
}

/** The draft for the next opening, once: taking it empties the store, so what was saved or carried into a receipt
 *  since cannot come back. Nothing for an opening with its own name or link (the share sheet) or for another inventory. */
export function takeDraft(inventoryId: Id, opening: { name: string; url: string }): QuickAddDraft | null {
  const d = draft
  if (!d || opening.name.trim() !== '' || opening.url.trim() !== '') return null
  draft = null
  return d.inventoryId === inventoryId ? d : null
}

/** After a save, a receipt made from the form, or an explicit discard. */
export function clearDraft(): void {
  draft = null
}

/** The shared link is kept only with an amount (the item is created without it otherwise): true while the form
 *  still holds that link as it came and no amount is typed. */
export function linkNeedsAmount(url: string, prefilledUrl: string | undefined, amount: string): boolean {
  const typed = url.trim()
  return typed !== '' && typed === prefilledUrl?.trim() && amount.trim() === ''
}

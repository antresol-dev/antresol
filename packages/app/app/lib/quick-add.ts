import { cmpQ, resolveUnit, type Command, type Id, type InventorySnapshot } from '@graymatter/core'
import { parseAmountText, parseMoneyText } from './amounts'

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

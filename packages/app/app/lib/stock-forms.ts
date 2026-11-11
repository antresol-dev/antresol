import { cmpQ, type Command, type Id, type UnitDef } from '@graymatter/core'
import { parseAmountText, parseMoneyText } from './amounts'

export type StockMode = 'receive' | 'use' | 'set' | 'transfer'
export interface StockFormInput {
  amount: string
  price: string
  url: string
  note: string
  toVariantId: Id | null
}
/** Ids the sheet keeps for one opening: a retried Save sends the same command. */
export interface StockIds {
  movementId: Id
  transferId: Id
  outMovementId: Id
  inMovementId: Id
}
export interface StockFormContext {
  itemId: Id
  variantId: Id | null
  unit: UnitDef
  currency: string
}

const orNull = (text: string): string | null => {
  const t = text.trim()
  return t === '' ? null : t
}

/** Form text → a stock command, or the i18n key of what is wrong. */
export function buildStockCommand(mode: StockMode, input: StockFormInput, ctx: StockFormContext, ids: StockIds): { command: Command } | { errorKey: string } {
  const quantity = parseAmountText(input.amount, ctx.unit)
  if (quantity === null || (mode !== 'set' && cmpQ(quantity, '0') <= 0)) return { errorKey: 'stockForm.invalidAmount' }
  const { itemId, variantId } = ctx
  const note = orNull(input.note)

  switch (mode) {
    case 'receive': {
      let totalPrice: number | null = null
      if (input.price.trim() !== '') {
        totalPrice = parseMoneyText(input.price, ctx.currency)
        if (totalPrice === null) return { errorKey: 'stockForm.invalidPrice' }
      }
      return {
        command: { type: 'stock.receive', movementId: ids.movementId, itemId, variantId, quantity, totalPrice, sourceUrl: orNull(input.url), note },
      }
    }
    case 'use':
      return { command: { type: 'stock.use', movementId: ids.movementId, itemId, variantId, quantity, note } }
    case 'set':
      return { command: { type: 'stock.set', movementId: ids.movementId, itemId, variantId, target: quantity, note } }
    case 'transfer':
      if (input.toVariantId === variantId) return { errorKey: 'stockForm.sameBucket' }
      return {
        command: {
          type: 'stock.transfer',
          transferId: ids.transferId,
          outMovementId: ids.outMovementId,
          inMovementId: ids.inMovementId,
          itemId,
          fromVariantId: variantId,
          toVariantId: input.toVariantId,
          quantity,
        },
      }
  }
}

/** '+' is a receipt of 1 without a price; '−' is a use of 1. */
export function quickStep(step: 'plus' | 'minus', ctx: Pick<StockFormContext, 'itemId' | 'variantId'>, movementId: Id): Command {
  const { itemId, variantId } = ctx
  return step === 'plus'
    ? { type: 'stock.receive', movementId, itemId, variantId, quantity: '1', totalPrice: null, sourceUrl: null, note: null }
    : { type: 'stock.use', movementId, itemId, variantId, quantity: '1', note: null }
}

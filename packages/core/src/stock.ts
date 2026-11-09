import type { Id } from './ids'
import type { InventorySnapshot } from './model'
import { addQ, cmpQ, type Quantity } from './quantity'
import { unitPrice } from './money'

export interface StockSummary {
  quantity: Quantity
  /** Minor units per unit of quantity. */
  avgUnitPrice: number | null
  lastUnitPrice: number | null
}

export function bucketStock(s: InventorySnapshot, itemId: Id, variantId: Id | null): StockSummary {
  const line = s.stock.find((l) => l.itemId === itemId && l.variantId === variantId)
  if (!line) return { quantity: '0', avgUnitPrice: null, lastUnitPrice: null }
  return {
    quantity: line.quantity,
    avgUnitPrice: cmpQ(line.pricedQuantity, '0') > 0 ? unitPrice(line.pricedTotal, line.pricedQuantity) : null,
    lastUnitPrice: line.lastPriced ? unitPrice(line.lastPriced.totalPrice, line.lastPriced.quantity) : null,
  }
}

/** Sum over all buckets of the item, excluding archived variants. */
export function itemStock(s: InventorySnapshot, itemId: Id): StockSummary {
  const archived = new Set(s.variants.filter((v) => v.archivedAt !== null).map((v) => v.id))
  let quantity: Quantity = '0'
  let pricedQuantity: Quantity = '0'
  let pricedTotal = 0
  let last: { totalPrice: number; quantity: Quantity; at: string } | null = null
  for (const l of s.stock) {
    if (l.itemId !== itemId || (l.variantId !== null && archived.has(l.variantId))) continue
    quantity = addQ(quantity, l.quantity)
    pricedQuantity = addQ(pricedQuantity, l.pricedQuantity)
    pricedTotal += l.pricedTotal
    if (l.lastPriced && (!last || l.lastPriced.at > last.at)) last = l.lastPriced
  }
  return {
    quantity,
    avgUnitPrice: cmpQ(pricedQuantity, '0') > 0 ? unitPrice(pricedTotal, pricedQuantity) : null,
    lastUnitPrice: last ? unitPrice(last.totalPrice, last.quantity) : null,
  }
}

export function isOutOfStock(sum: StockSummary): boolean {
  return cmpQ(sum.quantity, '0') <= 0
}

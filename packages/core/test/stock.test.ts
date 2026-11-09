import { describe, expect, it } from 'vitest'
import { bucketStock, isOutOfStock, itemStock } from '../src/stock'
import { item, makeSnapshot, stockLine, variant } from './fixtures'

const priced = stockLine('i', 'v1', '30', {
  pricedQuantity: '100',
  pricedTotal: 230,
  lastPriced: { totalPrice: 230, quantity: '100', at: '2026-01-02T00:00:00Z' },
})
const base = () =>
  makeSnapshot({
    items: [item('i', 'Wire')],
    variants: [variant('v1', 'i', 'a')],
    stock: [stockLine('i', null, '7'), priced],
  })

describe('stock', () => {
  it('itemStock sums buckets and prices', () => {
    expect(itemStock(base(), 'i')).toEqual({ quantity: '37', avgUnitPrice: 2.3, lastUnitPrice: 2.3 })
  })
  it('itemStock ignores archived variants', () => {
    const s = base()
    s.variants.push(variant('v2', 'i', 'b', { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'x' }))
    s.stock.push(stockLine('i', 'v2', '5'))
    expect(itemStock(s, 'i').quantity).toBe('37')
  })
  it('no prices gives null prices', () => {
    const s = makeSnapshot({ stock: [stockLine('i', null, '7')] })
    expect(itemStock(s, 'i')).toEqual({ quantity: '7', avgUnitPrice: null, lastUnitPrice: null })
  })
  it('bucketStock of a missing bucket is zero', () => {
    expect(bucketStock(base(), 'i', 'nope')).toEqual({ quantity: '0', avgUnitPrice: null, lastUnitPrice: null })
  })
  it('isOutOfStock', () => {
    expect(isOutOfStock({ quantity: '0', avgUnitPrice: null, lastUnitPrice: null })).toBe(true)
    expect(isOutOfStock({ quantity: '0.1', avgUnitPrice: null, lastUnitPrice: null })).toBe(false)
  })
})

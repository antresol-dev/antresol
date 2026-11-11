import { BUILTIN_UNITS } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { buildStockCommand, quickStep, type StockFormContext, type StockIds, type StockFormInput } from '../app/lib/stock-forms'

const ctx: StockFormContext = { itemId: 'item-1', variantId: 'var-1', unit: BUILTIN_UNITS.m, currency: 'USD' }
const ids: StockIds = { movementId: 'mov-1', transferId: 'tr-1', outMovementId: 'out-1', inMovementId: 'in-1' }
const input = (over: Partial<StockFormInput> = {}): StockFormInput => ({ amount: '', price: '', url: '', note: '', toVariantId: null, ...over })

describe('buildStockCommand', () => {
  it('receive: amount with a prefix, batch price, link and note', () => {
    const r = buildStockCommand('receive', input({ amount: '50cm', price: '19.99', url: ' https://shop.example ', note: '' }), ctx, ids)
    expect('command' in r && r.command).toMatchObject({
      type: 'stock.receive',
      itemId: 'item-1',
      variantId: 'var-1',
      quantity: '0.5',
      totalPrice: 1999,
      sourceUrl: 'https://shop.example',
      note: null,
    })
  })

  it('receive: price is optional, a bad price or amount is refused', () => {
    const ok = buildStockCommand('receive', input({ amount: '2', note: ' hi ' }), ctx, ids)
    expect('command' in ok && ok.command).toMatchObject({ quantity: '2', totalPrice: null, note: 'hi' })
    expect(buildStockCommand('receive', input({ amount: '2', price: 'abc' }), ctx, ids)).toEqual({ errorKey: 'stockForm.invalidPrice' })
    expect(buildStockCommand('receive', input({ amount: '0' }), ctx, ids)).toEqual({ errorKey: 'stockForm.invalidAmount' })
    expect(buildStockCommand('receive', input({ amount: '' }), ctx, ids)).toEqual({ errorKey: 'stockForm.invalidAmount' })
  })

  it('receive: expressions in the amount and the price', () => {
    const r = buildStockCommand('receive', input({ amount: '2.5m + 120cm', price: '12.5 * 2' }), ctx, ids)
    expect('command' in r && r.command).toMatchObject({ quantity: '3.7', totalPrice: 2500 })
    expect(buildStockCommand('use', input({ amount: '1/0' }), ctx, ids)).toEqual({ errorKey: 'stockForm.invalidAmount' })
    expect(buildStockCommand('receive', input({ amount: '2', price: '1+' }), ctx, ids)).toEqual({ errorKey: 'stockForm.invalidPrice' })
  })

  it('use: needs a positive amount', () => {
    expect(buildStockCommand('use', input({ amount: '0' }), ctx, ids)).toEqual({ errorKey: 'stockForm.invalidAmount' })
    const r = buildStockCommand('use', input({ amount: '3', note: 'project' }), ctx, ids)
    expect('command' in r && r.command).toMatchObject({ type: 'stock.use', quantity: '3', note: 'project' })
  })

  it('set: accepts zero', () => {
    const r = buildStockCommand('set', input({ amount: '0' }), ctx, ids)
    expect('command' in r && r.command).toMatchObject({ type: 'stock.set', target: '0', note: null })
    expect(buildStockCommand('set', input({ amount: '-1' }), ctx, ids)).toEqual({ errorKey: 'stockForm.invalidAmount' })
  })

  it('transfer: refuses the same bucket, moves to another', () => {
    expect(buildStockCommand('transfer', input({ amount: '1', toVariantId: 'var-1' }), ctx, ids)).toEqual({ errorKey: 'stockForm.sameBucket' })
    expect(buildStockCommand('transfer', input({ amount: '1', toVariantId: null }), { ...ctx, variantId: null }, ids)).toEqual({
      errorKey: 'stockForm.sameBucket',
    })
    const r = buildStockCommand('transfer', input({ amount: '1', toVariantId: 'var-2' }), ctx, ids)
    expect('command' in r && r.command).toMatchObject({
      type: 'stock.transfer',
      itemId: 'item-1',
      fromVariantId: 'var-1',
      toVariantId: 'var-2',
      quantity: '1',
    })
  })

  it('uses the ids it is given: the same form sends the same command', () => {
    const a = buildStockCommand('use', input({ amount: '1' }), ctx, ids)
    expect(buildStockCommand('use', input({ amount: '1' }), ctx, ids)).toEqual(a)
    expect('command' in a && a.command).toMatchObject({ movementId: 'mov-1' })
    const t = buildStockCommand('transfer', input({ amount: '1', toVariantId: 'var-2' }), ctx, ids)
    expect('command' in t && t.command).toMatchObject({ transferId: 'tr-1', outMovementId: 'out-1', inMovementId: 'in-1' })
  })
})

describe('quickStep', () => {
  it('plus and minus are a receipt and a use of one', () => {
    expect(quickStep('plus', ctx, 'm1')).toMatchObject({ type: 'stock.receive', quantity: '1', totalPrice: null, sourceUrl: null, note: null })
    expect(quickStep('minus', ctx, 'm2')).toMatchObject({ type: 'stock.use', quantity: '1', note: null })
  })
})

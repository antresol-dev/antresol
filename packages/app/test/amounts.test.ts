import { BUILTIN_UNITS, newId, type InventorySnapshot } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { amountPreview, parseAmountText, parseMoneyText, pricePreview, unitChoices } from '../app/lib/amounts'
import { dictionaryView } from '../app/lib/dictionaries'

const pcs = BUILTIN_UNITS.pcs
const m = BUILTIN_UNITS.m

describe('parseAmountText', () => {
  it('reads plain numbers with either decimal mark', () => {
    expect(parseAmountText('10k', pcs)).toBe('10000')
    expect(parseAmountText('1,5', pcs)).toBe('1.5')
    expect(parseAmountText('  10 ', pcs)).toBe('10')
  })

  it('reads the unit prefixes', () => {
    expect(parseAmountText('50cm', m)).toBe('0.5')
    expect(parseAmountText('2.5 mm', m)).toBe('0.0025')
    expect(parseAmountText('1km', m)).toBe('1000')
  })

  it('refuses empty, invalid, negative, too precise and foreign-prefix text', () => {
    for (const bad of ['', 'abc', '-1', '0.0000001', '10x']) expect(parseAmountText(bad, pcs)).toBeNull()
    expect(parseAmountText('0.5 um', m)).toBeNull()
  })
})

describe('parseMoneyText', () => {
  it('reads minor units', () => {
    expect(parseMoneyText('2.30', 'USD')).toBe(230)
    expect(parseMoneyText('2,3', 'USD')).toBe(230)
    expect(parseMoneyText('1500', 'JPY')).toBe(1500)
  })

  it('refuses empty, negative, too precise and unknown-currency text', () => {
    for (const [bad, cur] of [['1.5', 'JPY'], ['-1', 'USD'], ['1.234', 'USD'], ['', 'USD'], ['1', 'XXQ']] as const) {
      expect(parseMoneyText(bad, cur)).toBeNull()
    }
  })
})

describe('unitChoices', () => {
  it('lists built-ins in order, then custom units by name', () => {
    const a = { id: newId(), name: 'Roll', symbol: 'rl', prefixPowers: [] }
    const b = { id: newId(), name: 'Box', symbol: 'bx', prefixPowers: [] }
    const s = { units: [a, b] } as unknown as InventorySnapshot
    const keys = unitChoices(s).map((u) => u.name)
    expect(keys).toEqual(['Pieces', 'Meters', 'Grams', 'Liters', 'Box', 'Roll'])
    expect(unitChoices(s)[4]!.key).toBe(`custom:${b.id}`)
  })

  it('orders custom units like Tags & fields: case-insensitive, numbers in numeric order', () => {
    const unit = (name: string) => ({ id: newId(), name, symbol: name.slice(0, 2), prefixPowers: [] })
    const units = ['Roll 10', 'roll 9', 'Box', 'bag'].map(unit)
    const s = { units, items: [], tags: [], attributes: [], itemAttributes: [] } as unknown as InventorySnapshot
    const custom = unitChoices(s).slice(Object.keys(BUILTIN_UNITS).length)
    expect(custom.map((u) => u.name)).toEqual(['bag', 'Box', 'roll 9', 'Roll 10'])
    expect(custom.map((u) => u.key)).toEqual(dictionaryView(s).units.filter((u) => u.custom).map((u) => u.unit.key))
  })
})

describe('expressions in fields', () => {
  it('amounts: sums with units, products, brackets', () => {
    expect(parseAmountText('2.5m + 120cm', m)).toBe('3.7')
    expect(parseAmountText('3 * 1.5k', pcs)).toBe('4500')
    expect(parseAmountText('5x100', pcs)).toBe('500')
    expect(parseAmountText('(1+2)×3', pcs)).toBe('9')
    expect(parseAmountText('10/4', pcs)).toBe('2.5')
  })

  it('amounts: broken or negative expressions are no amount', () => {
    for (const bad of ['1+', '2-5', '1/0', '2*(3', '5x']) expect(parseAmountText(bad, pcs)).toBeNull()
  })

  it('prices: expressions, rounded to the currency decimals', () => {
    expect(parseMoneyText('2.30 + 1.1', 'USD')).toBe(340)
    expect(parseMoneyText('10/3', 'USD')).toBe(333)
    expect(parseMoneyText('1500/3', 'JPY')).toBe(500)
    expect(parseMoneyText('1-5', 'USD')).toBeNull()
  })

  it('previews an expression only', () => {
    expect(amountPreview('2.5m + 120cm', m)).toEqual({ text: '3.7 m' })
    expect(amountPreview('2.5m', m)).toBeNull()
    expect(amountPreview('', m)).toBeNull()
    expect(amountPreview('1/0', pcs)).toEqual({ errorKey: 'expression.divide_by_zero' })
    expect(amountPreview('1-3', pcs)).toEqual({ errorKey: 'expression.negative' })
    expect(pricePreview('10/3', 'USD')).toEqual({ text: '3.33' })
    expect(pricePreview('19.99', 'USD')).toBeNull()
  })
})

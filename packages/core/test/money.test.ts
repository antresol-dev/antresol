import { describe, expect, it } from 'vitest'
import { CURRENCIES, getCurrency, parseMoney, unitPrice } from '../src/money'

describe('money', () => {
  const usd = getCurrency('USD')!, jpy = getCurrency('JPY')!
  it('has currencies', () => {
    expect(usd.decimals).toBe(2)
    expect(Object.keys(CURRENCIES).length).toBeGreaterThanOrEqual(150)
  })
  it('parses money', () => {
    expect(parseMoney('2,30', usd)).toBe(230)
    expect(parseMoney('1000', jpy)).toBe(1000)
    expect(parseMoney('0.023', usd)).toBeNull()
    expect(parseMoney('-1', usd)).toBeNull()
  })
  it('unit price', () => {
    expect(unitPrice(230, '100')).toBeCloseTo(2.3)
  })
})

import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatMoney, formatUnitPrice } from '../app/lib/format'

describe('format', () => {
  it('formats money in the currency decimals', () => {
    expect(formatMoney(230, 'USD')).toBe('$2.30')
    expect(formatMoney(1500, 'JPY')).toBe('¥1,500')
  })

  it('formats unit prices: currency decimals from one unit up, 3 significant digits below', () => {
    expect(formatUnitPrice(230 / 37, 'USD')).toBe('$0.0622')
    expect(formatUnitPrice(0.456, 'USD')).toBe('$0.00456')
    expect(formatUnitPrice(1250, 'USD')).toBe('$12.50')
  })

  it('keeps at least the currency decimals below one unit', () => {
    expect(formatUnitPrice(50, 'USD')).toBe('$0.50')
    expect(formatUnitPrice(99.96, 'USD')).toBe('$1.00')
    expect(formatUnitPrice(2.3, 'USD')).toBe('$0.023')
    expect(formatUnitPrice(0.5, 'JPY')).toBe('¥0.5')
  })

  it('formats dates', () => {
    expect(formatDate('2026-11-10T12:00:00Z')).toBe('Nov 10, 2026')
    expect(formatDateTime('2026-11-10T12:00:00Z')).toMatch(/^Nov 10, 2026, \d{1,2}:\d{2}\s(AM|PM)$/)
  })
})

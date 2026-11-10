import { describe, expect, it } from 'vitest'
import { BUILTIN_UNITS, formatAmount, formatAmountParts, parseAmount } from '../src/units'

const { m, pcs } = BUILTIN_UNITS
describe('units', () => {
  it('formats', () => {
    expect(formatAmount('1500', m)).toBe('1.5 km')
    expect(formatAmount('0.25', m)).toBe('25 cm')
    expect(formatAmount('1.23456', m)).toBe('1.235 m')
    expect(formatAmount('0', m)).toBe('0 m')
    expect(formatAmount('37', pcs)).toBe('37 pcs')
  })
  it('formats in parts', () => {
    expect(formatAmountParts('1500', m)).toEqual({ number: '1.5', unit: 'km' })
    expect(formatAmountParts('37', pcs)).toEqual({ number: '37', unit: 'pcs' })
  })
  it('parses', () => {
    expect(parseAmount('150cm', m)).toBe('1.5')
    expect(parseAmount('1.5 k', m)).toBe('1500')
    expect(parseAmount('5 mm', m)).toBe('0.005')
    expect(parseAmount('12', pcs)).toBe('12')
    expect(parseAmount('2k', pcs)).toBeNull()
  })
})

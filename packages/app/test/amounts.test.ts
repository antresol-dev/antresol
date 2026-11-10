import { BUILTIN_UNITS, newId, type InventorySnapshot } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { parseAmountText, parseMoneyText, unitChoices } from '../app/lib/amounts'

const pcs = BUILTIN_UNITS.pcs
const m = BUILTIN_UNITS.m

describe('parseAmountText', () => {
  it('reads plain numbers with either decimal mark', () => {
    expect(parseAmountText('1,5', pcs)).toBe('1.5')
    expect(parseAmountText('  10 ', pcs)).toBe('10')
  })

  it('reads the unit prefixes', () => {
    expect(parseAmountText('50cm', m)).toBe('0.5')
    expect(parseAmountText('2.5 mm', m)).toBe('0.0025')
    expect(parseAmountText('1km', m)).toBe('1000')
  })

  it('refuses empty, invalid, negative, too precise and foreign-prefix text', () => {
    for (const bad of ['', 'abc', '-1', '0.0000001', '10k']) expect(parseAmountText(bad, pcs)).toBeNull()
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
})

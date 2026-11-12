import { describe, expect, it } from 'vitest'
import {
  compareNumberValues,
  formatNumberValue,
  isCanonicalNumber,
  parseNumberValue,
  type NumberRules,
} from '../src/numbers'

const ohm: NumberRules = { unit: 'Ω', siPrefixes: true }
const farad: NumberRules = { unit: 'F', siPrefixes: true }
const meter: NumberRules = { unit: 'm', siPrefixes: true }
const plainOhm: NumberRules = { unit: 'Ω', siPrefixes: false }
const bare: NumberRules = { unit: '', siPrefixes: true }
const count: NumberRules = { unit: '', siPrefixes: false }

describe('parseNumberValue', () => {
  const cases: [string[], NumberRules, string | null][] = [
    [['4k7', '4.7k', '4,7к', '4700', '4.7 kΩ', '4.7kΩ', '  4.7 k '], ohm, '4700'],
    [['100p'], farad, '0.0000000001'],
    [['4,7p', '4700f'], farad, '0.0000000000047'],
    [['1e-9'], farad, '0.000000001'],
    [['4E7'], ohm, '40000000'],
    [['5E'], ohm, '5000000000000000000'],
    [['5m'], meter, '5'],
    [['5mm'], meter, '0.005'],
    [['5k'], meter, '5000'],
    [['1M', '1М'], ohm, '1000000'],
    [['1m', '1м'], ohm, '0.001'],
    [['100мк', '100u', '100µ', '100μ'], farad, '0.0001'],
    [['2u2'], farad, '0.0000022'],
    [['-40'], count, '-40'],
    [['-0'], count, '0'],
    [['0.50'], count, '0.5'],
    [['007'], count, '7'],
    [['4700 Ω', '4700'], plainOhm, '4700'],
    [['4k7'], plainOhm, null],
    [['4.7 Ohm'], ohm, null],
    [['', 'abc', '4k7k', 'k47', '1.2.3', '1da'], ohm, null],
    [['1234567890123456'], count, null],
    [['1e999999999', '1e40', '1e-40'], count, null],
  ]
  for (const [inputs, rules, expected] of cases) {
    for (const input of inputs) {
      it(`${JSON.stringify(input)} with ${rules.unit || 'no unit'}/${rules.siPrefixes} -> ${expected}`, () => {
        expect(parseNumberValue(input, rules)).toBe(expected)
      })
    }
  }
})

describe('formatNumberValue', () => {
  const cases: [string, NumberRules, string][] = [
    ['4700', ohm, '4.7 kΩ'],
    ['0.0000001', farad, '100 nF'],
    ['0', ohm, '0 Ω'],
    ['0.0000000000000000000000001', farad, '0.1 yF'],
    ['1000000000000000000000000000', ohm, '1000 YΩ'],
    ['4700', plainOhm, '4700 Ω'],
    ['4700', bare, '4.7k'],
    ['14', count, '14'],
    ['-40', { unit: 'V', siPrefixes: true }, '-40 V'],
    ['999.5', ohm, '999.5 Ω'],
    ['1000', bare, '1k'],
  ]
  for (const [value, rules, expected] of cases) {
    it(`${value} -> ${expected}`, () => {
      expect(formatNumberValue(value, rules)).toBe(expected)
    })
  }
})

describe('isCanonicalNumber', () => {
  it('accepts canonical values', () => {
    for (const s of ['4700', '0', '-40', '0.0000000001']) expect(isCanonicalNumber(s)).toBe(true)
  })
  it('rejects the rest', () => {
    const bad = [
      '04700', '4700.0', '-0', '1e3', '', '1234567890123456',
      '1' + '0'.repeat(30),
      '0.' + '0'.repeat(30) + '1',
    ]
    for (const s of bad) expect(isCanonicalNumber(s)).toBe(false)
  })
  it('accepts the range edges', () => {
    expect(isCanonicalNumber('9' + '0'.repeat(29))).toBe(true)
    expect(isCanonicalNumber('0.' + '0'.repeat(29) + '1')).toBe(true)
  })
})

describe('compareNumberValues', () => {
  it('compares exactly', () => {
    expect(compareNumberValues('4700', '10000')).toBe(-1)
    expect(compareNumberValues('-1', '0.5')).toBe(-1)
    expect(compareNumberValues('0.0000000001', '0.00000000001')).toBe(1)
    expect(compareNumberValues('4700', '4700')).toBe(0)
    expect(compareNumberValues('-2', '-10')).toBe(1)
  })
})

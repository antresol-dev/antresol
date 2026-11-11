import { describe, expect, it } from 'vitest'
import { evaluateAmount, evaluatePrice } from '../src/expressions'
import { BUILTIN_UNITS } from '../src/units'

const { pcs, m } = BUILTIN_UNITS
const amount = (s: string, unit = pcs) => evaluateAmount(s, unit)

describe('evaluateAmount', () => {
  it.each([
    ['5x100', '500'],
    ['5×100', '500'],
    ['5*100', '500'],
    ['5 X 100', '500'],
    ['2+3x4', '14'],
    ['(2+3)x4k', '20000'],
    ['10/3', '3.333333'],
    ['2/3', '0.666667'],
    ['1,5 + 2.25', '3.75'],
    ['10÷4', '2.5'],
    ['-2+5', '3'],
    ['0.1+0.2', '0.3'],
    ['3 * 1.5k', '4500'],
    ['2M', '2000000'],
    ['2-2', '0'],
    ['100/3x3', '100'],
    ['1/3*3', '1'],
    ['1/3+1/3+1/3', '1'],
    ['2/3x3/2', '1'],
    ['(1/7)x7000000', '1000000'],
  ])('%s -> %s (pieces)', (input, value) => {
    expect(amount(input)).toEqual({ value })
  })

  it('reads units and prefixes of each number', () => {
    expect(amount('2.5m + 120cm', m)).toEqual({ value: '3.7' })
    expect(amount('2.5 m + 1.2 m', m)).toEqual({ value: '3.7' })
    expect(amount('1/3 m', m)).toEqual({ value: '0.333333' })
    expect(amount('1km + 5mm', m)).toEqual({ value: '1000.005' })
  })

  it('reads x right after a unit or a prefix as multiplication', () => {
    expect(amount('2mx3', m)).toEqual({ value: '6' })
    expect(amount('2mX3', m)).toEqual({ value: '6' })
    expect(amount('50cmx4', m)).toEqual({ value: '2' })
    expect(amount('1.5kx3')).toEqual({ value: '4500' })
    expect(amount('3pcsx2')).toEqual({ value: '6' })
    expect(amount('3pcs x2')).toEqual({ value: '6' })
    expect(amount('2qx3', m)).toEqual({ error: 'unit' })
    expect(amount('2mx', m)).toEqual({ error: 'syntax' })
    const box = { key: 'u:1', name: 'Boxes', symbol: 'box', prefixPowers: [] }
    expect(amount('3box', box)).toEqual({ value: '3' })
    expect(amount('3boxx2', box)).toEqual({ value: '6' })
  })

  it('rounds once, at the end', () => {
    expect(evaluateAmount('1/3x3', pcs, 0)).toEqual({ value: '1' })
    expect(evaluateAmount('0.4+0.4', pcs, 0)).toEqual({ value: '1' })
    expect(evaluateAmount('1/8', pcs, 2)).toEqual({ value: '0.13' })
    expect(amount('1/3000000x3')).toEqual({ value: '0.000001' })
  })

  it('rounds the quotient half up to the precision', () => {
    expect(evaluateAmount('1/8', pcs, 2)).toEqual({ value: '0.13' })
    expect(evaluateAmount('1/3', pcs, 0)).toEqual({ value: '0' })
    expect(amount('0.0000005')).toEqual({ value: '0.000001' })
    expect(amount('0.0000004')).toEqual({ value: '0' })
  })

  it('is exact where floats are not', () => {
    expect(amount('0.1x3')).toEqual({ value: '0.3' })
    expect(amount('123456789012x1000000')).toEqual({ value: '123456789012000000' })
  })

  it.each(['5x', '()', '', '  ', '+', '2 3', '(2+3', '2+3)', '1..2', 'x5', '5 x x 5', '.', '4k7+'])(
    '%j is a syntax error',
    (input) => {
      expect(amount(input)).toEqual({ error: 'syntax' })
    },
  )

  it('rejects units the item does not have', () => {
    expect(amount('3 kg', m)).toEqual({ error: 'unit' })
    expect(amount('3 kg')).toEqual({ error: 'unit' })
    expect(amount('2m + 3q', m)).toEqual({ error: 'unit' })
    expect(amount('2^3')).toEqual({ error: 'unit' })
    expect(amount('3k', m)).toEqual({ value: '3000' })
  })

  it('reports division by zero and negative totals', () => {
    expect(amount('1/0')).toEqual({ error: 'divide_by_zero' })
    expect(amount('1/(2-2)')).toEqual({ error: 'divide_by_zero' })
    expect(amount('2-5')).toEqual({ error: 'negative' })
    expect(amount('-1')).toEqual({ error: 'negative' })
  })

  it('refuses absurdly long or deep input', () => {
    expect(amount('1+'.repeat(200) + '1')).toEqual({ error: 'syntax' })
    expect(amount('('.repeat(60) + '1' + ')'.repeat(60))).toEqual({ error: 'syntax' })
  })
})

describe('evaluatePrice', () => {
  it('evaluates at the given fraction digits, rounding once', () => {
    expect(evaluatePrice('1/200.02', 2)).toEqual({ value: '0' })
    expect(evaluatePrice('1/199.98', 2)).toEqual({ value: '0.01' })
    expect(evaluatePrice('10/3', 2)).toEqual({ value: '3.33' })
    expect(evaluatePrice('1500/7', 0)).toEqual({ value: '214' })
    expect(evaluatePrice('10/3x3', 2)).toEqual({ value: '10' })
  })
  it('keeps 4 fraction digits by default', () => {
    expect(evaluatePrice('10/3')).toEqual({ value: '3.3333' })
    expect(evaluatePrice('2/3')).toEqual({ value: '0.6667' })
    expect(evaluatePrice('4,5 x 3')).toEqual({ value: '13.5' })
    expect(evaluatePrice('(1.20+0.30)x10')).toEqual({ value: '15' })
  })
  it('has no units and no negatives', () => {
    expect(evaluatePrice('3 kg')).toEqual({ error: 'unit' })
    expect(evaluatePrice('1-2')).toEqual({ error: 'negative' })
    expect(evaluatePrice('1/0')).toEqual({ error: 'divide_by_zero' })
    expect(evaluatePrice('5x')).toEqual({ error: 'syntax' })
  })
})

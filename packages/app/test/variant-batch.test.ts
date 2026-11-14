import { describe, expect, it } from 'vitest'
import { isNewLine, planVariantBatch } from '../app/lib/variant-batch'
import { axisSnapshot } from './fixtures/axis-snapshot'

describe('planVariantBatch', () => {
  it('reads a single number axis, with a decimal comma, and flags a repeat', () => {
    const lines = planVariantBatch(axisSnapshot(), 'M', '')
    expect(lines).toEqual([])
    const s = axisSnapshot()
    const r = planVariantBatch(s, 'R', '2k, 4k7, 4,7k')
    expect(r.map((l) => l.label)).toEqual(['2 kΩ', '4.7 kΩ', '4.7 kΩ'])
    expect(r.map((l) => l.repeat)).toEqual([false, false, true])
  })

  it('reads one variant per line on several axes', () => {
    const lines = planVariantBatch(axisSnapshot(), 'C', '100n; 50V\n100n; 16V\n47n; 25V')
    expect(lines.map((l) => [l.label, l.error])).toEqual([
      ['100 nF · 50 V', null],
      ['100 nF · 16 V', null],
      ['47 nF · 25 V', null],
    ])
    expect(lines[0]!.duplicate).toMatchObject({ archived: false })
    expect(lines[1]!.duplicate).toBeNull()
  })

  it('needs a value on every axis', () => {
    const [line] = planVariantBatch(axisSnapshot(), 'C', '100n')
    expect(line!.error).toBe('errors.domain.axis_value_required')
    expect(isNewLine(line!)).toBe(false)
  })

  it('points at an archived variant with the same values', () => {
    const [line] = planVariantBatch(axisSnapshot(), 'R', '4k7')
    expect(line!.duplicate).toEqual({ variantId: 'r4k7', archived: true, archiveId: 'arch' })
  })

  it('reports a number that does not parse', () => {
    const [line] = planVariantBatch(axisSnapshot(), 'R', 'abc')
    expect(line!.error).toBe('errors.domain.invalid_number')
    expect(line!.values).toBeNull()
  })

  it('reads a quantity after the values and previews it', () => {
    const lines = planVariantBatch(axisSnapshot(), 'C', '100n; 50V; 10\n100n; 16V')
    expect(lines.map((l) => [l.label, l.quantity, l.quantityLabel, l.error])).toEqual([
      ['100 nF · 50 V', '10', '10 pcs', null],
      ['100 nF · 16 V', null, null, null],
    ])
  })

  it('reads a quantity on one axis and keeps the comma list without one', () => {
    const [one] = planVariantBatch(axisSnapshot(), 'R', '1k; 100')
    expect([one!.label, one!.quantity]).toEqual(['1 kΩ', '100'])
    const list = planVariantBatch(axisSnapshot(), 'R', '1k, 10k')
    expect(list.map((l) => [l.label, l.quantity])).toEqual([['1 kΩ', null], ['10 kΩ', null]])
  })

  it('always shows the unit on the quantity, also from a thousand up', () => {
    const [big] = planVariantBatch(axisSnapshot(), 'R', '1k; 10k')
    expect([big!.quantity, big!.quantityLabel]).toEqual(['10000', '10k pcs'])
  })

  it('explains a ";" list on one axis instead of asking for values', () => {
    const [line] = planVariantBatch(axisSnapshot(), 'R', '2k2; 4k7; 6k8')
    expect(line!.error).toBe('errors.domain.variant_line_too_long')
    expect(isNewLine(line!)).toBe(false)
  })

  it('accepts an expression as the quantity and refuses a bad or zero one', () => {
    const [expr] = planVariantBatch(axisSnapshot(), 'R', '2k; 5x100')
    expect(expr!.quantity).toBe('500')
    for (const bad of ['2k; abc', '2k; 0', '100n; 50V; 1; 2']) {
      const [line] = planVariantBatch(axisSnapshot(), bad.startsWith('100n') ? 'C' : 'R', bad)
      expect(line!.error).not.toBeNull()
      expect(isNewLine(line!)).toBe(false)
    }
    expect(planVariantBatch(axisSnapshot(), 'R', '2k; abc')[0]!.error).toBe('errors.domain.invalid_quantity')
  })
})

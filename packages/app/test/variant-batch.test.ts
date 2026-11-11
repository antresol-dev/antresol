import { describe, expect, it } from 'vitest'
import { isNewLine, planVariantBatch } from '../app/lib/variant-batch'
import { axisSnapshot } from './fixtures/axis-snapshot'

describe('planVariantBatch', () => {
  it('reads a single number axis, with a decimal comma, and flags a repeat', () => {
    const lines = planVariantBatch(axisSnapshot(), 'M', '')
    expect(lines).toEqual([])
    const s = axisSnapshot()
    const r = planVariantBatch(s, 'R', '2k, 4k7, 4,7k')
    expect(r.map((l) => l.label)).toEqual(['2 kΩ', '4.7 kΩ', '4.7 kΩ'])
    expect(r.map((l) => l.repeat)).toEqual([false, false, true])
  })

  it('reads one variant per line on several axes', () => {
    const lines = planVariantBatch(axisSnapshot(), 'C', '100n; 50V\n100n; 16V\n47n; 25V')
    expect(lines.map((l) => [l.label, l.error])).toEqual([
      ['100 nF · 50 V', null],
      ['100 nF · 16 V', null],
      ['47 nF · 25 V', null],
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
})

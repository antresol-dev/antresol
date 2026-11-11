import { describe, expect, it } from 'vitest'
import { memoryKeyValue } from '../app/lib/diagnostics'
import { createTrafficMeter, formatBytes } from '../app/lib/traffic'

describe('traffic meter', () => {
  it('sums the bytes of a source within a calendar month, and starts again in the next', async () => {
    const clock = { now: new Date('2026-11-03T10:00:00Z') }
    const meter = createTrafficMeter({ kv: memoryKeyValue(), now: () => clock.now })
    meter.add('a', 1000)
    meter.add('a', 500)
    meter.add('b', 7)
    expect(await meter.monthly('a')).toEqual({ month: '2026-11', bytes: 1500 })
    expect(await meter.monthly('b')).toEqual({ month: '2026-11', bytes: 7 })
    clock.now = new Date('2026-11-30T23:59:00Z')
    meter.add('a', 1)
    expect((await meter.monthly('a')).bytes).toBe(1501)
    clock.now = new Date('2026-12-01T00:01:00Z')
    expect(await meter.monthly('a')).toEqual({ month: '2026-12', bytes: 0 })
    meter.add('a', 20)
    expect(await meter.monthly('a')).toEqual({ month: '2026-12', bytes: 20 })
  })

  it('formats sizes', () => {
    expect(formatBytes(120 * 1024 ** 2)).toBe('120 MB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
    expect(formatBytes(2048)).toBe('2 KB')
  })
})

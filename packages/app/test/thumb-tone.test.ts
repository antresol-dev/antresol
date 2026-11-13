import { describe, expect, it } from 'vitest'
import { thumbTone } from '../app/lib/thumb-tone'

describe('thumbTone', () => {
  it('is stable for an id and within range', () => {
    const id = '0190b3c4-7a1e-7c2d-9f00-1234567890ab'
    expect(thumbTone(id, 6)).toBe(thumbTone(id, 6))
    expect(thumbTone(id, 6)).toBeGreaterThanOrEqual(0)
    expect(thumbTone(id, 6)).toBeLessThan(6)
  })
  it('spreads 600 random uuids over 6 tones, 60 to 140 each', () => {
    const counts = Array<number>(6).fill(0)
    for (let i = 0; i < 600; i++) counts[thumbTone(crypto.randomUUID(), 6)]!++
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(60)
      expect(c).toBeLessThanOrEqual(140)
    }
  })
  it('does not fail on an empty id', () => {
    expect(thumbTone('', 6)).toBeLessThan(6)
  })
})

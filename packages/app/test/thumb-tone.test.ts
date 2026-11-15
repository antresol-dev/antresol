import { describe, expect, it } from 'vitest'
import { thumbTone } from '../app/lib/thumb-tone'

describe('thumbTone', () => {
  it('is stable for an id and within range', () => {
    const id = '0190b3c4-7a1e-7c2d-9f00-1234567890ab'
    expect(thumbTone(id, 6)).toBe(thumbTone(id, 6))
    expect(thumbTone(id, 6)).toBeGreaterThanOrEqual(0)
    expect(thumbTone(id, 6)).toBeLessThan(6)
  })
  it('spreads 600 generated ids over 6 tones, 60 to 140 each', () => {
    // A seeded generator (mulberry32), so the check is the same on every run.
    let seed = 0x9e3779b9
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('')
    const counts = Array<number>(6).fill(0)
    for (let i = 0; i < 600; i++) counts[thumbTone(`${hex(8)}-${hex(4)}-7${hex(3)}-8${hex(3)}-${hex(12)}`, 6)]!++
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(60)
      expect(c).toBeLessThanOrEqual(140)
    }
  })
  it('does not fail on an empty id', () => {
    expect(thumbTone('', 6)).toBeLessThan(6)
  })
})

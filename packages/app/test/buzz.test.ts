import { afterEach, describe, expect, it, vi } from 'vitest'
import { buzz } from '../app/lib/stepper'

// The stepper's tick (owner, 2026-11-14: lighter on ± presses): 5 ms, at most one per 60 ms.
describe('buzz', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ticks for 5 ms and folds taps closer than 60 ms into one', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    buzz(1_000_000)
    buzz(1_000_030)
    buzz(1_000_061)
    expect(vibrate.mock.calls).toEqual([[5], [5]])
  })

  it('is silent where there is no vibration or it throws', () => {
    vi.stubGlobal('navigator', {})
    expect(() => buzz(2_000_000)).not.toThrow()
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked') } })
    expect(() => buzz(3_000_000)).not.toThrow()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { timeoutSignal } from '../src/executors/timeout'

afterEach(() => {
  vi.useRealTimers()
})

describe('timeoutSignal', () => {
  it('aborts with a TimeoutError after the delay', () => {
    vi.useFakeTimers()
    const { signal } = timeoutSignal(100)
    vi.advanceTimersByTime(99)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(signal.aborted).toBe(true)
    expect((signal.reason as Error).name).toBe('TimeoutError')
  })

  it('does not abort after clear() and leaves no timer behind', () => {
    vi.useFakeTimers()
    const { signal, clear } = timeoutSignal(100)
    clear()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(signal.aborted).toBe(false)
  })

  it('does not rely on AbortSignal.timeout', () => {
    vi.useFakeTimers()
    const original = AbortSignal.timeout
    // @ts-expect-error simulating an old browser
    AbortSignal.timeout = undefined
    try {
      const { signal } = timeoutSignal(10)
      vi.advanceTimersByTime(10)
      expect(signal.aborted).toBe(true)
    } finally {
      AbortSignal.timeout = original
    }
  })
})

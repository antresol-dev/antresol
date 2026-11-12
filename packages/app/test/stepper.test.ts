import { StorageError, type Id, type Quantity } from '@antresol/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStepper, flushWhenHidden, stepCommand } from '../app/lib/stepper'

type Sent = { delta: Quantity; movementId: Id }

/** A send that records its calls; `control.fail` makes the next calls reject, `hold()` keeps them pending until the
 *  returned release is called. */
function sender() {
  const sent: Sent[] = []
  const control = { fail: null as Error | null }
  let gate: Promise<void> | null = null
  const send = vi.fn(async (delta: Quantity, movementId: Id) => {
    sent.push({ delta, movementId })
    if (gate) await gate
    if (control.fail) throw control.fail
  })
  const hold = (): (() => void) => {
    let release!: () => void
    gate = new Promise<void>((r) => (release = r))
    return () => {
      gate = null
      release()
    }
  }
  return { sent, send, control, hold }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createStepper', () => {
  it('five presses within a second become one send of 5, two seconds after the last press', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    for (let n = 0; n < 5; n++) {
      st.press(1)
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(st.pending.value).toBe('5')
    expect(st.state.value).toBe('waiting')
    // The last press was 250 ms ago: 1 749 ms more is still within the wait.
    await vi.advanceTimersByTimeAsync(1749)
    expect(s.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0]!.delta).toBe('5')
    await vi.advanceTimersByTimeAsync(0)
    expect(st.state.value).toBe('idle')
    expect(st.pending.value).toBe('0')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(s.sent).toHaveLength(1)
  })

  it('adds plus and minus presses: +3 −1 sends +2; a sum of zero sends nothing', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    st.press(1)
    st.press(1)
    st.press(1)
    st.press(-1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.sent.map((x) => x.delta)).toEqual(['2'])
    st.press(1)
    st.press(-1)
    expect(st.state.value).toBe('idle')
    await vi.advanceTimersByTimeAsync(5000)
    expect(s.sent).toHaveLength(1)
  })

  it('sends a use as a negative delta', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    st.press(-1)
    st.press(-1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.sent.map((x) => x.delta)).toEqual(['-2'])
  })

  it('undo before the send drops the delta: nothing is sent', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    st.press(1)
    st.press(1)
    await vi.advanceTimersByTimeAsync(1500)
    st.undo()
    expect(st.pending.value).toBe('0')
    expect(st.state.value).toBe('idle')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(s.send).not.toHaveBeenCalled()
  })

  it('flush sends at once, and the timer does not send it again', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    st.press(1)
    st.press(1)
    const flushed = st.flush()
    expect(s.sent.map((x) => x.delta)).toEqual(['2'])
    expect(st.state.value).toBe('sending')
    await flushed
    expect(st.state.value).toBe('idle')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(s.sent).toHaveLength(1)
  })

  it('flush with nothing pending sends nothing', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    await st.flush()
    expect(s.send).not.toHaveBeenCalled()
  })

  it('a failed send keeps the delta; a retry sends it again with the same movementId', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    s.control.fail = new StorageError('unavailable')
    st.press(1)
    st.press(1)
    st.press(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(st.state.value).toBe('failed')
    expect(st.pending.value).toBe('3')
    expect(st.error.value).toBe(s.control.fail)
    // Presses wait for Retry or Discard: a changed delta under the same id would be dropped by the source.
    st.press(1)
    expect(st.pending.value).toBe('3')
    s.control.fail = null
    await st.retry()
    expect(s.sent.map((x) => x.delta)).toEqual(['3', '3'])
    expect(s.sent[1]!.movementId).toBe(s.sent[0]!.movementId)
    expect(st.state.value).toBe('idle')
    expect(st.error.value).toBeNull()
    // The next delta is a new movement.
    st.press(1)
    await st.flush()
    expect(s.sent[2]!.movementId).not.toBe(s.sent[0]!.movementId)
  })

  it('an unknown outcome marks the failed delta unconfirmed until it lands or is discarded, whatever the retries say', async () => {
    const s = sender()
    const unknownOutcome = (e: unknown): boolean => e instanceof StorageError && e.code === 'unavailable'
    const st = createStepper({ delayMs: 2000, send: s.send, unknownOutcome })
    s.control.fail = new StorageError('failed')
    st.press(1)
    await st.flush()
    expect([st.state.value, st.unconfirmed.value]).toEqual(['failed', false])
    s.control.fail = new StorageError('unavailable')
    await st.retry()
    expect(st.unconfirmed.value).toBe(true)
    // A refusal of the retry does not make the first attempt any less possibly landed.
    s.control.fail = new StorageError('read_only')
    await st.retry()
    expect([st.state.value, st.unconfirmed.value]).toEqual(['failed', true])
    st.discard()
    expect(st.unconfirmed.value).toBe(false)
    st.press(1)
    s.control.fail = new StorageError('unavailable')
    await st.flush()
    expect(st.unconfirmed.value).toBe(true)
    s.control.fail = null
    await st.retry()
    expect([st.state.value, st.unconfirmed.value]).toEqual(['idle', false])
  })

  it('flush of a failed delta retries it with the same movementId', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    s.control.fail = new StorageError('unavailable')
    st.press(-1)
    await st.flush()
    expect(st.state.value).toBe('failed')
    s.control.fail = null
    await st.flush()
    expect(s.sent).toHaveLength(2)
    expect(s.sent[1]).toEqual(s.sent[0])
    expect(st.state.value).toBe('idle')
  })

  it('discard drops a failed delta; the next one gets a new movementId', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    s.control.fail = new StorageError('unavailable')
    st.press(1)
    await st.flush()
    st.discard()
    expect(st.state.value).toBe('idle')
    expect(st.pending.value).toBe('0')
    s.control.fail = null
    st.press(1)
    await st.flush()
    expect(s.sent).toHaveLength(2)
    expect(s.sent[1]!.movementId).not.toBe(s.sent[0]!.movementId)
  })

  it('a slow send goes out once: flushes and presses meanwhile neither send it again nor change it', async () => {
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    const release = s.hold()
    st.press(1)
    st.press(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(st.state.value).toBe('sending')
    const again = st.flush()
    st.press(1)
    st.undo()
    expect(st.pending.value).toBe('2')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.sent).toHaveLength(1)
    release()
    await again
    expect(st.state.value).toBe('idle')
    expect(st.pending.value).toBe('0')
    expect(s.sent).toHaveLength(1)
  })

  it('"−" never takes the confirmed quantity plus the pending delta below zero', async () => {
    const s = sender()
    let available: Quantity = '2'
    const st = createStepper({ delayMs: 2000, send: s.send, available: () => available })
    expect(st.canDecrease.value).toBe(true)
    st.press(-1)
    st.press(-1)
    expect(st.canDecrease.value).toBe(false)
    st.press(-1)
    expect(st.pending.value).toBe('-2')
    // "+" frees one again.
    st.press(1)
    expect(st.canDecrease.value).toBe(true)
    st.undo()
    available = '0'
    st.press(-1)
    expect(st.pending.value).toBe('0')
    expect(st.state.value).toBe('idle')
    await vi.advanceTimersByTimeAsync(5000)
    expect(s.send).not.toHaveBeenCalled()
  })

  it('a fractional quantity below one cannot be stepped down', () => {
    const st = createStepper({ delayMs: 2000, send: async () => {}, available: () => '0.5' })
    expect(st.canDecrease.value).toBe(false)
    st.press(-1)
    expect(st.pending.value).toBe('0')
  })

  it('shows the total the delta leads to: live while waiting, from the quantity it was sent against afterwards', async () => {
    const s = sender()
    let available: Quantity = '10'
    const st = createStepper({ delayMs: 2000, send: s.send, available: () => available })
    expect(st.projected.value).toBe('10')
    st.press(1)
    st.press(1)
    expect(st.projected.value).toBe('12')
    const release = s.hold()
    void st.flush()
    // The source answered and the copy moved on before the send resolved: no double count.
    available = '12'
    expect(st.projected.value).toBe('12')
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(st.projected.value).toBe('12')
  })

  it('tells when the waiting delta goes out', async () => {
    const st = createStepper({ delayMs: 2000, send: async () => {}, now: () => Date.now() })
    expect(st.due.value).toBeNull()
    st.press(1)
    const first = st.due.value
    expect(first).toBe(Date.now() + 2000)
    await vi.advanceTimersByTimeAsync(500)
    st.press(1)
    expect(st.due.value).toBe(first! + 500)
    await st.flush()
    expect(st.due.value).toBeNull()
  })
})

describe('flushWhenHidden', () => {
  const fakeDocument = () => Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })

  it('flushes when the page is hidden or goes away, not when it becomes visible', () => {
    const doc = fakeDocument()
    const flush = vi.fn()
    const stop = flushWhenHidden(doc, flush)
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(flush).not.toHaveBeenCalled()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(flush).toHaveBeenCalledTimes(1)
    doc.dispatchEvent(new Event('pagehide'))
    expect(flush).toHaveBeenCalledTimes(2)
    stop()
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('a hidden page sends the waiting delta at once', async () => {
    const doc = fakeDocument()
    const s = sender()
    const st = createStepper({ delayMs: 2000, send: s.send })
    flushWhenHidden(doc, () => void st.flush())
    st.press(1)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(s.sent.map((x) => x.delta)).toEqual(['1'])
  })
})

describe('stepCommand', () => {
  const target = { itemId: 'item-1', variantId: 'var-1' }
  it('a positive delta is a receipt without a price, a negative one a use; zero is nothing', () => {
    expect(stepCommand('3', target, 'm-1')).toEqual({
      type: 'stock.receive',
      movementId: 'm-1',
      itemId: 'item-1',
      variantId: 'var-1',
      quantity: '3',
      totalPrice: null,
      sourceUrl: null,
      note: null,
    })
    expect(stepCommand('-2', target, 'm-2')).toEqual({
      type: 'stock.use',
      movementId: 'm-2',
      itemId: 'item-1',
      variantId: 'var-1',
      quantity: '2',
      note: null,
    })
    expect(stepCommand('0', target, 'm-3')).toBeNull()
  })
})

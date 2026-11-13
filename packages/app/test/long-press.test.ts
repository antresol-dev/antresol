import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { useLongPress, type LongPressHandlers } from '../app/composables/useLongPress'
import { longPressExpands } from '../app/lib/tree-state'

const touch = (x: number, y: number) => ({ pointerType: 'touch', clientX: x, clientY: y })
const event = () => ({ preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() })

let scope: EffectScope
let h: LongPressHandlers
let fired: number

beforeEach(() => {
  vi.useFakeTimers()
  fired = 0
  scope = effectScope()
  h = scope.run(() => useLongPress(() => fired++))!
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

describe('useLongPress', () => {
  it('fires after 500 ms of a touch press', () => {
    h.onPointerdown(touch(10, 10))
    vi.advanceTimersByTime(499)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fired).toBe(1)
  })

  it('ignores mouse and pen', () => {
    h.onPointerdown({ pointerType: 'mouse', clientX: 0, clientY: 0 })
    vi.advanceTimersByTime(600)
    h.onPointerdown({ pointerType: 'pen', clientX: 0, clientY: 0 })
    vi.advanceTimersByTime(600)
    expect(fired).toBe(0)
  })

  it('scrolling cancels the press, a small wobble does not', () => {
    h.onPointerdown(touch(10, 10))
    h.onPointermove({ clientX: 10, clientY: 21 })
    vi.advanceTimersByTime(600)
    expect(fired).toBe(0)

    h.onPointerdown(touch(10, 10))
    h.onPointermove({ clientX: 14, clientY: 16 })
    vi.advanceTimersByTime(600)
    expect(fired).toBe(1)
  })

  it('lifting or a cancel before 500 ms cancels', () => {
    h.onPointerdown(touch(10, 10))
    vi.advanceTimersByTime(300)
    h.onPointerup()
    vi.advanceTimersByTime(600)
    expect(fired).toBe(0)

    h.onPointerdown(touch(10, 10))
    vi.advanceTimersByTime(300)
    h.onPointercancel()
    vi.advanceTimersByTime(600)
    expect(fired).toBe(0)
  })

  it('swallows only the click right after a fired press', () => {
    h.onPointerdown(touch(10, 10))
    vi.advanceTimersByTime(500)
    h.onPointerup()
    const e1 = event()
    h.onClickCapture(e1)
    expect(e1.preventDefault).toHaveBeenCalled()
    expect(e1.stopImmediatePropagation).toHaveBeenCalled()
    const e2 = event()
    h.onClickCapture(e2)
    expect(e2.preventDefault).not.toHaveBeenCalled()
    expect(e2.stopImmediatePropagation).not.toHaveBeenCalled()

    // A short tap opens the row as usual.
    h.onPointerdown(touch(10, 10))
    vi.advanceTimersByTime(120)
    h.onPointerup()
    const tap = event()
    h.onClickCapture(tap)
    expect(tap.preventDefault).not.toHaveBeenCalled()
    expect(tap.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it('does not swallow the next tap when the browser sent no click after the press', () => {
    h.onPointerdown(touch(10, 10))
    vi.advanceTimersByTime(500)
    h.onPointerup()
    // No click arrived; the next tap is a new press.
    h.onPointerdown(touch(10, 10))
    h.onPointerup()
    const tap = event()
    h.onClickCapture(tap)
    expect(tap.preventDefault).not.toHaveBeenCalled()
  })

  it('blocks the context menu during a touch press', () => {
    h.onPointerdown(touch(10, 10))
    vi.advanceTimersByTime(200)
    const during = event()
    h.onContextmenu(during)
    expect(during.preventDefault).toHaveBeenCalled()

    // Right after it fired (Android sends contextmenu around the same time).
    vi.advanceTimersByTime(300)
    const after = event()
    h.onContextmenu(after)
    expect(after.preventDefault).toHaveBeenCalled()
  })

  it('leaves the context menu of a mouse alone', () => {
    h.onPointerdown({ pointerType: 'mouse', clientX: 0, clientY: 0 })
    const e = event()
    h.onContextmenu(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('stops the timer when the scope is disposed', () => {
    h.onPointerdown(touch(10, 10))
    scope.stop()
    vi.advanceTimersByTime(600)
    expect(fired).toBe(0)
  })

  it('takes a custom delay and tolerance', () => {
    const custom = effectScope()
    let n = 0
    const c = custom.run(() => useLongPress(() => n++, { delay: 300, tolerance: 4 }))!
    c.onPointerdown(touch(0, 0))
    c.onPointermove({ clientX: 3, clientY: 0 })
    vi.advanceTimersByTime(300)
    expect(n).toBe(1)
    c.onPointerdown(touch(0, 0))
    c.onPointermove({ clientX: 5, clientY: 0 })
    vi.advanceTimersByTime(300)
    expect(n).toBe(1)
    custom.stop()
  })
})

describe('long press on a tree folder (handler composition)', () => {
  function folderHandler(hasChildren: boolean, isOpen: boolean) {
    const calls: string[] = []
    const hh = scope.run(() =>
      useLongPress(() => {
        if (longPressExpands(hasChildren, isOpen)) calls.push('expand')
        calls.push('menu')
      }),
    )!
    return { hh, calls }
  }

  it('a closed folder with children expands and opens the menu', () => {
    const { hh, calls } = folderHandler(true, false)
    hh.onPointerdown(touch(0, 0))
    vi.advanceTimersByTime(500)
    expect(calls).toEqual(['expand', 'menu'])
  })

  it('a folder without children only opens the menu', () => {
    const { hh, calls } = folderHandler(false, false)
    hh.onPointerdown(touch(0, 0))
    vi.advanceTimersByTime(500)
    expect(calls).toEqual(['menu'])
  })

  it('a press shorter than the threshold expands nothing', () => {
    const { hh, calls } = folderHandler(true, false)
    hh.onPointerdown(touch(0, 0))
    vi.advanceTimersByTime(300)
    hh.onPointerup()
    vi.advanceTimersByTime(600)
    expect(calls).toEqual([])
  })
})

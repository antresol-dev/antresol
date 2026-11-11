import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKeyboardWatch, KEYBOARD_MIN_HEIGHT, opensKeyboard, revealDelta } from '../app/lib/keyboard'

/** Stands in for window.visualViewport: a size and resize events. */
class FakeViewport extends EventTarget {
  constructor(
    public width: number,
    public height: number,
  ) {
    super()
  }
  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.dispatchEvent(new Event('resize'))
  }
}

describe('opensKeyboard', () => {
  it('text fields bring up the on-screen keyboard', () => {
    expect(opensKeyboard({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(opensKeyboard({ tagName: 'INPUT', type: 'url' })).toBe(true)
    expect(opensKeyboard({ tagName: 'INPUT', type: 'number' })).toBe(true)
    expect(opensKeyboard({ tagName: 'TEXTAREA' })).toBe(true)
    expect(opensKeyboard({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })
  it('buttons, switches, checkboxes and read-only fields do not', () => {
    expect(opensKeyboard({ tagName: 'BUTTON' })).toBe(false)
    expect(opensKeyboard({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(opensKeyboard({ tagName: 'INPUT', type: 'file' })).toBe(false)
    expect(opensKeyboard({ tagName: 'INPUT', type: 'text', readOnly: true })).toBe(false)
    expect(opensKeyboard({ tagName: 'DIV' })).toBe(false)
    expect(opensKeyboard(null)).toBe(false)
  })
})

describe('createKeyboardWatch', () => {
  let viewport: FakeViewport
  beforeEach(() => {
    vi.useFakeTimers()
    viewport = new FakeViewport(360, 780)
  })
  afterEach(() => vi.useRealTimers())

  it('the keyboard is open while the viewport is shorter than the tallest it has been at this width', () => {
    const kb = createKeyboardWatch(viewport)
    expect(kb.isOpen()).toBe(false)
    viewport.resize(360, 480)
    expect(kb.isOpen()).toBe(true)
    viewport.resize(360, 780)
    expect(kb.isOpen()).toBe(false)
  })
  it('the address bar showing or hiding is not a keyboard', () => {
    const kb = createKeyboardWatch(viewport)
    viewport.resize(360, 780 - KEYBOARD_MIN_HEIGHT + 1)
    expect(kb.isOpen()).toBe(false)
  })
  it('turning the phone starts over from the new size', () => {
    const kb = createKeyboardWatch(viewport)
    viewport.resize(780, 360)
    expect(kb.isOpen()).toBe(false)
    viewport.resize(780, 160)
    expect(kb.isOpen()).toBe(true)
  })
  it('closed() resolves at once when there is no keyboard', async () => {
    const kb = createKeyboardWatch(viewport)
    let done = false
    void kb.closed(400).then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(true)
  })
  it('closed() resolves when the viewport grows back, not before', async () => {
    const kb = createKeyboardWatch(viewport)
    viewport.resize(360, 480)
    let done = false
    void kb.closed(400).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(100)
    expect(done).toBe(false)
    viewport.resize(360, 780)
    await Promise.resolve()
    expect(done).toBe(true)
  })
  it('closed() gives up after the timeout (the keyboard stayed: another field took focus)', async () => {
    const kb = createKeyboardWatch(viewport)
    viewport.resize(360, 480)
    let done = false
    void kb.closed(400).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(399)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })
  it('dispose() stops listening and lets a waiting close go on', async () => {
    const remove = vi.spyOn(viewport, 'removeEventListener')
    const kb = createKeyboardWatch(viewport)
    viewport.resize(360, 480)
    let done = false
    void kb.closed(400).then(() => (done = true))
    kb.dispose()
    await Promise.resolve()
    expect(done).toBe(true)
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})

describe('revealDelta', () => {
  const box = { top: 100, bottom: 500 }
  it('a field in sight needs no scrolling', () => {
    expect(revealDelta({ top: 200, bottom: 244 }, box, 16)).toBe(0)
  })
  it('a field under the visible bottom scrolls up into sight, with a margin', () => {
    expect(revealDelta({ top: 600, bottom: 644 }, box, 16)).toBe(160)
  })
  it('a field above the top scrolls down into sight', () => {
    expect(revealDelta({ top: 40, bottom: 84 }, box, 16)).toBe(-76)
  })
  it('a field taller than the box shows its top', () => {
    expect(revealDelta({ top: 300, bottom: 900 }, box, 16)).toBe(184)
  })
})

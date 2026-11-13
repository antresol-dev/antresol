import { describe, expect, it } from 'vitest'
import { SWIPE, SWIPE_DOWN, swipeAction, swipeDownCloses } from '../app/lib/swipe'

describe('swipeAction', () => {
  it('opens the menu with a rightward swipe', () => {
    expect(swipeAction({ x: 40, y: 300 }, { x: 120, y: 310 }, false)).toBe('open')
    // Exactly the minimum distance, exactly at the edge guard.
    expect(swipeAction({ x: SWIPE.edgeGuard, y: 300 }, { x: SWIPE.edgeGuard + SWIPE.minDistance, y: 300 }, false)).toBe('open')
  })

  it('leaves the edge zone to the system back gesture', () => {
    expect(swipeAction({ x: 10, y: 300 }, { x: 200, y: 300 }, false)).toBeNull()
    expect(swipeAction({ x: SWIPE.edgeGuard - 1, y: 300 }, { x: 200, y: 300 }, false)).toBeNull()
  })

  it('ignores short moves', () => {
    expect(swipeAction({ x: 40, y: 300 }, { x: 90, y: 300 }, false)).toBeNull()
    expect(swipeAction({ x: 300, y: 300 }, { x: 250, y: 300 }, true)).toBeNull()
  })

  it('ignores diagonal and vertical moves', () => {
    // 80 across against 60 down: not 1.5 times more.
    expect(swipeAction({ x: 40, y: 300 }, { x: 120, y: 360 }, false)).toBeNull()
    expect(swipeAction({ x: 100, y: 100 }, { x: 100, y: 400 }, false)).toBeNull()
    expect(swipeAction({ x: 300, y: 300 }, { x: 200, y: 380 }, true)).toBeNull()
    // 90 across against 60 down: exactly 1.5 times.
    expect(swipeAction({ x: 40, y: 300 }, { x: 130, y: 360 }, false)).toBe('open')
  })

  it('closes the open menu with a leftward swipe', () => {
    expect(swipeAction({ x: 300, y: 300 }, { x: 200, y: 305 }, true)).toBe('close')
    // From anywhere, the edge zone included.
    expect(swipeAction({ x: 90, y: 300 }, { x: 5, y: 300 }, true)).toBe('close')
  })

  it('does nothing against the menu state', () => {
    expect(swipeAction({ x: 300, y: 300 }, { x: 200, y: 300 }, false)).toBeNull()
    expect(swipeAction({ x: 40, y: 300 }, { x: 120, y: 300 }, true)).toBeNull()
  })
})

describe('swipeDownCloses', () => {
  it('closes on a long, mostly vertical swipe down when the list cannot scroll up', () => {
    expect(swipeDownCloses({ x: 100, y: 200 }, { x: 110, y: 200 + SWIPE_DOWN.minDistance }, false)).toBe(true)
  })
  it('lets the list scroll when it has content above', () => {
    expect(swipeDownCloses({ x: 100, y: 200 }, { x: 100, y: 400 }, true)).toBe(false)
  })
  it('ignores short, upward and diagonal moves', () => {
    expect(swipeDownCloses({ x: 100, y: 200 }, { x: 100, y: 250 }, false)).toBe(false)
    expect(swipeDownCloses({ x: 100, y: 400 }, { x: 100, y: 200 }, false)).toBe(false)
    expect(swipeDownCloses({ x: 100, y: 200 }, { x: 220, y: 300 }, false)).toBe(false)
  })
})

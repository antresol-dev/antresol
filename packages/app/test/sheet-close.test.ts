import { describe, expect, it } from 'vitest'
import { keepOpener, waitsForKeyboard } from '../app/lib/sheet-close'

describe('waitsForKeyboard', () => {
  const base = { coarse: true, typing: true, recentlyTyped: false, keyboardOpen: true }
  it('waits on a touch screen with the keyboard up after typing', () => {
    expect(waitsForKeyboard(base)).toBe(true)
    expect(waitsForKeyboard({ ...base, typing: false, recentlyTyped: true })).toBe(true)
  })
  it('never waits on a fine pointer, even when the viewport looks shortened', () => {
    expect(waitsForKeyboard({ ...base, coarse: false })).toBe(false)
  })
  it('does not wait without typing, or with the keyboard down', () => {
    expect(waitsForKeyboard({ ...base, typing: false })).toBe(false)
    expect(waitsForKeyboard({ ...base, keyboardOpen: false })).toBe(false)
  })
})

describe('keepOpener', () => {
  const a = { id: 'a' }
  const b = { id: 'b' }
  it('takes the current element on a fresh opening', () => {
    expect(keepOpener(false, a, b)).toBe(b)
  })
  it('keeps the earlier opener when reopened while still shown', () => {
    expect(keepOpener(true, a, b)).toBe(a)
  })
  it('falls back to the current one when there was none', () => {
    expect(keepOpener(true, null, b)).toBe(b)
  })
})

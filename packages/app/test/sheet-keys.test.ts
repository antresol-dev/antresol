import { describe, expect, it, vi } from 'vitest'
import { isSubmitChord, PRIMARY_SELECTOR, pressPrimary } from '../app/lib/sheet-keys'

const key = (init: Partial<Record<'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing', unknown>>) =>
  ({ key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }) as Parameters<typeof isSubmitChord>[0]

describe('isSubmitChord', () => {
  it('accepts Ctrl+Enter and ⌘+Enter', () => {
    expect(isSubmitChord(key({ ctrlKey: true }))).toBe(true)
    expect(isSubmitChord(key({ metaKey: true }))).toBe(true)
  })

  it('leaves plain Enter (a new line in a textarea), other keys and other chords alone', () => {
    expect(isSubmitChord(key({}))).toBe(false)
    expect(isSubmitChord(key({ key: 'k', ctrlKey: true }))).toBe(false)
    expect(isSubmitChord(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isSubmitChord(key({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(isSubmitChord(key({ ctrlKey: true, isComposing: true }))).toBe(false)
  })
})

describe('pressPrimary', () => {
  it('presses the available main button of the sheet', () => {
    const click = vi.fn()
    const querySelector = vi.fn(() => ({ click }))
    expect(pressPrimary({ querySelector } as never)).toBe(true)
    expect(querySelector).toHaveBeenCalledWith(PRIMARY_SELECTOR)
    expect(click).toHaveBeenCalledOnce()
  })

  it('does nothing when there is none (a disabled button is not matched)', () => {
    expect(pressPrimary({ querySelector: () => null } as never)).toBe(false)
    expect(PRIMARY_SELECTOR).toContain(':not(:disabled)')
  })
})

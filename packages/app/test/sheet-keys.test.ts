import { describe, expect, it, vi } from 'vitest'
import { isSubmitChord, nextFieldOnEnter, PRIMARY_SELECTOR, pressPrimary, stepOnEnter } from '../app/lib/sheet-keys'

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

describe('Enter steps through a form', () => {
  const field = (type = 'text', extra: Record<string, unknown> = {}) => {
    const f = {
      tagName: 'INPUT', type, disabled: false, readOnly: false,
      focus: vi.fn(), closest: () => null, getAttribute: () => null, hasAttribute: () => false, ...extra,
    }
    return f as typeof f & { disabled: boolean }
  }
  const enter = (target: unknown, init: Record<string, unknown> = {}) => {
    const preventDefault = vi.fn()
    return { e: { key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target, preventDefault, ...init } as never, preventDefault }
  }
  const formOf = (...fields: unknown[]) => ({ querySelectorAll: () => fields }) as never

  it('picks the next enabled field, none after the last', () => {
    const [a, b, c] = [field(), field(), field()]
    expect(nextFieldOnEnter([a, b, c], a)).toBe(b)
    b.disabled = true
    expect(nextFieldOnEnter([a, b, c], a)).toBe(c)
    expect(nextFieldOnEnter([a, b, c], c)).toBeNull()
    expect(nextFieldOnEnter([a, b], field())).toBeNull()
  })
  it('moves focus on Enter and keeps the form from submitting', () => {
    const [a, b] = [field(), field()]
    const { e, preventDefault } = enter(a)
    expect(stepOnEnter(e, formOf(a, b))).toBe(true)
    expect(b.focus).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
  })
  it('leaves Enter in the last field to the form (it submits)', () => {
    const [a, b] = [field(), field()]
    const { e, preventDefault } = enter(b)
    expect(stepOnEnter(e, formOf(a, b))).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
  })
  it('skips buttons and file inputs when stepping', () => {
    const [a, file, c] = [field(), field('file'), field()]
    expect(stepOnEnter(enter(a).e, formOf(a, file, c))).toBe(true)
    expect(c.focus).toHaveBeenCalledOnce()
    expect(file.focus).not.toHaveBeenCalled()
  })
  it('leaves chords, a listbox in use, a composition and non-text targets alone', () => {
    const [a, b] = [field(), field()]
    expect(stepOnEnter(enter(a, { ctrlKey: true }).e, formOf(a, b))).toBe(false)
    expect(stepOnEnter(enter(a, { isComposing: true }).e, formOf(a, b))).toBe(false)
    expect(stepOnEnter(enter(a, { key: 'a' }).e, formOf(a, b))).toBe(false)
    expect(stepOnEnter(enter(field('text', { getAttribute: () => 'true' })).e, formOf(a, b))).toBe(false)
    expect(stepOnEnter(enter(field('text', { hasAttribute: () => true })).e, formOf(a, b))).toBe(false)
    expect(stepOnEnter(enter({ tagName: 'BUTTON' }).e, formOf(a, b))).toBe(false)
    expect(b.focus).not.toHaveBeenCalled()
  })
})

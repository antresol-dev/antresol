import { opensKeyboard } from './keyboard'

/** Ctrl+Enter, or ⌘+Enter on a Mac, anywhere in a sheet. Plain Enter is left alone: in a multi-line field it is a new line. */
export function isSubmitChord(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> & { isComposing?: boolean }): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing
}

/** The sheet's main button: one marked `data-primary` (a footer action), else the submit button of its form. */
export const PRIMARY_SELECTOR = '[data-primary]:not(:disabled), form button[type="submit"]:not(:disabled)'

/** Presses the sheet's main button when it can be pressed; true when it did. */
export function pressPrimary(root: Pick<ParentNode, 'querySelector'>): boolean {
  const button = root.querySelector<HTMLElement>(PRIMARY_SELECTOR)
  if (!button) return false
  button.click()
  return true
}

/** What Enter does in a text field of a multi-field form: it steps to the next field in order (a disabled one is skipped);
 *  only the last field leaves Enter to the form, which submits. `fields` are the form's text fields in order. */
export function nextFieldOnEnter<T extends { disabled?: boolean }>(fields: readonly T[], current: T): T | null {
  const at = fields.indexOf(current)
  if (at < 0) return null
  return fields.slice(at + 1).find((f) => !f.disabled) ?? null
}

/** Enter in a form's text field steps to the next one (see nextFieldOnEnter). True when it did, so the caller stops the
 *  form's own submit; false leaves Enter alone: not a plain Enter, not a one-line text field, a list open under the field
 *  (a combobox's Enter picks from it), or the last field. */
export function stepOnEnter(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target' | 'preventDefault'> & { isComposing?: boolean },
  form: Pick<ParentNode, 'querySelectorAll'>,
): boolean {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return false
  const el = e.target as HTMLInputElement | null
  if (!el || el.tagName !== 'INPUT' || !opensKeyboard(el)) return false
  if (el.getAttribute('aria-expanded') === 'true' || el.hasAttribute('aria-activedescendant')) return false
  const fields = [...form.querySelectorAll<HTMLInputElement>('input')].filter((f) => opensKeyboard(f) && !f.closest('[hidden]'))
  const next = nextFieldOnEnter(fields, el)
  if (!next) return false
  e.preventDefault()
  next.focus()
  return true
}

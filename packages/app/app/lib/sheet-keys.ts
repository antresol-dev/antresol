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

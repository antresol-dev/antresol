/** Whether a closing sheet waits for the on-screen keyboard to go first: only on a touch screen (a short desktop window or
 *  split-screen also shrinks the viewport, and must not stall Esc), with a field just typed in and the keyboard up. */
export function waitsForKeyboard(s: { coarse: boolean; typing: boolean; recentlyTyped: boolean; keyboardOpen: boolean }): boolean {
  return s.coarse && (s.typing || s.recentlyTyped) && s.keyboardOpen
}

/** What a sheet returns focus to. Reopened while still shown (the field was blurred for the keyboard wait, so the
 *  current focus is <body>), it keeps the earlier opener. */
export function keepOpener<T>(stillShown: boolean, previous: T | null, current: T | null): T | null {
  return stillShown && previous ? previous : current
}

/**
 * A signal that aborts with a TimeoutError after `ms`. `AbortSignal.timeout` is missing in Safari < 16, so this is
 * AbortController + setTimeout; call `clear()` once the request is over so the timer does not outlive it.
 */
export function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('The operation timed out', 'TimeoutError')), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

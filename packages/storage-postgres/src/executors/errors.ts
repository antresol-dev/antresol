import { StorageError } from '@antresol/core'

export function unavailable(cause: unknown): StorageError {
  // Deliberately generic: driver messages can echo connection details.
  const error = new StorageError('unavailable', 'database unreachable')
  error.cause = cause
  return error
}

const isTimeout = (e: unknown): boolean =>
  e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')

/**
 * True when the Neon HTTP driver could not get an answer: fetch rejected (TypeError), the request timed
 * out or was aborted, or the server answered HTTP 5xx ("Server error (HTTP status N): ...", no sourceError).
 */
export function isFetchFailure(e: unknown): boolean {
  if (e instanceof TypeError || isTimeout(e)) return true
  if (!(e instanceof Error) || e.name !== 'NeonDbError') return false
  const source = (e as { sourceError?: unknown }).sourceError
  if (source instanceof TypeError || isTimeout(source)) return true
  const status = /^Server error \(HTTP status (\d{3})\)/.exec(e.message)
  return !!status && Number(status[1]) >= 500
}

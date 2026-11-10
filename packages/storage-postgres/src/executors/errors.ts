import { StorageError } from '@graymatter/core'

export function unavailable(cause: unknown): StorageError {
  // Deliberately generic: driver messages can echo connection details.
  const error = new StorageError('unavailable', 'database unreachable')
  error.cause = cause
  return error
}

/** True for a network failure of the Neon HTTP driver (fetch rejects with a TypeError). */
export function isFetchFailure(e: unknown): boolean {
  if (e instanceof TypeError) return true
  const source = (e as { sourceError?: unknown } | null)?.sourceError
  return e instanceof Error && e.name === 'NeonDbError' && source instanceof TypeError
}

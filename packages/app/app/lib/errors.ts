import { DOMAIN_ERROR_CODES, DomainError, STORAGE_ERROR_CODES, StorageError } from '@graymatter/core'
import { PROBE_FAILURES } from './sources'

const isProbeFailure = (e: unknown): e is { reason: (typeof PROBE_FAILURES)[number] } =>
  typeof e === 'object' &&
  e !== null &&
  (PROBE_FAILURES as readonly unknown[]).includes((e as { reason?: unknown }).reason)

/** i18n key for the user-facing text of an error or failed probe. Never includes the error's own text. */
export function errorMessageKey(e: unknown): string {
  if (e instanceof DomainError && DOMAIN_ERROR_CODES.includes(e.code)) return `errors.domain.${e.code}`
  if (e instanceof StorageError && STORAGE_ERROR_CODES.includes(e.code)) return `errors.storage.${e.code}`
  if (isProbeFailure(e)) return `errors.probe.${e.reason}`
  return 'errors.unknown'
}

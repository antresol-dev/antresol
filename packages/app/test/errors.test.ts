import { describe, expect, it } from 'vitest'
import { DOMAIN_ERROR_CODES, DomainError, STORAGE_ERROR_CODES, StorageError } from '@graymatter/core'
import en from '../i18n/locales/en.json'
import { errorMessageKey } from '../app/lib/errors'
import { PROBE_FAILURES } from '../app/lib/sources'

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)
}

describe('errorMessageKey', () => {
  it.each(DOMAIN_ERROR_CODES)('domain %s has a message', (code) => {
    const key = errorMessageKey(new DomainError(code))
    expect(key).toBe(`errors.domain.${code}`)
    expect(lookup(key)).toBeTypeOf('string')
    expect(lookup(key)).not.toBe('')
  })

  it.each(STORAGE_ERROR_CODES)('storage %s has a message', (code) => {
    const key = errorMessageKey(new StorageError(code))
    expect(key).toBe(`errors.storage.${code}`)
    expect(lookup(key)).toBeTypeOf('string')
    expect(lookup(key)).not.toBe('')
  })

  it.each(PROBE_FAILURES)('probe %s has a message', (reason) => {
    const key = errorMessageKey({ ok: false, reason, message: '' })
    expect(key).toBe(`errors.probe.${reason}`)
    expect(lookup(key)).toBeTypeOf('string')
    expect(lookup(key)).not.toBe('')
  })

  it('falls back to errors.unknown', () => {
    expect(errorMessageKey(new Error('x'))).toBe('errors.unknown')
    expect(errorMessageKey('x')).toBe('errors.unknown')
    expect(lookup('errors.unknown')).toBeTypeOf('string')
  })
})

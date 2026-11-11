import { describe, expect, it } from 'vitest'
import { DOMAIN_ERROR_CODES, STORAGE_ERROR_CODES } from '../src'

describe('error codes', () => {
  it('lists the 14 domain codes', () => {
    expect(DOMAIN_ERROR_CODES).toHaveLength(14)
    expect(DOMAIN_ERROR_CODES).toContain('folder_cycle')
    expect(DOMAIN_ERROR_CODES).toContain('unit_in_use')
  })
  it('lists the storage codes', () => {
    expect([...STORAGE_ERROR_CODES]).toEqual(['read_only', 'unavailable', 'not_found', 'incompatible', 'outdated', 'failed'])
  })
})

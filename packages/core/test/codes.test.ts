import { describe, expect, it } from 'vitest'
import { DOMAIN_ERROR_CODES, STORAGE_ERROR_CODES } from '../src'

describe('error codes', () => {
  it('lists the 23 domain codes', () => {
    expect(DOMAIN_ERROR_CODES).toHaveLength(23)
    expect(DOMAIN_ERROR_CODES).toContain('folder_cycle')
    expect(DOMAIN_ERROR_CODES).toContain('unit_in_use')
    for (const c of ['duplicate_variant', 'axis_required', 'axis_value_required', 'attribute_is_axis', 'not_an_axis', 'option_in_use', 'invalid_number', 'too_many_pinned', 'duplicate_archived']) {
      expect(DOMAIN_ERROR_CODES).toContain(c)
    }
  })
  it('lists the storage codes', () => {
    expect([...STORAGE_ERROR_CODES]).toEqual(['read_only', 'unavailable', 'not_found', 'incompatible', 'outdated', 'failed', 'not_empty', 'conflict'])
  })
})

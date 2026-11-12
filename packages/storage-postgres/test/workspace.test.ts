import { describe, expect, it } from 'vitest'
import { CORE_VERSION } from '@antresol/core'

describe('workspace', () => {
  it('resolves @antresol/core from storage-postgres', () => {
    expect(CORE_VERSION).toBe('0.1.0')
  })
})

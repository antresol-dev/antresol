import { describe, expect, it } from 'vitest'
import { CORE_VERSION } from '@graymatter/core'

describe('workspace', () => {
  it('resolves @graymatter/core from storage-postgres', () => {
    expect(CORE_VERSION).toBe('0.1.0')
  })
})

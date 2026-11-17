import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'

describe('name-taken texts', () => {
  it('has every text the live notes and the restore refusal use', () => {
    for (const k of ['active', 'archived', 'unitName', 'unitSymbol', 'inList', 'inListArchived', 'restoreClash'] as const) {
      expect(en.nameTaken[k]).toBeTypeOf('string')
    }
    expect(en.nameTaken.active).toContain('{name}')
    expect(en.nameTaken.restoreClash).toContain('{name}')
  })
})

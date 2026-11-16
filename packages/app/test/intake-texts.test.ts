import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'

describe('intake texts', () => {
  it('every line problem the core can name has a text', () => {
    for (const code of ['item_archived', 'missing_axis_value', 'invalid_value', 'unknown_item', 'invalid_link', 'duplicate_line']) {
      expect((en.intakes.problem as Record<string, string>)[code], code).toBeTruthy()
    }
  })

  it('has the neutral commit-blocked text and the "using existing" toast', () => {
    expect(en.intakes.screen.fixProblems).toBeTruthy()
    expect(en.intakes.usingExisting).toContain('{name}')
  })
})

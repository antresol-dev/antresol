import { describe, expect, it } from 'vitest'
import en from '../../app/i18n/locales/en.json'
import { messageFor } from '../src/messages'

describe('messageFor', () => {
  it('fills placeholders from en.json', () => {
    expect(messageFor('intakes.line.needsValue', { name: 'Resistance' })).toBe(en.intakes.line.needsValue.replace('{name}', 'Resistance'))
    expect(messageFor('intakes.line.needsValue', { name: 'Resistance' })).toBe('Enter Resistance.')
  })
  it('keeps unfilled placeholders, gives an unknown key back, takes the first plural form', () => {
    expect(messageFor('intakes.line.needsValue')).toBe('Enter {name}.')
    expect(messageFor('no.such.key')).toBe('no.such.key')
    expect(messageFor('intakes.line')).toBe('intakes.line')
  })
})

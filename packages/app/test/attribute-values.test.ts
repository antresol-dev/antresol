import { describe, expect, it } from 'vitest'
import { parseAttributeInput } from '../app/lib/attribute-values'

const ohm = { kind: 'number', options: [], unit: 'Ω', siPrefixes: true } as const
const list = { kind: 'enum', options: ['DIP-8', 'SOIC-8'], unit: '', siPrefixes: false } as const
const text = { kind: 'text', options: [], unit: '', siPrefixes: false } as const

describe('parseAttributeInput', () => {
  it('turns a number into its canonical value by the attribute rules', () => {
    expect(parseAttributeInput(ohm, '4.7k')).toEqual({ value: '4700' })
    expect(parseAttributeInput(ohm, ' 4,7 kΩ ')).toEqual({ value: '4700' })
    expect(parseAttributeInput(ohm, 'abc')).toEqual({ error: 'invalid_number' })
  })
  it('matches a list option without regard to case and returns the option as listed', () => {
    expect(parseAttributeInput(list, 'soic-8')).toEqual({ value: 'SOIC-8' })
    expect(parseAttributeInput(list, 'QFN')).toEqual({ error: 'invalid_option' })
  })
  it('trims text', () => {
    expect(parseAttributeInput(text, '  red wire ')).toEqual({ value: 'red wire' })
  })
  it('refuses empty input of any kind', () => {
    for (const a of [ohm, list, text]) expect(parseAttributeInput(a, '   ')).toEqual({ error: 'name_required' })
  })
})

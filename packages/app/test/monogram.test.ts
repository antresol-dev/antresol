import { describe, expect, it } from 'vitest'
import { monogram } from '../app/lib/monogram'

describe('monogram', () => {
  it('takes the first two characters of a part number', () => {
    expect(monogram('TL072 op-amp')).toBe('TL')
    expect(monogram('NE5532P')).toBe('NE')
    expect(monogram('1N4148')).toBe('1N')
  })

  it('gives the folder names of a list their letters', () => {
    expect(monogram('ICs')).toBe('IC')
    expect(monogram('Op-amps')).toBe('Op')
    expect(monogram('🔧')).toBe('')
  })

  it('takes the first two letters of a single word', () => {
    expect(monogram('Резистор')).toBe('Ре')
    expect(monogram('resistor')).toBe('Re')
  })

  it('takes the first letters of the first two words', () => {
    expect(monogram('Heat shrink tubing')).toBe('HS')
    expect(monogram('jumper wires')).toBe('JW')
    expect(monogram('Конденсатор керамический')).toBe('КК')
  })

  it('keeps to the first word when the second starts with a digit', () => {
    expect(monogram('Резистор 0,25 Вт')).toBe('Ре')
  })

  it('skips punctuation and symbols', () => {
    expect(monogram('  (spare) fuses ')).toBe('SF')
    expect(monogram('🧪 kit')).toBe('Ki')
  })

  it('works with one letter and with nothing to take', () => {
    expect(monogram('x')).toBe('X')
    expect(monogram('A box')).toBe('AB')
    expect(monogram('  ')).toBe('')
    expect(monogram('—')).toBe('')
  })
})

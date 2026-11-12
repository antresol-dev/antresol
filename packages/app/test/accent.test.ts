import { describe, expect, it } from 'vitest'
import { ACCENT_NAMES, ACCENTS, isAccentName } from '../app/lib/accent'
import { contrast, mixHex } from './fixtures/color'

const LIGHT_BG = '#EDEFF3'
const DARK_BG = '#2A2E37'

describe('accent palette (spec 2026-11-12 styles §4: the mock-up\'s ACC)', () => {
  it('the eleven colours, the ten of before and copper', () => {
    expect(ACCENT_NAMES).toEqual(['indigo', 'violet', 'blue', 'sky', 'teal', 'green', 'orange', 'rose', 'pink', 'slate', 'copper'])
  })

  it('light and dark values are the mock-up\'s, verbatim', () => {
    expect(ACCENTS).toEqual({
      indigo: { light: '#4F46E5', dark: '#B0ACF3' },
      violet: { light: '#7C3AED', dark: '#C4A6F7' },
      blue: { light: '#2563EB', dark: '#9DB9F6' },
      sky: { light: '#0369A1', dark: '#8EBCD5' },
      teal: { light: '#0F766E', dark: '#93C1BE' },
      green: { light: '#15803D', dark: '#96C6A8' },
      orange: { light: '#C2410C', dark: '#E4AA92' },
      rose: { light: '#BE123C', dark: '#E294A7' },
      pink: { light: '#BE185D', dark: '#E297B6' },
      slate: { light: '#475569', dark: '#ACB3BC' },
      copper: { light: '#9A4F1E', dark: '#E0A273' },
    })
  })

  it.each(ACCENT_NAMES)('%s: white text on the painted accent is at least 4.5:1', (name) => {
    expect(contrast('#FFFFFF', ACCENTS[name].light)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(ACCENT_NAMES)('%s: dark text #16181D on the dark (pastel) accent is at least 4.5:1', (name) => {
    expect(contrast('#16181D', ACCENTS[name].dark)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(ACCENT_NAMES)('%s: Neumorphism\'s selected-row text mix(accent, black, 0.18) on its gradient over #EDEFF3 is at least 4.5:1', (name) => {
    const A = ACCENTS[name].light
    const ink = mixHex(A, '#000000', 0.18)
    // The gradient's strongest end (accent at 17 %) is the darkest backdrop.
    expect(contrast(ink, mixHex(LIGHT_BG, A, 0.17))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(ACCENT_NAMES)('%s: Neumorphism\'s dark accent text mix(accent, white, 0.5) on #2A2E37 is at least 4.5:1', (name) => {
    expect(contrast(mixHex(ACCENTS[name].light, '#FFFFFF', 0.5), DARK_BG)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('isAccentName', () => {
  it('accepts the palette names only', () => {
    expect(isAccentName('teal')).toBe(true)
    expect(isAccentName('copper')).toBe(true)
    expect(isAccentName('neon')).toBe(false)
    expect(isAccentName('toString')).toBe(false)
    expect(isAccentName(undefined)).toBe(false)
    expect(isAccentName(3)).toBe(false)
  })
})

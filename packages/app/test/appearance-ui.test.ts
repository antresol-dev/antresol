import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import { ACCENT_NAMES } from '../app/lib/accent'
import { accentChoices, previewVars, styleCards } from '../app/lib/appearance-ui'
import { themeColorMeta } from '../app/lib/shell'
import { solidOf } from '../app/lib/styles/color'
import { STYLE_NAMES, STYLES } from '../app/lib/styles/registry'

describe('style cards', () => {
  it('come in the order of STYLE_NAMES, labelled by the registry', () => {
    expect(styleCards().map((c) => c.name)).toEqual(STYLE_NAMES)
    expect(styleCards().map((c) => c.label)).toEqual(STYLE_NAMES.map((n) => STYLES[n].label))
  })
  it('previews carry the style tokens of the mode, for the card element alone', () => {
    for (const mode of ['light', 'dark'] as const) {
      const vars = Object.fromEntries(previewVars('neumorphism', mode, 'indigo'))
      expect(vars['--st-page']).toBe(STYLES.neumorphism.build(mode, 'indigo').page)
      expect(vars['--st-card']).toBeDefined()
      expect(vars['--st-primary-n-bg']).toBeDefined()
    }
  })
})

describe('accent choices', () => {
  it('start with "Style default" (null), then every accent, copper included', () => {
    const choices = accentChoices('base')!
    expect(choices[0]).toBeNull()
    expect(choices.slice(1)).toEqual(ACCENT_NAMES)
    expect(choices).toContain('copper')
  })
  it('are hidden, not merely disabled, for a fixed palette', () => {
    for (const name of STYLE_NAMES) {
      if (STYLES[name].fixedPalette) expect(accentChoices(name)).toBeNull()
      else expect(accentChoices(name)).not.toBeNull()
    }
    expect(STYLE_NAMES.filter((n) => STYLES[n].fixedPalette)).toEqual(['brutal', 'retro'])
  })
  it('have their labels', () => {
    for (const name of ACCENT_NAMES) expect(en.settings.appearance.accents).toHaveProperty(name)
    expect(en.settings.appearance.styleDefault).toBe('Style default')
    expect(en.settings.appearance.fixedPalette).toBe('This style has its own colours')
  })
})

describe('theme-color from the style header', () => {
  it('is the solid header of the current style and theme', () => {
    for (const name of STYLE_NAMES) {
      for (const mode of ['light', 'dark'] as const) {
        const t = STYLES[name].build(mode, 'indigo')
        expect(themeColorMeta(mode, mode, name, 'indigo')).toEqual([
          { key: 'theme-color', name: 'theme-color', content: solidOf(t.hdr, t.pageColor) },
        ])
      }
    }
  })
  // Literals, so the expectation is not the implementation's own formula (solidOf of the header over the page).
  it.each([
    ['base', 'light', '#FFFFFF'],
    ['base', 'dark', '#1E2026'],
    // A translucent header (Liquid's: 35 % white in light, 35 % of #14161E in dark) is flattened over the page colour; by
    // hand, 0.35 × header + 0.65 × the wallpaper's base (#DDE2EE light, #171D2B dark).
    ['liquid', 'light', '#E9ECF4'],
    ['liquid', 'dark', '#161B26'],
  ] as const)('%s, %s: %s', (name, mode, expected) => {
    expect(themeColorMeta(mode, mode, name, 'blue')[0]!.content).toBe(expected)
  })
  it('system: one tag per colour scheme', () => {
    const light = STYLES.neumorphism.build('light', 'indigo')
    const dark = STYLES.neumorphism.build('dark', 'indigo')
    expect(themeColorMeta('system', 'dark', 'neumorphism', 'indigo')).toEqual([
      { key: 'theme-color-light', name: 'theme-color', content: solidOf(light.hdr, light.pageColor), media: '(prefers-color-scheme: light)' },
      { key: 'theme-color-dark', name: 'theme-color', content: solidOf(dark.hdr, dark.pageColor), media: '(prefers-color-scheme: dark)' },
    ])
  })
})

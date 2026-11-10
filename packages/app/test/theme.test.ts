import { describe, expect, it } from 'vitest'
import css from '../app/assets/css/main.css?raw'

type Tokens = Record<string, string>

function parseBlock(selector: RegExp): Tokens {
  const block = css.match(selector)?.[1] ?? ''
  const tokens: Tokens = {}
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[m[1]!] = m[2]!.toUpperCase()
  }
  return tokens
}

const themes: Record<string, Tokens> = {
  light: parseBlock(/:root\s*\{([^}]*)\}/),
  dark: parseBlock(/\.dark\s*\{([^}]*)\}/),
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const pairs: [string, string][] = [
  ['foreground', 'background'],
  ['foreground', 'surface'],
  ['muted-foreground', 'surface'],
  ['subtle-foreground', 'background'],
  ['subtle-foreground', 'chip'],
  ['primary-foreground', 'primary'],
  ['accent-soft-foreground', 'accent-soft'],
  ['dimmed-foreground', 'surface'],
  ['destructive', 'surface'],
  // status badges (text on surface with a border, ready on accent-soft)
  ['subtle-foreground', 'surface'],
  ['accent-soft-foreground', 'accent-soft'],
  // destructive menu item: text on its focused background
  ['destructive', 'background'],
  // app shell: panel sections on the rail, the active one on surface; tree rows and their counts under the pointer
  ['icon', 'rail'],
  ['primary', 'surface'],
  ['foreground', 'hover'],
  ['icon', 'hover'],
  ['subtle-foreground', 'hover'],
  // screen header path on the page background
  ['muted-foreground', 'background'],
]

describe.each(Object.keys(themes))('%s theme contrast', (name) => {
  const tokens = themes[name]!
  it.each(pairs)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(tokens[fg], `--${fg}`).toBeDefined()
    expect(tokens[bg], `--${bg}`).toBeDefined()
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('light theme exact values', () => {
  it('matches the spec', () => {
    expect(themes.light!.background).toBe('#F7F7F8')
    expect(themes.light!.border).toBe('#EDEDF0')
    expect(themes.light!.primary).toBe('#4F46E5')
  })
})

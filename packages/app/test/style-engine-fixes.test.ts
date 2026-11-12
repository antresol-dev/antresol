import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STYLES, STYLE_NAMES } from '../app/lib/styles/registry'
import type { Mode } from '../app/lib/styles/types'

/*
 * Plan 10, Fix A: the engine's known gaps. (Fallback faces: test/fonts.test.ts; sheets over the scrim: the contrast
 * matrix in test/styles.test.ts.) Here: decorative marks, bounded radii for tall boxes, the stock card's state hook.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
/** A style's own CSS, or '' (Neumorphism has none). */
const styleCss = (name: string) => {
  const path = fileURLToPath(new URL(`../app/assets/css/styles/${name}.css`, import.meta.url))
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}
const mainCss = read('../app/assets/css/main.css')
const MODES: Mode[] = ['light', 'dark']
const BOUND = 26

describe('section marks are decorative', () => {
  it('the mark has empty alt text, so a screen reader does not read it before every heading', () => {
    // Inside @supports (alt text in content): an engine without it keeps the plain declaration before it (the mark, read aloud).
    const rule = /@supports \(content: 'a' \/ 'b'\) \{\s*\.section-label::before \{([^}]*)\}/.exec(mainCss)?.[1] ?? ''
    expect(rule).toMatch(/content:\s*var\(--st-mark\)\s*\/\s*''\s*;/)
    expect(/\.section-label::before \{([^}]*)\}/.exec(mainCss)?.[1]).toMatch(/content:\s*var\(--st-mark\)\s*;/)
  })

  it('no style draws a mark in its own CSS, where the alt text would be missing', () => {
    for (const name of STYLE_NAMES) {
      const code = styleCss(name)
      for (const m of code.matchAll(/content:\s*([^;]+);/g)) {
        const value = m[1]!.trim()
        // Non-empty generated text needs an alt text after a slash (or it is a drawing: '' and none).
        if (value === "''" || value === 'none') continue
        expect(value, `${name}.css content: ${value}`).toMatch(/\/\s*''$/)
      }
    }
  })
})

describe('tall boxes are not capsules', () => {
  it('--radius-field (text areas, picker lists, notices) is the button radius bounded at 26px', () => {
    expect(mainCss).toMatch(/--radius-field: min\(var\(--st-btn-r\), 26px\);/)
  })

  it('so btnR is a single length in every style (min() takes no corner lists)', () => {
    for (const name of STYLE_NAMES) for (const mode of MODES) {
      const t = STYLES[name].build(mode, STYLES[name].defaultAccent)
      expect(t.btnR, `${name} ${mode}`).toMatch(/^\d+(\.\d+)?(px)?$/)
    }
  })

  it('the pill ends stay pills for single-line controls: the bound is at least half the tallest field-sized control (52px)', () => {
    expect(BOUND * 2).toBeGreaterThanOrEqual(52)
  })

  it('the other boxes (cards, sheets, lists, menus, the photo, the selected row) never ask for more than the bound', () => {
    for (const name of STYLE_NAMES) for (const mode of MODES) {
      const t = STYLES[name].build(mode, STYLES[name].defaultAccent)
      for (const key of ['cardR', 'listR', 'popR', 'photoR', 'curR'] as const) {
        for (const n of t[key].match(/[\d.]+/g) ?? []) expect(Number(n), `${name} ${mode} ${key}: ${t[key]}`).toBeLessThanOrEqual(BOUND)
      }
    }
  })

  it('no style keeps its own cap of --radius-field apart from Retro\'s boomerang (the shape of its fields)', () => {
    for (const name of STYLE_NAMES) {
      const code = styleCss(name)
      if (name === 'retro') expect(code).toMatch(/--radius-field:\s*var\(--st-cur-r\)/)
      else expect(code, name).not.toMatch(/--radius-field/)
    }
  })
})

describe('the stock card\'s state is a data attribute', () => {
  const card = read('../app/components/StockCard.vue')
  const tinkerer = read('../app/assets/css/styles/tinkerer.css')

  it('StockCard sets data-stock to out or ok from the total', () => {
    expect(card).toMatch(/:data-stock="total\.outOfStock \? 'out' : 'ok'"/)
  })

  it('Tinkerer\'s LED keys on it, not on the card\'s utility classes', () => {
    expect(tinkerer).toContain(".stock-card[data-stock='out']::after")
    expect(tinkerer).not.toMatch(/leading-none|tabular-nums|text-muted-foreground/)
  })
})

import { describe, expect, it } from 'vitest'
import { ACCENT_NAMES } from '../app/lib/accent'
import { PALETTE, colorVars, darkShade, defaultItemColor, itemColor, paletteName } from '../app/lib/item-colors'

describe('item colours', () => {
  it('the palette is the accents, light shades, in order', () => {
    expect(PALETTE).toHaveLength(ACCENT_NAMES.length)
    expect(PALETTE[0]).toBe('#4F46E5')
  })

  it('palette colours keep their own dark shade, others are mixed 55 % toward white, upper-case', () => {
    expect(darkShade('#4F46E5')).toBe('#B0ACF3')
    expect(darkShade('#9A4F1E')).toBe('#E0A273')
    expect(darkShade('#000000')).toBe('#8C8C8C')
    expect(darkShade('#123456')).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('names palette colours and only them', () => {
    expect(paletteName('#4F46E5')).toBe('indigo')
    expect(paletteName('#9A4F1E')).toBe('copper')
    expect(paletteName('#123456')).toBeNull()
  })

  it('the default colour comes from the id, inside the palette, stable', () => {
    const id = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b'
    expect(PALETTE).toContain(defaultItemColor(id))
    expect(defaultItemColor(id)).toBe(defaultItemColor(id))
  })

  it('itemColor takes the item colour, else the default', () => {
    const id = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b'
    expect(itemColor({ id, color: '#123456' })).toBe('#123456')
    expect(itemColor({ id, color: null })).toBe(defaultItemColor(id))
  })

  it('colorVars gives both shades', () => {
    expect(colorVars('#4F46E5')).toEqual({ '--c-light': '#4F46E5', '--c-dark': '#B0ACF3' })
  })
})

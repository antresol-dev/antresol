/*
 * Colour helpers for the style builders. `hex`, `mix`, `rgba` and `rot` are the owner's mock-up's, verbatim
 * (styles-mockup.dc.html, build()): a style module ports its branch of build() with them, so its numbers come out the
 * same. The rest is what the derived surfaces need (types.ts, deriveSurfaces): reading the colours a CSS background
 * value is made of, and flattening a translucent colour onto what is under it.
 */

/** '#RRGGBB' → [r, g, b] (0–255). */
export function hex(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** The mock-up's mix(a, b, k): a + (b − a)·k per channel, rounded; lower-case '#rrggbb'. */
export function mix(a: string, b: string, k: number): string {
  const A = hex(a)
  const B = hex(b)
  return '#' + A.map((v, i) => Math.round(v + (B[i]! - v) * k).toString(16).padStart(2, '0')).join('')
}

/** The mock-up's rgba(h, a): 'rgba(r,g,b,a)' with the alpha rounded to three places. */
export function rgba(h: string, a: number): string {
  return 'rgba(' + hex(h).join(',') + ',' + Math.round(a * 1000) / 1000 + ')'
}

/** The mock-up's rot(h, deg, s, l): the hue of `h` turned by `deg`, at saturation `s` and lightness `l` (0–1). */
export function rot(h: string, deg: number, s: number, l: number): string {
  const [r, g, b] = hex(h).map((v) => v / 255) as [number, number, number]
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  let hh = 0
  const d = mx - mn
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6
    else if (mx === g) hh = (b - r) / d + 2
    else hh = (r - g) / d + 4
  }
  hh = (hh * 60 + deg + 720) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = l - c / 2
  const seg = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(hh / 60) % 6]!
  return '#' + seg.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------------------------------------------------

/** sRGB 0–255, alpha 0–1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|\btransparent\b/g

/** A plain colour (#rgb, #rrggbb, rgb(), rgba(), transparent); null for anything else (a gradient, `inherit`). */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
  if (short) return { r: parseInt(short[1]! + short[1]!, 16), g: parseInt(short[2]! + short[2]!, 16), b: parseInt(short[3]! + short[3]!, 16), a: 1 }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(s)
  if (long) return { r: parseInt(long[1]!, 16), g: parseInt(long[2]!, 16), b: parseInt(long[3]!, 16), a: 1 }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s)
  if (fn) return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) }
  return null
}

/** '#RRGGBB' of the colour's channels (its alpha dropped). */
export function toHex(c: Rgba): string {
  return '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** `top` drawn over `bottom` (source-over). */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const ch = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a }
}

/** Splits a comma-separated CSS list (background layers, shadows) at its top level: commas inside () stay. */
export function topLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++
    else if (list[i] === ')') depth--
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(list.slice(start).trim())
  return parts.filter((p) => p !== '')
}

/** Every plain colour written in a CSS value (a gradient's stops, a shorthand's colour), in order. */
export function colorsIn(value: string): Rgba[] {
  return [...value.matchAll(COLOR)].map((m) => parseColor(m[0])).filter((c): c is Rgba => c !== null)
}

/**
 * The one opaque colour that stands for a CSS background value: where something must be solid (a sticky bar, a
 * fade, text drawn in the page's colour, a pane without blur). The bottom layer's colour, or the mean of its stops
 * when it is a gradient; the layers above it that are plain colours are drawn over it; the result is drawn over
 * `under` (default white) when it is still translucent.
 */
export function solidOf(background: string, under = '#FFFFFF'): string {
  const layers = topLevel(background)
  const bottom = layers.at(-1) ?? 'transparent'
  let c = parseColor(bottom)
  if (!c) {
    const stops = colorsIn(bottom)
    c = stops.length
      ? { r: avg(stops.map((s) => s.r)), g: avg(stops.map((s) => s.g)), b: avg(stops.map((s) => s.b)), a: avg(stops.map((s) => s.a)) }
      : { r: 0, g: 0, b: 0, a: 0 }
  }
  for (const layer of layers.slice(0, -1).reverse()) {
    const plain = parseColor(layer)
    if (plain) c = over(plain, c)
  }
  return toHex(over(c, parseColor(under) ?? { r: 255, g: 255, b: 255, a: 1 }))
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** The colour of a border shorthand such as '1px solid #D9DDE5' (the mock-up's `divider` and `seam`). */
export function borderColor(border: string): string {
  const m = /^\s*[\d.]+px\s+(?:solid|dashed|dotted|double)\s+(.+?)\s*$/.exec(border)
  return m ? m[1]! : 'transparent'
}

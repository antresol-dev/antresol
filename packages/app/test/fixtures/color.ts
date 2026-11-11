/*
 * Colour maths for the contrast tests: parsing the colours main.css writes (hex, rgba(), transparent), the mock-up's
 * mix(), CSS color-mix(in srgb, …) with var() substitution, alpha compositing and WCAG contrast.
 */

/** sRGB channels 0–255 (unrounded), alpha 0–1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export function parseColor(input: string): Rgba {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const short = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/)
  if (short) return { r: parseInt(short[1]! + short[1]!, 16), g: parseInt(short[2]! + short[2]!, 16), b: parseInt(short[3]! + short[3]!, 16), a: 1 }
  const long = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/)
  if (long) return { r: parseInt(long[1]!, 16), g: parseInt(long[2]!, 16), b: parseInt(long[3]!, 16), a: 1 }
  const fn = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (fn) return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) }
  throw new Error(`Unsupported colour: ${input}`)
}

export function toHex(c: Rgba): string {
  return '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** The mock-up's mix(a, b, k): a + (b − a)·k per channel, rounded to whole channels. */
export function mixHex(a: string, b: string, k: number): string {
  const A = parseColor(a)
  const B = parseColor(b)
  return toHex({ r: Math.round(A.r + (B.r - A.r) * k), g: Math.round(A.g + (B.g - A.g) * k), b: Math.round(A.b + (B.b - A.b) * k), a: 1 })
}

/** `top` drawn over `bottom` (source-over). */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const ch = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a }
}

export function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** WCAG contrast of two colours; a translucent one is first composited over `base`. */
export function contrast(fg: Rgba | string, bg: Rgba | string, base: Rgba | string = '#FFFFFF'): number {
  const toRgba = (c: Rgba | string) => (typeof c === 'string' ? parseColor(c) : c)
  const backdrop = over(toRgba(bg), toRgba(base))
  const front = over(toRgba(fg), backdrop)
  const [hi, lo] = [luminance(front), luminance(backdrop)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

// ---------------------------------------------------------------------------------------------------------------
// CSS

export type Vars = Record<string, string>

/** Declarations of every rule in `css` whose selector is exactly `selector` and whose body has no nested braces
 *  (custom properties only, later blocks win). */
export function cssVars(css: string, selector: string): Vars {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const vars: Vars = {}
  for (const block of css.matchAll(new RegExp(`(?:^|[\\s};])${escaped}\\s*\\{([^{}]*)\\}`, 'g'))) {
    const body = block[1]!.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim()
  }
  return vars
}

/** Index of the parenthesis closing the one at `open`. */
function closing(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth === 0) return i
  }
  throw new Error(`Unbalanced parentheses: ${s}`)
}

/** Splits on commas outside parentheses. */
function topLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(s.slice(start).trim())
  return parts
}

/** Replaces every var(--name, fallback) with the variable's value (or its fallback), recursively. */
export function substitute(expr: string, vars: Vars, depth = 0): string {
  if (depth > 20) throw new Error(`var() cycle in ${expr}`)
  const at = expr.indexOf('var(')
  if (at < 0) return expr
  const end = closing(expr, at + 3)
  const [name, ...fallback] = topLevel(expr.slice(at + 4, end))
  const key = name!.replace(/^--/, '')
  const value = vars[key] ?? (fallback.length ? fallback.join(', ') : undefined)
  if (value === undefined) throw new Error(`Undefined --${key}`)
  return substitute(expr.slice(0, at) + substitute(value, vars, depth + 1) + expr.slice(end + 1), vars, depth + 1)
}

/** A colour expression without var(): a colour or color-mix(in srgb, A [p%], B [q%]) (premultiplied, per CSS). */
export function evaluate(expr: string): Rgba {
  const s = expr.trim()
  if (!s.startsWith('color-mix(')) return parseColor(s)
  const [space, first, second] = topLevel(s.slice(s.indexOf('(') + 1, closing(s, s.indexOf('('))))
  if (space !== 'in srgb') throw new Error(`Unsupported colour space: ${space}`)
  const part = (p: string) => {
    const m = p.match(/^(.*?)\s+([\d.]+)%$/)
    return m ? { color: evaluate(m[1]!), pct: Number(m[2]) / 100 } : { color: evaluate(p), pct: undefined }
  }
  const A = part(first!)
  const B = part(second!)
  let p1 = A.pct
  let p2 = B.pct
  if (p1 === undefined && p2 === undefined) p1 = p2 = 0.5
  else if (p1 === undefined) p1 = 1 - p2!
  else if (p2 === undefined) p2 = 1 - p1
  const sum = p1 + p2!
  const w1 = p1 / sum
  const w2 = p2! / sum
  const a = A.color.a * w1 + B.color.a * w2
  const ch = (x: number, y: number) => (a === 0 ? 0 : (x * A.color.a * w1 + y * B.color.a * w2) / a)
  return { r: ch(A.color.r, B.color.r), g: ch(A.color.g, B.color.g), b: ch(A.color.b, B.color.b), a: a * Math.min(1, sum) }
}

export function resolveColor(name: string, vars: Vars): Rgba {
  const value = vars[name]
  if (value === undefined) throw new Error(`Undefined --${name}`)
  return evaluate(substitute(value, vars))
}

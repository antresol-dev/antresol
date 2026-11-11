import { SI_PREFIXES } from './units'

/** Canonical decimal string (spec 4.1): no exponent, no leading/trailing zeros, no "-0". */
export type NumberValue = string

export interface NumberRules {
  unit: string
  siPrefixes: boolean
}

const MAX_SIGNIFICANT = 15
const MAX_ORDER = 29 // |v| < 10^30
const MIN_ORDER = -30 // |v| >= 10^-30
const MAX_INPUT_EXPONENT = 1000

// Input prefix symbol -> power of ten. Case matters.
const PREFIX_POWERS: Map<string, number> = (() => {
  const m = new Map<string, number>()
  for (const [p, { symbol }] of Object.entries(SI_PREFIXES)) m.set(symbol, Number(p))
  m.set('u', -6)
  m.set('μ', -6) // U+03BC
  for (const [s, p] of [['п', -12], ['н', -9], ['мк', -6], ['м', -3], ['с', -2], ['к', 3], ['М', 6], ['Г', 9], ['Т', 12]] as const) {
    m.set(s, p)
  }
  return m
})()
const PREFIX_SYMBOLS = [...PREFIX_POWERS.keys()]

interface Decimal {
  neg: boolean
  digits: string // no leading zeros, no trailing zeros; '' for zero
  exp: number // value = digits * 10^exp
}

function normalize(neg: boolean, digitsRaw: string, exp: number): Decimal {
  const lead = digitsRaw.replace(/^0+/, '')
  const digits = lead.replace(/0+$/, '')
  if (digits === '') return { neg: false, digits: '', exp: 0 }
  return { neg, digits, exp: exp + (lead.length - digits.length) }
}

function build(d: Decimal): string {
  if (d.digits === '') return '0'
  const { digits, exp } = d
  const L = digits.length
  let body: string
  if (exp >= 0) body = digits + '0'.repeat(exp)
  else if (L + exp > 0) body = `${digits.slice(0, L + exp)}.${digits.slice(L + exp)}`
  else body = `0.${'0'.repeat(-(L + exp))}${digits}`
  return d.neg ? `-${body}` : body
}

function inRange(d: Decimal): boolean {
  if (d.digits === '') return true
  if (d.digits.length > MAX_SIGNIFICANT) return false
  const order = d.digits.length + d.exp - 1
  return order <= MAX_ORDER && order >= MIN_ORDER
}

const CANONICAL = /^-?(0|[1-9]\d*)(\.\d*[1-9])?$/

export function isCanonicalNumber(s: string): boolean {
  if (!CANONICAL.test(s) || s === '-0') return false
  return inRange(decompose(s))
}

function decompose(s: string): Decimal {
  const neg = s.startsWith('-')
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.')
  return normalize(neg, int + frac, -frac.length)
}

const NUMBER_RE = /^(-?)(\d+(?:[.,]\d+)?)(?:[eE]([+-]?\d+))?\s*(.*)$/s
const PREFIX_FORM_RE = /^(-?)(\d+)\s*(.+?)(\d+)\s*(.*)$/s

function suffixPower(suffix: string, rules: NumberRules): number | null {
  if (suffix === '') return 0
  if (rules.unit !== '' && suffix === rules.unit) return 0
  if (!rules.siPrefixes) return null
  for (const sym of PREFIX_SYMBOLS) {
    if (!suffix.startsWith(sym)) continue
    const rest = suffix.slice(sym.length)
    if (rest === '' || rest === rules.unit) return PREFIX_POWERS.get(sym)!
  }
  return null
}

export function parseNumberValue(input: string, rules: NumberRules): NumberValue | null {
  const s = input.trim()
  let dec: Decimal | null = null

  const m = NUMBER_RE.exec(s)
  if (m) {
    const pow = suffixPower(m[4]!, rules)
    if (pow !== null) {
      const [int, frac = ''] = m[2]!.replace(',', '.').split('.')
      const e = m[3] === undefined ? 0 : Number(m[3])
      if (Math.abs(e) <= MAX_INPUT_EXPONENT) dec = normalize(m[1] === '-', int! + frac, -frac.length + e + pow)
    }
  }
  if (!dec && rules.siPrefixes) {
    // "4k7": prefix in place of the decimal point
    const f = PREFIX_FORM_RE.exec(s)
    if (f && PREFIX_POWERS.has(f[3]!)) {
      const pow = suffixPower(f[5]!, { unit: rules.unit, siPrefixes: false })
      if (pow !== null) dec = normalize(f[1] === '-', f[2]! + f[4]!, -f[4]!.length + PREFIX_POWERS.get(f[3]!)!)
    }
  }
  if (!dec || !inRange(dec)) return null
  return build(dec)
}

export function formatNumberValue(value: NumberValue, rules: NumberRules): string {
  const withUnit = (n: string) => (rules.unit ? `${n} ${rules.unit}` : n)
  if (!CANONICAL.test(value)) return withUnit(value)
  const d = decompose(value)
  if (!rules.siPrefixes || d.digits === '') return withUnit(value)
  const order = d.digits.length + d.exp - 1
  const p = Math.max(-24, Math.min(24, Math.floor(order / 3) * 3))
  const mantissa = build({ ...d, exp: d.exp - p })
  if (p === 0) return withUnit(mantissa)
  const sym = SI_PREFIXES[p]!.symbol
  return rules.unit ? `${mantissa} ${sym}${rules.unit}` : `${mantissa}${sym}`
}

function scaled(s: string, fracLen: number): bigint {
  const neg = s.startsWith('-')
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.')
  const n = BigInt(int! + frac.padEnd(fracLen, '0'))
  return neg ? -n : n
}

export function compareNumberValues(a: NumberValue, b: NumberValue): -1 | 0 | 1 {
  const fracLen = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0)
  const x = scaled(a, fracLen)
  const y = scaled(b, fracLen)
  return x < y ? -1 : x > y ? 1 : 0
}

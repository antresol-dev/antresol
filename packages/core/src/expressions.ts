import type { Quantity } from './quantity'
import { unitSuffixPower, type UnitDef } from './units'

/** Exact arithmetic for quantity and price fields (spec 2026-11-12 §E): + - * x × / ÷, parentheses, decimal point or
 *  comma, a unit prefix or the unit symbol on any number. Values are exact fractions of BigInts (no floats, no eval),
 *  rounded once, at the end, to the field's precision: 1/3x3 is exactly 1. */

export type ExpressionError = 'syntax' | 'unit' | 'divide_by_zero' | 'negative'

const MAX_LENGTH = 200
const MAX_DEPTH = 50

/** value = n / d, d > 0, in lowest terms */
interface Frac {
  n: bigint
  d: bigint
}

class Failure extends Error {
  constructor(readonly code: ExpressionError) {
    super(code)
  }
}

type Token =
  | { t: 'num'; v: Frac }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: '(' | ')' }

const pow10 = (k: number): bigint => 10n ** BigInt(k)

const abs = (a: bigint): bigint => (a < 0n ? -a : a)

function gcd(a: bigint, b: bigint): bigint {
  a = abs(a)
  b = abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

function frac(n: bigint, d: bigint): Frac {
  if (d < 0n) [n, d] = [-n, -d]
  const g = gcd(n, d)
  return g > 1n ? { n: n / g, d: d / g } : { n, d }
}

/** n / d rounded half away from zero; d > 0. */
function divRound(n: bigint, d: bigint): bigint {
  const q = (2n * abs(n) + d) / (2n * d)
  return n < 0n ? -q : q
}

const NUMBER = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)/
const SUFFIX = /^[^\s\d.,+\-*×/÷()]+/

/** How much of a letter run after a number is its unit or prefix: all of it, or the part before an x that is then a
 *  multiplication sign ("2mx3", "1.5kx3", "3pcsx2"). undefined: no valid split. */
function splitSuffix(run: string, unit: UnitDef): { length: number; power: number } | undefined {
  const power = unitSuffixPower(run, unit)
  if (power !== undefined) return { length: run.length, power }
  for (let k = 0; k < run.length; k++) {
    if (run[k] !== 'x' && run[k] !== 'X') continue
    const before = unitSuffixPower(run.slice(0, k), unit)
    if (before !== undefined) return { length: k, power: before }
  }
  return undefined
}

function lex(input: string, unit: UnitDef): Token[] {
  const out: Token[] = []
  let i = 0
  const rest = () => input.slice(i)
  const skip = () => {
    while (i < input.length && /\s/.test(input[i]!)) i++
  }
  for (;;) {
    skip()
    if (i >= input.length) return out
    const ch = input[i]!
    const num = NUMBER.exec(rest())
    if (num) {
      i += num[0].length
      const [int = '', fraction = ''] = num[0].replace(',', '.').split('.')
      let n = BigInt((int + fraction) || '0')
      let d = pow10(fraction.length)
      skip()
      const run = SUFFIX.exec(rest())?.[0]
      if (run !== undefined) {
        const suffix = splitSuffix(run, unit)
        if (suffix === undefined) throw new Failure('unit')
        // An x left after the suffix is a multiplication sign, lexed on the next round.
        i += suffix.length
        if (suffix.power >= 0) n *= pow10(suffix.power)
        else d *= pow10(-suffix.power)
      }
      out.push({ t: 'num', v: frac(n, d) })
      continue
    }
    i++
    if (ch === '(' || ch === ')') out.push({ t: ch })
    else if (ch === '+' || ch === '-') out.push({ t: 'op', v: ch })
    else if (ch === '*' || ch === 'x' || ch === 'X' || ch === '×') out.push({ t: 'op', v: '*' })
    else if (ch === '/' || ch === '÷') out.push({ t: 'op', v: '/' })
    else throw new Failure('syntax')
  }
}

/** The exact value of the expression; throws Failure. */
function evaluate(input: string, unit: UnitDef): Frac {
  if (input.length > MAX_LENGTH) throw new Failure('syntax')
  const tokens = lex(input, unit)
  let pos = 0
  let depth = 0
  const peek = () => tokens[pos]
  const isOp = (t: Token | undefined, ...ops: string[]): t is Extract<Token, { t: 'op' }> =>
    t?.t === 'op' && ops.includes(t.v)

  function expr(): Frac {
    let left = term()
    for (let t = peek(); isOp(t, '+', '-'); t = peek()) {
      pos++
      const right = term()
      const sign = t.v === '+' ? 1n : -1n
      left = frac(left.n * right.d + sign * right.n * left.d, left.d * right.d)
    }
    return left
  }
  function term(): Frac {
    let left = unary()
    for (let t = peek(); isOp(t, '*', '/'); t = peek()) {
      pos++
      const right = unary()
      if (t.v === '*') {
        left = frac(left.n * right.n, left.d * right.d)
      } else {
        if (right.n === 0n) throw new Failure('divide_by_zero')
        left = frac(left.n * right.d, left.d * right.n)
      }
    }
    return left
  }
  function unary(): Frac {
    const t = peek()
    if (isOp(t, '-', '+')) {
      pos++
      const v = unary()
      return t.v === '-' ? { n: -v.n, d: v.d } : v
    }
    if (t?.t === 'num') {
      pos++
      return t.v
    }
    if (t?.t === '(') {
      pos++
      if (++depth > MAX_DEPTH) throw new Failure('syntax')
      const v = expr()
      if (peek()?.t !== ')') throw new Failure('syntax')
      pos++
      depth--
      return v
    }
    throw new Failure('syntax')
  }

  const value = expr()
  if (pos !== tokens.length) throw new Failure('syntax')
  return value
}

function format(n: bigint, digits: number): string {
  const neg = n < 0n
  const s = (neg ? -n : n).toString().padStart(digits + 1, '0')
  const int = s.slice(0, s.length - digits)
  const frac = s.slice(s.length - digits).replace(/0+$/, '')
  const body = frac ? `${int}.${frac}` : int
  return neg ? `-${body}` : body
}

function run(input: string, unit: UnitDef, digits: number): { value: string } | { error: ExpressionError } {
  try {
    const exact = evaluate(input, unit)
    if (exact.n < 0n) return { error: 'negative' }
    return { value: format(divRound(exact.n * pow10(digits), exact.d), digits) }
  } catch (e) {
    if (e instanceof Failure) return { error: e.code }
    throw e
  }
}

/** A quantity expression in the item's unit: `2.5m + 120cm` with meters is 3.7. The total is never negative. */
export function evaluateAmount(
  input: string,
  unit: UnitDef,
  fractionDigits = 6,
): { value: Quantity } | { error: ExpressionError } {
  return run(input, unit, fractionDigits)
}

const NO_UNIT: UnitDef = { key: '', name: '', symbol: '', prefixPowers: [] }

/** A price expression: plain numbers, rounded half away from zero once, to `fractionDigits` (the currency's decimals
 *  when the field knows them). */
export function evaluatePrice(input: string, fractionDigits = 4): { value: string } | { error: ExpressionError } {
  return run(input, NO_UNIT, fractionDigits)
}

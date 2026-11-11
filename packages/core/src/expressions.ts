import type { Quantity } from './quantity'
import { unitSuffixPower, type UnitDef } from './units'

/** Exact arithmetic for quantity and price fields (spec 2026-11-12 §E): + - * x × / ÷, parentheses, decimal point or
 *  comma, a unit prefix or the unit symbol on any number. Decimals are BigInt over a power of ten: no floats, no eval. */

export type ExpressionError = 'syntax' | 'unit' | 'divide_by_zero' | 'negative'

const MAX_LENGTH = 200
const MAX_DEPTH = 50

/** value = n / 10^e, e >= 0 */
interface Dec {
  n: bigint
  e: number
}

class Failure extends Error {
  constructor(readonly code: ExpressionError) {
    super(code)
  }
}

type Token =
  | { t: 'num'; v: Dec }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: '(' | ')' }

const pow10 = (k: number): bigint => 10n ** BigInt(k)

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const e = Math.max(a.e, b.e)
  return [a.n * pow10(e - a.e), b.n * pow10(e - b.e), e]
}

/** n / d rounded half away from zero; d > 0. */
function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n
  const m = neg ? -n : n
  const q = (2n * m + d) / (2n * d)
  return neg ? -q : q
}

/** Rescales to `digits` fraction digits, rounding half away from zero. */
function toScale(x: Dec, digits: number): bigint {
  return x.e <= digits ? x.n * pow10(digits - x.e) : divRound(x.n, pow10(x.e - digits))
}

const NUMBER = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)/
const SUFFIX = /^[^\s\d.,+\-*×/÷()]+/

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
      const [int = '', frac = ''] = num[0].replace(',', '.').split('.')
      let v: Dec = { n: BigInt((int + frac) || '0'), e: frac.length }
      skip()
      const run = SUFFIX.exec(rest())?.[0]
      if (run !== undefined) {
        const power = unitSuffixPower(run, unit)
        if (power !== undefined) {
          i += run.length
          v = power >= 0 ? { n: v.n * pow10(power), e: v.e } : { n: v.n, e: v.e - power }
        } else if (!/^[xX]/.test(run)) {
          throw new Failure('unit')
        }
        // else: the x is a multiplication sign, lexed on the next round
      }
      out.push({ t: 'num', v })
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

function evaluate(input: string, unit: UnitDef, digits: number): bigint {
  if (input.length > MAX_LENGTH) throw new Failure('syntax')
  const tokens = lex(input, unit)
  let pos = 0
  let depth = 0
  const peek = () => tokens[pos]
  const isOp = (t: Token | undefined, ...ops: string[]): t is Extract<Token, { t: 'op' }> =>
    t?.t === 'op' && ops.includes(t.v)

  function expr(): Dec {
    let left = term()
    for (let t = peek(); isOp(t, '+', '-'); t = peek()) {
      pos++
      const right = term()
      const [a, b, e] = align(left, right)
      left = { n: t.v === '+' ? a + b : a - b, e }
    }
    return left
  }
  function term(): Dec {
    let left = unary()
    for (let t = peek(); isOp(t, '*', '/'); t = peek()) {
      pos++
      const right = unary()
      if (t.v === '*') {
        left = { n: left.n * right.n, e: left.e + right.e }
      } else {
        if (right.n === 0n) throw new Failure('divide_by_zero')
        // (ln / 10^le) / (rn / 10^re) at `digits` fraction digits
        const num = left.n * pow10(right.e + digits)
        const den = right.n * pow10(left.e)
        const neg = den < 0n
        left = { n: divRound(neg ? -num : num, neg ? -den : den), e: digits }
      }
    }
    return left
  }
  function unary(): Dec {
    const t = peek()
    if (isOp(t, '-', '+')) {
      pos++
      const v = unary()
      return t.v === '-' ? { n: -v.n, e: v.e } : v
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
  return toScale(value, digits)
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
    const n = evaluate(input, unit, digits)
    if (n < 0n) return { error: 'negative' }
    return { value: format(n, digits) }
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

/** A price expression: plain numbers, 4 fraction digits (division rounds half up). */
export function evaluatePrice(input: string): { value: string } | { error: ExpressionError } {
  return run(input, NO_UNIT, 4)
}

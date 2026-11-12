/** Canonical decimal string: up to 6 fraction digits, no trailing zeros, "0" for zero. */
export type Quantity = string

const SCALE = 6
const MICRO = 10n ** BigInt(SCALE)

/** Quantity -> BigInt micro-units (x10^6). Input must be a canonical Quantity. */
export function toMicro(q: Quantity): bigint {
  const negative = q.startsWith('-')
  const [int = '0', frac = ''] = (negative ? q.slice(1) : q).split('.')
  const micro = BigInt(int) * MICRO + BigInt(frac.padEnd(SCALE, '0'))
  return negative ? -micro : micro
}

/** BigInt micro-units -> canonical Quantity. */
export function fromMicro(micro: bigint): Quantity {
  const negative = micro < 0n
  const abs = negative ? -micro : micro
  const int = abs / MICRO
  const frac = (abs % MICRO).toString().padStart(SCALE, '0').replace(/0+$/, '')
  const body = frac ? `${int}.${frac}` : `${int}`
  return negative && abs !== 0n ? `-${body}` : body
}

export function parseQuantity(input: string): Quantity | null {
  const m = /^(-?)(\d+)(?:[.,](\d{1,6}))?$/.exec(input.trim())
  if (!m) return null
  return fromMicro(toMicro(`${m[1]}${m[2]}${m[3] ? `.${m[3]}` : ''}`))
}

export function addQ(a: Quantity, b: Quantity): Quantity {
  return fromMicro(toMicro(a) + toMicro(b))
}

export function subQ(a: Quantity, b: Quantity): Quantity {
  return fromMicro(toMicro(a) - toMicro(b))
}

export function negQ(a: Quantity): Quantity {
  return fromMicro(-toMicro(a))
}

export function cmpQ(a: Quantity, b: Quantity): -1 | 0 | 1 {
  const x = toMicro(a)
  const y = toMicro(b)
  return x < y ? -1 : x > y ? 1 : 0
}

export function isPositiveQ(q: Quantity): boolean {
  return toMicro(q) > 0n
}

/** For display only; never use for arithmetic. */
export function quantityToNumber(q: Quantity): number {
  return Number(q)
}

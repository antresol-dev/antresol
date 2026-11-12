import type { Id } from './ids'
import type { CustomUnit } from './model'
import { fromMicro, parseQuantity, toMicro, type Quantity } from './quantity'

export interface UnitDef {
  key: string
  name: string
  symbol: string
  prefixPowers: number[]
}

export const BUILTIN_UNITS: Record<'pcs' | 'm' | 'g' | 'l', UnitDef> = {
  pcs: { key: 'pcs', name: 'Pieces', symbol: 'pcs', prefixPowers: [3, 6] },
  m: { key: 'm', name: 'Meters', symbol: 'm', prefixPowers: [-3, -2, 3] },
  g: { key: 'g', name: 'Grams', symbol: 'g', prefixPowers: [-3, 3] },
  l: { key: 'l', name: 'Liters', symbol: 'l', prefixPowers: [-3] },
}

export const SI_PREFIXES: Record<number, { symbol: string; name: string }> = {
  24: { symbol: 'Y', name: 'yotta' },
  21: { symbol: 'Z', name: 'zetta' },
  18: { symbol: 'E', name: 'exa' },
  15: { symbol: 'P', name: 'peta' },
  12: { symbol: 'T', name: 'tera' },
  9: { symbol: 'G', name: 'giga' },
  6: { symbol: 'M', name: 'mega' },
  3: { symbol: 'k', name: 'kilo' },
  2: { symbol: 'h', name: 'hecto' },
  [-1]: { symbol: 'd', name: 'deci' },
  [-2]: { symbol: 'c', name: 'centi' },
  [-3]: { symbol: 'm', name: 'milli' },
  [-6]: { symbol: 'µ', name: 'micro' },
  [-9]: { symbol: 'n', name: 'nano' },
  [-12]: { symbol: 'p', name: 'pico' },
  [-15]: { symbol: 'f', name: 'femto' },
  [-18]: { symbol: 'a', name: 'atto' },
  [-21]: { symbol: 'z', name: 'zepto' },
  [-24]: { symbol: 'y', name: 'yocto' },
}

export function customUnitKey(id: Id): string {
  return `custom:${id}`
}

export function resolveUnit(key: string, custom: CustomUnit[]): UnitDef | undefined {
  if (Object.hasOwn(BUILTIN_UNITS, key)) return BUILTIN_UNITS[key as keyof typeof BUILTIN_UNITS]
  const u = custom.find((c) => customUnitKey(c.id) === key)
  return u && { key, name: u.name, symbol: u.symbol, prefixPowers: u.prefixPowers }
}

const abs = (n: bigint) => (n < 0n ? -n : n)

export function formatAmountParts(q: Quantity, unit: UnitDef): { number: string; unit: string } {
  const micro = toMicro(q)
  // Largest power in [0, ...prefixPowers] for which |value| / 10^p >= 1.
  // Values below every threshold fall back to the smallest power.
  let p = 0
  if (micro !== 0n) {
    const powers = [0, ...unit.prefixPowers].sort((a, b) => b - a)
    p = powers.find((x) => abs(micro) * 10n ** BigInt(Math.max(0, -x)) >= 10n ** BigInt(6 + Math.max(0, x))) ??
      powers[powers.length - 1]!
  }
  // Thousandths of the scaled value, rounded half-up (away from zero) on the magnitude.
  const exp = 3 + p
  let thousandths: bigint
  if (exp >= 0) {
    const div = 10n ** BigInt(exp)
    thousandths = (abs(micro) + div / 2n) / div
  } else {
    thousandths = abs(micro) * 10n ** BigInt(-exp)
  }
  const sign = micro < 0n && thousandths !== 0n ? '-' : ''
  const int = thousandths / 1000n
  const frac = (thousandths % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  const number = `${sign}${int}${frac ? `.${frac}` : ''}`
  const prefix = p === 0 ? '' : (SI_PREFIXES[p]?.symbol ?? '')
  // Pieces show a bare prefix ("1.5k"), not "kpcs".
  return { number, unit: unit.key === 'pcs' ? prefix || unit.symbol : `${prefix}${unit.symbol}` }
}

export function formatAmount(q: Quantity, unit: UnitDef): string {
  const { number, unit: symbol } = formatAmountParts(q, unit)
  return unit.key === 'pcs' && symbol !== unit.symbol ? `${number}${symbol}` : `${number} ${symbol}`
}

/** The power of ten a suffix stands for: '' or the unit symbol is 0, 'k' / 'km' is 3; undefined if it is none of the
 *  unit's prefixes. */
export function unitSuffixPower(suffix: string, unit: UnitDef): number | undefined {
  if (suffix === '' || suffix === unit.symbol) return 0
  let power: number | undefined
  for (const p of unit.prefixPowers) {
    const symbols = p === -6 ? ['µ', 'u'] : [SI_PREFIXES[p]?.symbol]
    for (const s of symbols) {
      if (s && (suffix === s || suffix === s + unit.symbol)) power = p
    }
  }
  return power
}

export function parseAmount(input: string, unit: UnitDef): Quantity | null {
  const m = /^\s*(-?[\d.,]+)\s*(\S*)\s*$/.exec(input)
  if (!m) return null
  const number = parseQuantity(m[1]!)
  if (number === null) return null
  const suffix = m[2]!

  const power = unitSuffixPower(suffix, unit)
  if (power === undefined) return null

  const micro = toMicro(number)
  if (power >= 0) return fromMicro(micro * 10n ** BigInt(power))
  const div = 10n ** BigInt(-power)
  return micro % div === 0n ? fromMicro(micro / div) : null
}

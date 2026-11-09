import currencyData from './data/currencies.json'
import { quantityToNumber, type Quantity } from './quantity'

export interface Currency {
  code: string
  name: string
  symbol: string
  decimals: number
}

export const CURRENCIES: Readonly<Record<string, Currency>> = Object.freeze(
  Object.fromEntries(
    Object.entries(currencyData as Record<string, Omit<Currency, 'code'>>).map(([code, c]) => [
      code,
      { code, name: c.name, symbol: c.symbol, decimals: c.decimals },
    ]),
  ),
)

export function getCurrency(code: string): Currency | undefined {
  return Object.hasOwn(CURRENCIES, code) ? CURRENCIES[code] : undefined
}

/** Parses a non-negative amount into integer minor units; null if invalid or too precise. */
export function parseMoney(input: string, currency: Currency): number | null {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(input.trim())
  if (!m) return null
  const frac = m[2] ?? ''
  if (frac.length > currency.decimals) return null
  const minor = Number(m[1] + frac.padEnd(currency.decimals, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

/** Minor units per one unit of quantity (fractional). Zero quantity yields 0. */
export function unitPrice(totalMinor: number, quantity: Quantity): number {
  const q = quantityToNumber(quantity)
  return q === 0 ? 0 : totalMinor / q
}

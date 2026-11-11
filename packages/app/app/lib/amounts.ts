import { BUILTIN_UNITS, evaluateAmount, evaluatePrice, formatAmount, getCurrency, parseAmount, parseMoney, customUnitKey, type InventorySnapshot, type Quantity, type UnitDef } from '@graymatter/core'
import { byName } from './views'

/** Built-ins in BUILTIN_UNITS order, then custom units by name in the lists' order (as on Tags & fields). */
export function unitChoices(s: InventorySnapshot): UnitDef[] {
  const custom = [...s.units]
    .sort(byName)
    .map((u) => ({ key: customUnitKey(u.id), name: u.name, symbol: u.symbol, prefixPowers: u.prefixPowers }))
  return [...Object.values(BUILTIN_UNITS), ...custom]
}


/** Text with an operator or a bracket is an expression ("2.5m + 120cm", "5x100"); anything else is a plain value. */
export const isExpression = (text: string): boolean => /[+\-*×÷/()xX]/.test(text.trim())

/** Text → Quantity in the base unit. Accepts ',' as the decimal mark, the unit's prefixes ('50cm', '2.5 mm') and
 *  expressions ('2.5m + 120cm', '3 * 1.5k', '5x100'; division rounds to 6 decimals).
 *  null: empty, not a number, negative, more than 6 decimals in the base unit, or a prefix the unit lacks. */
export function parseAmountText(text: string, unit: UnitDef): Quantity | null {
  const q = parseAmount(text, unit)
  if (q !== null) return q.startsWith('-') ? null : q
  if (!isExpression(text)) return null
  const r = evaluateAmount(text, unit)
  return 'value' in r ? r.value : null
}

/** Rounds a plain decimal string half away from zero to `digits` fraction digits. */
function roundDecimal(value: string, digits: number): string {
  const [whole = '0', frac = ''] = value.split('.')
  if (frac.length <= digits) return value
  const kept = BigInt(whole + frac.slice(0, digits)) + (frac.charCodeAt(digits) >= 53 ? 1n : 0n)
  const s = kept.toString().padStart(digits + 1, '0')
  return digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`
}

/** Text → integer minor units. Expressions work too ("2.30 + 1.1", "12 / 3"); a result with more decimals than the
 *  currency has is rounded to them. null: empty, invalid, negative, or (for a plain value) too many decimals. */
export function parseMoneyText(text: string, currency: string): number | null {
  const c = getCurrency(currency)
  if (!c) return null
  const plain = parseMoney(text, c)
  if (plain !== null || !isExpression(text)) return plain
  const r = evaluatePrice(text)
  return 'value' in r ? parseMoney(roundDecimal(r.value, c.decimals), c) : null
}

export type ExpressionPreview = { text: string } | { errorKey: string }

const errorKeyOf = (e: string): string => `expression.${e}`

/** "= 3.7 m" under an amount field that holds an expression; null for a plain value or an empty field. */
export function amountPreview(text: string, unit: UnitDef): ExpressionPreview | null {
  if (text.trim() === '' || !isExpression(text) || parseAmount(text, unit) !== null) return null
  const r = evaluateAmount(text, unit)
  return 'value' in r ? { text: formatAmount(r.value, unit) } : { errorKey: errorKeyOf(r.error) }
}

/** "= 3.33" under a price field that holds an expression. */
export function pricePreview(text: string, currency: string): ExpressionPreview | null {
  const c = getCurrency(currency)
  if (!c || text.trim() === '' || !isExpression(text) || parseMoney(text, c) !== null) return null
  const r = evaluatePrice(text)
  if (!('value' in r)) return { errorKey: errorKeyOf(r.error) }
  const minor = parseMoney(roundDecimal(r.value, c.decimals), c)
  return minor === null ? { errorKey: errorKeyOf('syntax') } : { text: (minor / 10 ** c.decimals).toFixed(c.decimals) }
}

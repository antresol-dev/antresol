import { BUILTIN_UNITS, evaluateAmount, evaluatePrice, formatAmount, getCurrency, parseAmount, SI_PREFIXES, parseMoney, customUnitKey, type InventorySnapshot, type Quantity, type UnitDef } from '@antresol/core'
import { byName } from './views'

/** Built-ins in BUILTIN_UNITS order, then custom units by name in the lists' order (as on Tags & fields). */
export function unitChoices(s: InventorySnapshot): UnitDef[] {
  const custom = [...s.units]
    .sort(byName)
    .map((u) => ({ key: customUnitKey(u.id), name: u.name, symbol: u.symbol, prefixPowers: u.prefixPowers }))
  return [...Object.values(BUILTIN_UNITS), ...custom]
}


/** The text with only the characters an amount in this unit can hold: digits, decimal marks, spaces, expression signs and
 *  brackets, and the letters of the unit's symbol and of its prefixes ('k' for pieces, 'm', 'c', 'k' for meters; 'u' as
 *  well as 'µ' for micro). "asda" in pieces is ''. Whether the rest reads as an amount is parseAmountText's job. */
export function amountTextOnly(text: string, unit: UnitDef): string {
  const letters = new Set(unit.symbol)
  for (const p of unit.prefixPowers) {
    for (const ch of SI_PREFIXES[p]?.symbol ?? '') letters.add(ch)
    if (p === -6) letters.add('u')
  }
  return [...text].filter((ch) => /[\d\s.,+\-*/×÷xX()]/.test(ch) || letters.has(ch)).join('')
}

/** An example amount in this unit for error copy: "10 pcs or 5x100", "10 m or 50 mm" (the smallest prefix below the
 *  unit when it has one). */
export function amountExample(unit: UnitDef): string {
  const below = unit.prefixPowers.filter((p) => p < 0).sort((a, b) => a - b)[0]
  const prefix = below === undefined ? undefined : SI_PREFIXES[below]?.symbol
  return prefix ? `10 ${unit.symbol} or 50 ${prefix}${unit.symbol}` : `10 ${unit.symbol} or 5x100`
}

/** Text with an operator or a bracket is an expression ("2.5m + 120cm", "5x100"); anything else is a plain value. */
export const isExpression = (text: string): boolean => /[+\-*×÷/()xX]/.test(text.trim())

/** Text → Quantity in the base unit. Accepts ',' as the decimal mark, the unit's prefixes ('50cm', '2.5 mm') and
 *  expressions ('2.5m + 120cm', '3 * 1.5k', '5x100'; exact, the result rounded once to 6 decimals).
 *  null: empty, not a number, negative, more than 6 decimals in the base unit, or a prefix the unit lacks. */
export function parseAmountText(text: string, unit: UnitDef): Quantity | null {
  const q = parseAmount(text, unit)
  if (q !== null) return q.startsWith('-') ? null : q
  if (!isExpression(text)) return null
  const r = evaluateAmount(text, unit)
  return 'value' in r ? r.value : null
}

/** Text → integer minor units. Expressions work too ("2.30 + 1.1", "12 / 3"), evaluated exactly and rounded once to
 *  the currency's decimals. null: empty, invalid, negative, or (for a plain value) too many decimals. */
export function parseMoneyText(text: string, currency: string): number | null {
  const c = getCurrency(currency)
  if (!c) return null
  const plain = parseMoney(text, c)
  if (plain !== null || !isExpression(text)) return plain
  const r = evaluatePrice(text, c.decimals)
  return 'value' in r ? parseMoney(r.value, c) : null
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
  const r = evaluatePrice(text, c.decimals)
  if (!('value' in r)) return { errorKey: errorKeyOf(r.error) }
  const minor = parseMoney(r.value, c)
  return minor === null ? { errorKey: errorKeyOf('syntax') } : { text: (minor / 10 ** c.decimals).toFixed(c.decimals) }
}

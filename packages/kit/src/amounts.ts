import { BUILTIN_UNITS, evaluateAmount, evaluatePrice, formatAmount, getCurrency, parseAmount, SI_PREFIXES, parseMoney, customUnitKey, type InventorySnapshot, type Quantity, type UnitDef } from '@antresol/core'
import { byName } from './views'

/** Built-ins in BUILTIN_UNITS order, then custom units by name in the lists' order (as on Tags & fields). */
export function unitChoices(s: InventorySnapshot): UnitDef[] {
  const custom = [...s.units]
    .sort(byName)
    .map((u) => ({ key: customUnitKey(u.id), name: u.name, symbol: u.symbol, prefixPowers: u.prefixPowers }))
  return [...Object.values(BUILTIN_UNITS), ...custom]
}


/** What may follow a number in an amount field of this unit: its prefixes ('k', 'M' for pieces; 'u' as well as 'µ' for
 *  micro). The field shows the unit symbol itself, so the symbol is never typed, except after a prefix spelled like it
 *  ('mm' for millimetres, as a bare 'm' in meters is the meter). */
export function amountSuffixes(unit: UnitDef): string[] {
  return unit.prefixPowers.flatMap((p) => {
    const symbols = p === -6 ? ['µ', 'u'] : [SI_PREFIXES[p]?.symbol ?? '']
    return symbols.filter((x) => x !== '').map((x) => (x === unit.symbol ? x + unit.symbol : x))
  })
}

/** Whether the text can be (the start of) an amount in this unit: numbers, expression signs and brackets, and at most
 *  one prefix of the unit right after a number, which closes it ('2k', '2k + 3k'; not 'k2', '4k7', '10 pcs', 'asda').
 *  Whether it reads as a full amount is still parseAmountText's job ('2.' or '(3' pass here). */
export function amountDraftOk(text: string, unit: UnitDef): boolean {
  const suffixes = amountSuffixes(unit)
  let afterNumber = false
  let afterSuffix = false
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!
    if (/\s/.test(ch)) i++
    else if (/[\d.,]/.test(ch)) {
      if (afterSuffix) return false
      afterNumber = true
      i++
    } else if (/[+\-*/×÷xX()]/.test(ch)) {
      afterNumber = false
      afterSuffix = false
      i++
    } else {
      const run = /^[^\s\d.,+\-*/×÷xX()]+/.exec(text.slice(i))![0]
      if (!afterNumber || afterSuffix || !suffixes.some((x) => x.startsWith(run))) return false
      afterSuffix = true
      i += run.length
    }
  }
  return true
}

/** An example for the invalid-amount message, as typed in this unit's field (the symbol shows at the field's edge):
 *  "10, 2k or 5x100" in pieces, "10, 50c or 5x100" in meters (the prefix nearest below the unit, else the nearest above,
 *  never one spelled like the symbol), "10 or 5x100" without prefixes. */
export function amountExample(unit: UnitDef): string {
  const usable = unit.prefixPowers.filter((p) => SI_PREFIXES[p] && SI_PREFIXES[p]!.symbol !== unit.symbol)
  const below = usable.filter((p) => p < 0).sort((a, b) => b - a)[0]
  const above = usable.filter((p) => p > 0).sort((a, b) => a - b)[0]
  const p = below ?? above
  if (p === undefined) return '10 or 5x100'
  return `10, ${p < 0 ? 50 : 2}${SI_PREFIXES[p]!.symbol} or 5x100`
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

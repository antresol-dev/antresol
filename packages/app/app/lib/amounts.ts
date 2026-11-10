import { BUILTIN_UNITS, getCurrency, parseAmount, parseMoney, customUnitKey, type InventorySnapshot, type Quantity, type UnitDef } from '@graymatter/core'

/** Built-ins in BUILTIN_UNITS order, then custom units by name. */
export function unitChoices(s: InventorySnapshot): UnitDef[] {
  const custom = [...s.units]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((u) => ({ key: customUnitKey(u.id), name: u.name, symbol: u.symbol, prefixPowers: u.prefixPowers }))
  return [...Object.values(BUILTIN_UNITS), ...custom]
}

/** Text → Quantity in the base unit. Accepts ',' as the decimal mark and the unit's prefixes ('50cm', '2.5 mm').
 *  null: empty, not a number, negative, more than 6 decimals in the base unit, or a prefix the unit lacks. */
export function parseAmountText(text: string, unit: UnitDef): Quantity | null {
  const q = parseAmount(text, unit)
  return q === null || q.startsWith('-') ? null : q
}

/** Text → integer minor units; null: empty, invalid, negative, or more decimals than the currency has. */
export function parseMoneyText(text: string, currency: string): number | null {
  const c = getCurrency(currency)
  return c ? parseMoney(text, c) : null
}

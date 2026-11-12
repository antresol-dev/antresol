import { CURRENCIES, type Currency } from '@antresol/core'

const BY_CODE: readonly Currency[] = Object.values(CURRENCIES).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))

/** Code match first (exact, then prefix), then name substring; case-insensitive; empty query → all, by code. */
export function currencyOptions(query: string): Currency[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...BY_CODE]
  const exact: Currency[] = []
  const prefix: Currency[] = []
  const byName: Currency[] = []
  for (const c of BY_CODE) {
    const code = c.code.toLowerCase()
    if (code === q) exact.push(c)
    else if (code.startsWith(q)) prefix.push(c)
    else if (c.name.toLowerCase().includes(q)) byName.push(c)
  }
  return [...exact, ...prefix, ...byName]
}

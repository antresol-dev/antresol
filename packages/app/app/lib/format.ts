const LOCALE = 'en'

const digitsOf = (currency: string): number =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

const currencyFormat = (currency: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...options })

/** Integer minor units → "$2.30", with the currency's own decimals. */
export function formatMoney(minor: number, currency: string): string {
  return currencyFormat(currency).format(minor / 10 ** digitsOf(currency))
}

/** A price per unit, fractional minor units allowed: from one major unit up the currency's decimals; below it up to
 *  3 significant digits, but never fewer decimals than the currency has ($0.0622, $0.50, not $0.5). */
export function formatUnitPrice(minorPerUnit: number, currency: string): string {
  const digits = digitsOf(currency)
  const major = minorPerUnit / 10 ** digits
  if (Math.abs(major) >= 1) return currencyFormat(currency).format(major)
  const parts = currencyFormat(currency, { maximumSignificantDigits: 3 }).formatToParts(major)
  const decimals = parts.find((p) => p.type === 'fraction')?.value.length ?? 0
  return decimals >= digits ? parts.map((p) => p.value).join('') : currencyFormat(currency).format(major)
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

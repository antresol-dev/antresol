const LOCALE = 'en'

const digitsOf = (currency: string): number =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

const currencyFormat = (currency: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...options })

/** Integer minor units → "$2.30", with the currency's own decimals. */
export function formatMoney(minor: number, currency: string): string {
  return currencyFormat(currency).format(minor / 10 ** digitsOf(currency))
}

/** A price per unit, fractional minor units allowed: from one major unit up the currency's decimals, below it 3 significant digits. */
export function formatUnitPrice(minorPerUnit: number, currency: string): string {
  const major = minorPerUnit / 10 ** digitsOf(currency)
  if (Math.abs(major) >= 1) return currencyFormat(currency).format(major)
  return currencyFormat(currency, {
    maximumSignificantDigits: 3,
    minimumFractionDigits: 0,
    maximumFractionDigits: 20,
  }).format(major)
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

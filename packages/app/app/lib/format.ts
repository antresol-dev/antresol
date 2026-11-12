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

export type CheckedAgo = {
  key: 'sync.notChecked' | 'sync.checkedJustNow' | 'sync.checkedMinutes' | 'sync.checkedHours' | 'sync.checkedDays'
  n?: number
}

/** How long ago the last successful check was, rounded down: just now under a minute, then minutes, hours, days. */
export function checkedAgo(iso: string | null, now: Date): CheckedAgo {
  if (iso === null) return { key: 'sync.notChecked' }
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return { key: 'sync.checkedJustNow' }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { key: 'sync.checkedMinutes', n: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'sync.checkedHours', n: hours }
  return { key: 'sync.checkedDays', n: Math.floor(hours / 24) }
}

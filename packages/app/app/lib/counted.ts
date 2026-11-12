import type { Id, InventorySnapshot } from '@antresol/core'

export interface CountedAgo {
  /** How many units back; 0 = today. */
  value: number
  unit: 'day' | 'week' | 'month' | 'year'
}

const DAY_MS = 86_400_000

/** How long ago a recount was, by the device's calendar days, rounded down: days under a week, then weeks under 30
 *  days, months under a year, then years. Shown as "Counted 3 weeks ago" (Intl.RelativeTimeFormat, numeric auto). */
export function countedAgo(iso: string, now: Date): CountedAgo {
  const at = new Date(iso)
  // Local midnights; rounding absorbs a daylight-saving hour.
  const from = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const days = Math.max(0, Math.round((to - from) / DAY_MS))
  if (days < 7) return { value: days, unit: 'day' }
  if (days < 30) return { value: Math.floor(days / 7), unit: 'week' }
  if (days < 365) return { value: Math.floor(days / 30), unit: 'month' }
  return { value: Math.floor(days / 365), unit: 'year' }
}

/** When the given buckets of an item were all last recounted: the oldest of their last recounts (spec 4.14), null when
 *  one of them never was (or there are none). */
export function lastCounted(s: InventorySnapshot, itemId: Id, variantIds: (Id | null)[]): string | null {
  let oldest: string | null = null
  for (const variantId of variantIds) {
    const at = s.stock.find((l) => l.itemId === itemId && l.variantId === variantId)?.lastCountedAt ?? null
    if (at === null) return null
    if (oldest === null || at < oldest) oldest = at
  }
  return oldest
}

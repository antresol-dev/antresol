import type { InventorySnapshot, StockLine } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { countedAgo, lastCounted } from '../app/lib/counted'

describe('countedAgo', () => {
  // Local times: "today" is the device's calendar day.
  const now = new Date(2026, 10, 11, 9, 0)
  const ago = (y: number, m: number, d: number, h = 12) => countedAgo(new Date(y, m, d, h).toISOString(), now)

  it('counts calendar days, not 24-hour spans', () => {
    expect(ago(2026, 10, 11, 0)).toEqual({ value: 0, unit: 'day' })
    expect(ago(2026, 10, 10, 23)).toEqual({ value: 1, unit: 'day' })
    expect(ago(2026, 10, 5)).toEqual({ value: 6, unit: 'day' })
  })

  it('goes on in weeks, months and years, rounded down', () => {
    expect(ago(2026, 10, 4)).toEqual({ value: 1, unit: 'week' })
    expect(ago(2026, 9, 21)).toEqual({ value: 3, unit: 'week' })
    expect(ago(2026, 9, 13)).toEqual({ value: 4, unit: 'week' })
    expect(ago(2026, 9, 12)).toEqual({ value: 1, unit: 'month' })
    expect(ago(2026, 4, 11)).toEqual({ value: 6, unit: 'month' })
    expect(ago(2025, 10, 11)).toEqual({ value: 1, unit: 'year' })
    expect(ago(2023, 10, 1)).toEqual({ value: 3, unit: 'year' })
  })

  it('treats a time ahead of the device clock as today', () => {
    expect(ago(2026, 10, 12)).toEqual({ value: 0, unit: 'day' })
  })
})

describe('lastCounted', () => {
  const line = (variantId: string | null, lastCountedAt: string | null): StockLine => ({
    itemId: 'item',
    variantId,
    quantity: '1',
    pricedQuantity: '0',
    pricedTotal: 0,
    lastPriced: null,
    lastCountedAt,
  })
  const snapshot = (stock: StockLine[]) => ({ stock }) as unknown as InventorySnapshot

  it('is the bucket’s last recount', () => {
    const s = snapshot([line(null, '2026-11-01T10:00:00.000Z')])
    expect(lastCounted(s, 'item', [null])).toBe('2026-11-01T10:00:00.000Z')
    expect(lastCounted(snapshot([line(null, null)]), 'item', [null])).toBeNull()
  })

  it('over several buckets is the oldest recount, and none while a bucket was never counted', () => {
    const s = snapshot([line('a', '2026-11-05T10:00:00.000Z'), line('b', '2026-10-01T10:00:00.000Z')])
    expect(lastCounted(s, 'item', ['a', 'b'])).toBe('2026-10-01T10:00:00.000Z')
    expect(lastCounted(s, 'item', ['a', 'b', 'c'])).toBeNull()
    expect(lastCounted(s, 'item', [])).toBeNull()
  })
})

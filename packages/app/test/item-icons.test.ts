import * as lucide from '@lucide/vue'
import { describe, expect, it } from 'vitest'
import { ITEM_ICON_GROUPS, isItemIcon, loadItemIconSet } from '../app/lib/item-icons'

const all = ITEM_ICON_GROUPS.flatMap((g) => g.names)
const pascal = (n: string): string => n.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('')

describe('item icons', () => {
  it('has no duplicate names and no empty group', () => {
    expect(new Set(all).size).toBe(all.length)
    for (const g of ITEM_ICON_GROUPS) {
      expect(g.title).not.toMatch(/сомнительно/)
      expect(g.names.length).toBeGreaterThan(0)
    }
  })

  it('has the owner\'s 368 names', () => {
    expect(all.length).toBe(368)
  })

  it('every name is a @lucide/vue icon and is in the loaded set', async () => {
    const set = await loadItemIconSet()
    for (const n of all) {
      expect(pascal(n) in lucide, n).toBe(true)
      expect(set[n], n).toBe((lucide as Record<string, unknown>)[pascal(n)])
    }
    expect(Object.keys(set).sort()).toEqual([...all].sort())
  })

  it('shares one promise and knows its names', () => {
    expect(loadItemIconSet()).toBe(loadItemIconSet())
    expect(isItemIcon('microchip')).toBe(true)
    expect(isItemIcon('nope')).toBe(false)
    expect(isItemIcon(null)).toBe(false)
  })
})

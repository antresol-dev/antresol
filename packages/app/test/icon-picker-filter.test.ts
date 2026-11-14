import { describe, expect, it } from 'vitest'
import { ITEM_ICON_GROUPS, filterIconGroups } from '../app/lib/item-icons'

const names = (q: string): string[] => filterIconGroups(ITEM_ICON_GROUPS, q).flatMap((g) => g.names)

describe('filterIconGroups', () => {
  it('returns every group for an empty or blank query', () => {
    expect(filterIconGroups(ITEM_ICON_GROUPS, '')).toBe(ITEM_ICON_GROUPS)
    expect(filterIconGroups(ITEM_ICON_GROUPS, '   ')).toBe(ITEM_ICON_GROUPS)
  })

  it('matches a part of a name, ignoring case', () => {
    expect(names('MICRO')).toEqual(expect.arrayContaining(['microchip', 'microscope', 'microwave']))
    expect(names('micro').every((n) => n.includes('micro'))).toBe(true)
  })

  it('matches spaces with hyphens', () => {
    expect(names('package open')).toEqual(['package-open'])
    expect(names(' hard  drive ')).toContain('hard-drive')
  })

  it('drops groups with no match and returns [] for no match at all', () => {
    const groups = filterIconGroups(ITEM_ICON_GROUPS, 'cat')
    expect(groups.every((g) => g.names.length > 0)).toBe(true)
    expect(groups.length).toBeLessThan(ITEM_ICON_GROUPS.length)
    expect(names('zzzz')).toEqual([])
  })
})

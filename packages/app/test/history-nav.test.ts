import { describe, expect, it } from 'vitest'
import { entryInventory, entrySync, INVENTORY_KEY, navAvailability } from '../app/lib/history-nav'

const A = { sourceId: 's', inventoryId: 'a' }
const B = { sourceId: 's', inventoryId: 'b' }
const C = { sourceId: 's', inventoryId: 'c' }

describe('history-nav', () => {
  it('reads back and forward from the router state', () => {
    expect(navAvailability({ back: '/folder/1', forward: null })).toEqual({ canBack: true, canForward: false })
    expect(navAvailability({ back: null, forward: '/x' })).toEqual({ canBack: false, canForward: true })
    expect(navAvailability({ back: '/', forward: '/x', position: 3 })).toEqual({ canBack: true, canForward: true })
    expect(navAvailability(null)).toEqual({ canBack: false, canForward: false })
    expect(navAvailability(undefined)).toEqual({ canBack: false, canForward: false })
    expect(navAvailability('junk')).toEqual({ canBack: false, canForward: false })
  })

  it('reads the inventory stamped on an entry', () => {
    expect(INVENTORY_KEY).toBe('gmInventory')
    expect(entryInventory({ back: null, [INVENTORY_KEY]: A })).toEqual(A)
    expect(entryInventory({ [INVENTORY_KEY]: { ...A, extra: 1 } })).toEqual(A)
    expect(entryInventory({ [INVENTORY_KEY]: 'junk' })).toBeNull()
    expect(entryInventory({ [INVENTORY_KEY]: { sourceId: 's' } })).toBeNull()
    expect(entryInventory({ [INVENTORY_KEY]: null })).toBeNull()
    expect(entryInventory({ back: null })).toBeNull()
    expect(entryInventory(undefined)).toBeNull()
    expect(entryInventory(null)).toBeNull()
  })

  it('decides what to do after landing on an entry of an inventory screen', () => {
    expect(entrySync(null, A, [A, B], true)).toEqual({ kind: 'stamp' })
    expect(entrySync(A, A, [A, B], true)).toEqual({ kind: 'none' })
    expect(entrySync(B, A, [A, B], true)).toEqual({ kind: 'switch', ref: B })
    expect(entrySync(C, A, [A, B], true)).toEqual({ kind: 'root' })
    expect(entrySync(B, null, [B], true)).toEqual({ kind: 'switch', ref: B })
  })

  it('compares inventories by value and leaves an entry alone without a current inventory', () => {
    expect(entrySync({ ...A }, { ...A }, [], true)).toEqual({ kind: 'none' })
    expect(entrySync({ ...B }, A, [{ ...B }], true)).toEqual({ kind: 'switch', ref: B })
    expect(entrySync({ sourceId: 't', inventoryId: 'a' }, A, [A], true)).toEqual({ kind: 'root' })
    expect(entrySync(null, null, [], true)).toEqual({ kind: 'none' })
  })

  it('only stamps entries of screens outside an inventory, never switches or replaces them', () => {
    expect(entrySync(C, B, [B], false)).toEqual({ kind: 'none' })
    expect(entrySync(null, A, [A, B], false)).toEqual({ kind: 'stamp' })
    expect(entrySync(B, A, [A, B], false)).toEqual({ kind: 'none' })
    expect(entrySync(A, A, [A, B], false)).toEqual({ kind: 'none' })
    expect(entrySync(A, null, [], false)).toEqual({ kind: 'none' })
    expect(entrySync(null, null, [], false)).toEqual({ kind: 'none' })
  })
})

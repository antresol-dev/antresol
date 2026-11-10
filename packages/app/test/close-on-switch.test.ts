import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useCloseOnSwitch } from '../app/composables/useCloseOnSwitch'
import type { InventoryRef } from '../app/lib/types'

const A: InventoryRef = { sourceId: 's1', inventoryId: 'a' }
const B: InventoryRef = { sourceId: 's1', inventoryId: 'b' }

let scope: EffectScope
afterEach(() => scope.stop())

function setup(initial: InventoryRef | null = A) {
  const current = ref<InventoryRef | null>(initial)
  const locked = ref(false)
  const close = vi.fn()
  scope = effectScope()
  scope.run(() => useCloseOnSwitch(() => current.value, close, () => locked.value))
  return { current, locked, close }
}

describe('useCloseOnSwitch', () => {
  it('closes when another inventory becomes current', async () => {
    const { current, close } = setup()
    current.value = B
    await nextTick()
    expect(close).toHaveBeenCalledTimes(1)
    current.value = null
    await nextTick()
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('ignores the same inventory set again as a new object', async () => {
    const { current, close } = setup()
    current.value = { ...A }
    await nextTick()
    expect(close).not.toHaveBeenCalled()
  })

  it('waits for a running write, then closes', async () => {
    const { current, locked, close } = setup()
    locked.value = true
    await nextTick()
    current.value = B
    await nextTick()
    expect(close).not.toHaveBeenCalled()
    locked.value = false
    await nextTick()
    expect(close).toHaveBeenCalledTimes(1)
    // Done: later writes don't close it again.
    locked.value = true
    await nextTick()
    locked.value = false
    await nextTick()
    expect(close).toHaveBeenCalledTimes(1)
  })
})

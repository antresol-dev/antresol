import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope, type Ref } from 'vue'
import { useCloseWatcher } from '../app/composables/useCloseWatcher'

class FakeCloseWatcher {
  onclose: (() => void) | null = null
  destroy = vi.fn()
  constructor() {
    watchers.push(this)
  }
}

let watchers: FakeCloseWatcher[]
let scope: EffectScope
let open: Ref<boolean>

beforeEach(() => {
  watchers = []
  vi.stubGlobal('CloseWatcher', FakeCloseWatcher)
  open = ref(false)
  scope = effectScope()
  scope.run(() => useCloseWatcher(open))
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('useCloseWatcher', () => {
  it('creates a watcher when opened and closes on the back gesture', async () => {
    await nextTick()
    expect(watchers).toHaveLength(0)

    open.value = true
    await nextTick()
    expect(watchers).toHaveLength(1)

    watchers[0]!.onclose!()
    expect(open.value).toBe(false)
    await nextTick()
    // Opening again needs a fresh watcher: a closed one is spent.
    open.value = true
    await nextTick()
    expect(watchers).toHaveLength(2)
  })

  it('destroys the watcher when closed from the UI and on scope dispose', async () => {
    open.value = true
    await nextTick()
    open.value = false
    await nextTick()
    expect(watchers).toHaveLength(1)
    expect(watchers[0]!.destroy).toHaveBeenCalledTimes(1)

    open.value = true
    await nextTick()
    expect(watchers).toHaveLength(2)
    scope.stop()
    expect(watchers[1]!.destroy).toHaveBeenCalledTimes(1)
    // A gesture on a destroyed watcher no longer reaches the state.
    open.value = true
    watchers[1]!.onclose?.()
    expect(open.value).toBe(true)
  })

  it('watches a layer that is already open when it mounts', async () => {
    const already = ref(true)
    const s = effectScope()
    s.run(() => useCloseWatcher(already))
    await nextTick()
    expect(watchers).toHaveLength(1)
    watchers[0]!.onclose!()
    expect(already.value).toBe(false)
    s.stop()
  })

  it('does nothing without CloseWatcher', async () => {
    vi.stubGlobal('CloseWatcher', undefined)
    const plain = ref(false)
    const s = effectScope()
    s.run(() => useCloseWatcher(plain))
    plain.value = true
    await expect(nextTick()).resolves.toBeUndefined()
    expect(plain.value).toBe(true)
    plain.value = false
    await nextTick()
    expect(() => s.stop()).not.toThrow()
    expect(watchers).toHaveLength(0)
  })
})

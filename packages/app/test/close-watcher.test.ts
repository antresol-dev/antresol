import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope, type Ref } from 'vue'
import { useCloseWatcher } from '../app/composables/useCloseWatcher'

class FakeCloseWatcher {
  onclose: (() => void) | null = null
  oncancel: ((event: { preventDefault(): void }) => void) | null = null
  destroyed = false
  /** The browser fired close: the watcher is spent, as after a real back gesture. */
  spent = false
  destroy = vi.fn(() => {
    this.destroyed = true
  })
  constructor() {
    watchers.push(this)
  }
  /** The back gesture or Esc. */
  requestClose(): void {
    this.spent = true
    this.onclose?.()
  }
}

const live = (): FakeCloseWatcher[] => watchers.filter((w) => !w.destroyed && !w.spent)

/** A layer with its own open state and scope, like a sheet or the drawer. */
function layer(initial = false): { open: Ref<boolean>; scope: EffectScope } {
  const open = ref(initial)
  const scope = effectScope()
  scope.run(() => useCloseWatcher(open))
  return { open, scope }
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

  it('does not close while locked, and watches again once the gesture has been refused', async () => {
    const locked = ref(true)
    const own = ref(false)
    const s = effectScope()
    s.run(() => useCloseWatcher(own, () => locked.value))
    own.value = true
    await nextTick()

    // Where the browser allows cancelling, the close is cancelled.
    const preventDefault = vi.fn()
    live()[0]!.oncancel!({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()

    // Where it does not, the layer stays open and a fresh watcher replaces the spent one.
    live()[0]!.requestClose()
    expect(own.value).toBe(true)
    expect(live()).toHaveLength(1)

    locked.value = false
    const free = vi.fn()
    live()[0]!.oncancel!({ preventDefault: free })
    expect(free).not.toHaveBeenCalled()
    live()[0]!.requestClose()
    expect(own.value).toBe(false)
    s.stop()
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

  describe('with layers on top of each other', () => {
    it('gives a live watcher only to the top layer', async () => {
      const drawer = layer()
      const sheet = layer()
      drawer.open.value = true
      await nextTick()
      expect(live()).toHaveLength(1)
      const drawerWatcher = live()[0]!

      sheet.open.value = true
      await nextTick()
      // One live watcher at a time: a second one made without user activation (a long press opens the sheet from a
      // timer) would join the drawer's group, and one back gesture would close both.
      expect(drawerWatcher.destroyed).toBe(true)
      expect(live()).toHaveLength(1)
      drawer.scope.stop()
      sheet.scope.stop()
    })

    it('closes only the top layer, then watches the one below again', async () => {
      const drawer = layer()
      const sheet = layer()
      drawer.open.value = true
      await nextTick()
      sheet.open.value = true
      await nextTick()

      live()[0]!.requestClose()
      expect(sheet.open.value).toBe(false)
      expect(drawer.open.value).toBe(true)
      await nextTick()

      expect(live()).toHaveLength(1)
      const fresh = live()[0]!
      fresh.requestClose()
      expect(drawer.open.value).toBe(false)
      await nextTick()
      expect(live()).toHaveLength(0)
      drawer.scope.stop()
      sheet.scope.stop()
    })

    it('watches the layer below again when the top one is closed from the UI', async () => {
      const drawer = layer()
      const sheet = layer()
      drawer.open.value = true
      await nextTick()
      sheet.open.value = true
      await nextTick()
      const sheetWatcher = live()[0]!

      sheet.open.value = false
      await nextTick()
      expect(sheetWatcher.destroyed).toBe(true)
      expect(live()).toHaveLength(1)
      live()[0]!.requestClose()
      expect(drawer.open.value).toBe(false)
      drawer.scope.stop()
      sheet.scope.stop()
    })

    it('stays consistent when a layer in the middle goes away', async () => {
      const bottom = layer()
      const middle = layer()
      const top = layer()
      for (const l of [bottom, middle, top]) {
        l.open.value = true
        await nextTick()
      }
      const topWatcher = live()[0]!
      const made = watchers.length

      // The middle layer unmounts: the top keeps its watcher, nobody else gets one.
      middle.scope.stop()
      expect(live()).toEqual([topWatcher])
      expect(watchers).toHaveLength(made)

      // A middle layer closed from the UI behaves the same.
      const second = layer()
      second.open.value = true
      await nextTick()
      const secondWatcher = live()[0]!
      expect(topWatcher.destroyed).toBe(true)
      top.open.value = false
      await nextTick()
      expect(live()).toEqual([secondWatcher])

      // Back closes the top, then the bottom gets a fresh watcher; the gone middle layer never does.
      secondWatcher.requestClose()
      await nextTick()
      expect(second.open.value).toBe(false)
      expect(live()).toHaveLength(1)
      live()[0]!.requestClose()
      expect(bottom.open.value).toBe(false)
      expect(middle.open.value).toBe(true)
      for (const l of [bottom, middle, top, second]) l.scope.stop()
    })
  })
})

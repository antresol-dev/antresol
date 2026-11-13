import { StorageError, type Intake } from '@antresol/core'
import { errorMessageKey } from '~/lib/errors'
import { withDeviceDrafts } from '~/lib/intake-list'

/** The current inventory's intakes for a screen: read on mount and again after every new snapshot (a write or a
 *  refresh) or when the source turns ready; the answer of the latest request only. `list`: with this device's drafts
 *  (withDeviceDrafts); `rows`: the database's alone. `failureKey`: why it could not be read. */
export function useIntakeList() {
  const { state } = useWorkspace()
  const intakes = useIntakes()

  const list = shallowRef<Intake[] | null>(null)
  const rows = shallowRef<Intake[] | null>(null)
  const failure = shallowRef<unknown>(null)
  let latest = 0

  const status = computed(() => {
    const cur = state.current
    return cur ? (state.sources.find((s) => s.config.id === cur.sourceId)?.status ?? null) : null
  })

  async function reload(): Promise<void> {
    const cur = state.current
    if (!cur) return
    const n = ++latest
    try {
      const read = await intakes.list()
      const copies = await intakes.drafts.peekAll()
      if (n !== latest) return
      rows.value = read
      list.value = withDeviceDrafts(read, copies, cur.inventoryId, state.deviceName)
      failure.value = null
    } catch (e) {
      if (n !== latest) return
      failure.value = e
    }
  }
  onScopeDispose(() => latest++)

  // The inventory changed: what was read belongs to the other one.
  watch(
    () => state.current?.inventoryId,
    () => {
      list.value = null
      rows.value = null
      failure.value = null
      void reload()
    },
    { immediate: true },
  )
  watch(() => state.snapshot, () => void reload())
  watch(status, (now) => {
    if (now === 'ready' || now === 'read_only') void reload()
  })

  const unavailable = computed(() => failure.value instanceof StorageError && failure.value.code === 'unavailable')
  // While the source is still connecting on startup a refusal is not an answer yet: keep the skeleton.
  const loading = computed(
    () => list.value === null && (failure.value === null || (unavailable.value && status.value === 'connecting')),
  )
  const failureKey = computed(() => {
    if (list.value !== null || failure.value === null || loading.value) return null
    return unavailable.value ? 'intakes.needsConnection' : errorMessageKey(failure.value)
  })

  return { list, rows, loading, failureKey, reload }
}

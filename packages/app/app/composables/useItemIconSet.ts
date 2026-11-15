import type { ItemIconSet } from '~/lib/item-icons'
import { loadItemIconSet } from '~/lib/item-icons'

const set = shallowRef<ItemIconSet | null>(null)

/** The icon components once the set chunk has loaded (null before, or if it failed): the first call starts the load. */
export function useItemIconSet(): Readonly<Ref<ItemIconSet | null>> {
  if (set.value === null) loadItemIconSet().then((s) => (set.value = s), () => {})
  return set
}

import { ref, watch, type Ref } from 'vue'
import { useCloseWatcher } from './useCloseWatcher'

/** The open state of a Select or Combobox root as a layer of its own: while the list is open, the back gesture closes the
 *  list and the sheet under it stays. Reka doesn't put these lists in a layer stack, so without this the gesture went to
 *  the sheet. A parent that passes `open` still controls it; every change, a close by the gesture too, goes out through
 *  `emit` (update:open). */
export function useListLayer(
  props: { open?: boolean; defaultOpen?: boolean },
  emit: (open: boolean) => void,
): Ref<boolean> {
  const open = ref(props.open ?? props.defaultOpen ?? false)
  watch(
    () => props.open,
    (value) => {
      if (value !== undefined) open.value = value
    },
  )
  watch(open, (value) => {
    if (value !== props.open) emit(value)
  })
  useCloseWatcher(open)
  return open
}

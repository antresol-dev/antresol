import { useWindowSize } from '@vueuse/core'
import { clampTreeWidth, loadTreeWidth, saveTreeWidth, TREE_WIDTH_DEFAULT, treeWidthMax } from '~/lib/tree-width'

// Shared by the layout (grid column) and the panel (the dragged edge).
const stored = ref<number | null>(null)
let loaded = false

export function useTreeWidth() {
  if (!loaded && import.meta.client) {
    loaded = true
    stored.value = loadTreeWidth()
  }
  const { width: windowWidth } = useWindowSize()
  /** The width in force: the saved one kept inside the limits of the current window. */
  const width = computed(() => clampTreeWidth(stored.value ?? TREE_WIDTH_DEFAULT, windowWidth.value || 1280))
  const max = computed(() => treeWidthMax(windowWidth.value || 1280))
  function set(next: number): void {
    stored.value = clampTreeWidth(next, windowWidth.value || 1280)
  }
  function save(): void {
    saveTreeWidth(stored.value)
  }
  function reset(): void {
    stored.value = null
    saveTreeWidth(null)
  }
  return { width, max, set, save, reset }
}

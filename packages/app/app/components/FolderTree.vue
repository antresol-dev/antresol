<script setup lang="ts">
import { treeCurrent } from '~/lib/shell'
import { loadTreeOpen, openPath, saveTreeOpen, toggleOpen, treeRows, type TreeOpen, type TreeRow } from '~/lib/tree-state'
import { inventoryPieces } from '~/lib/views'

defineProps<{ variant: 'panel' | 'drawer' }>()

const { state } = useWorkspace()
const route = useRoute()

const snapshot = computed(() => state.snapshot)
const inventoryId = computed(() => snapshot.value?.inventory.id ?? null)
const current = computed(() =>
  treeCurrent(snapshot.value, typeof route.name === 'string' ? route.name : null, route.params),
)

const open = shallowRef<TreeOpen>({})
let loadedFor: string | null = null

// Load the saved state when the inventory changes; on every move, open the path to the current row.
watch(
  [inventoryId, current],
  ([id, cur]) => {
    const s = snapshot.value
    if (!s || id === null) {
      loadedFor = null
      open.value = {}
      return
    }
    if (id !== loadedFor) {
      loadedFor = id
      open.value = loadTreeOpen(id)
    }
    const next = openPath(s, open.value, cur === 'root' ? null : cur)
    if (next !== open.value) {
      open.value = next
      saveTreeOpen(id, next)
    }
  },
  { immediate: true },
)

const rows = computed(() => (snapshot.value ? treeRows(snapshot.value, open.value, current.value) : []))
const root = computed<TreeRow | null>(() =>
  snapshot.value
    ? {
        id: snapshot.value.inventory.id,
        name: snapshot.value.inventory.name,
        pieces: inventoryPieces(snapshot.value),
        hasChildren: false,
        open: false,
        current: current.value === 'root',
        children: [],
      }
    : null,
)

function toggle(id: string): void {
  const inventory = inventoryId.value
  if (inventory === null) return
  open.value = toggleOpen(open.value, id)
  saveTreeOpen(inventory, open.value)
}
</script>

<template>
  <nav v-if="root" :aria-label="$t('folder.tree')">
    <ul class="flex flex-col gap-0.5">
      <FolderTreeNode :row="root" :variant="variant" root />
      <FolderTreeNode v-for="r in rows" :key="r.id" :row="r" :variant="variant" @toggle="toggle" />
    </ul>
  </nav>
</template>

<script setup lang="ts">
import { treeCurrent } from '~/lib/shell'
import { ChevronsDownUp, ChevronsUpDown, ListTree } from '@lucide/vue'
import { collapseAll, expandAll, loadTreeItems, loadTreeOpen, openPath, rootItemRows, saveTreeItems, saveTreeOpen, toggleOpen, treeRows, type TreeOpen, type TreeRow } from '~/lib/tree-state'
import { inventoryPieces } from '~/lib/views'

const props = defineProps<{ variant: 'panel' | 'drawer' }>()
const panel = computed(() => props.variant === 'panel')

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

// "Show items": the items under their folders, like files in an editor's tree; kept on this device.
const showItems = ref(loadTreeItems())
function toggleItems(): void {
  showItems.value = !showItems.value
  saveTreeItems(showItems.value)
}
const currentItem = computed(() => (route.name === 'item-id' && typeof route.params.id === 'string' ? route.params.id : null))
const itemsOption = computed(() => (showItems.value ? { currentItem: currentItem.value } : undefined))
const rows = computed(() => (snapshot.value ? treeRows(snapshot.value, open.value, current.value, itemsOption.value) : []))
const rootItems = computed(() => (snapshot.value && showItems.value ? rootItemRows(snapshot.value, currentItem.value) : []))
const root = computed<TreeRow | null>(() =>
  snapshot.value
    ? {
        id: snapshot.value.inventory.id,
        name: snapshot.value.inventory.name,
        pieces: inventoryPieces(snapshot.value),
        hasChildren: false,
        open: false,
        current: current.value === 'root',
        icon: null,
        children: [],
        items: [],
      }
    : null,
)

function toggle(id: string): void {
  const inventory = inventoryId.value
  if (inventory === null) return
  open.value = toggleOpen(open.value, id)
  saveTreeOpen(inventory, open.value)
}

function setAll(next: (s: NonNullable<typeof snapshot.value>) => TreeOpen): void {
  const inventory = inventoryId.value
  const s = snapshot.value
  if (inventory === null || !s) return
  open.value = next(s)
  saveTreeOpen(inventory, open.value)
}
const collapse = (): void => setAll(() => collapseAll())
const expand = (): void => setAll((s) => expandAll(s, showItems.value))
// Phone: 44 px touch zones; desktop: 32 px.
const buttonSize = computed(() => (panel.value ? 'size-8 rounded-chip' : 'size-11 rounded-field'))
</script>

<template>
  <!-- A section of its own: a thin line, the "Folders" header with collapse all / expand all, then the scrolling tree.
       The header sits outside the scroll area; `actions` is for extra buttons in it (the panel's "New folder"). -->
  <div v-if="root" class="flex min-h-0 flex-1 flex-col border-t border-divider">
    <div :class="['flex shrink-0 items-center justify-between gap-2', panel ? 'pt-1 pr-3 pb-1 pl-4' : 'pr-1.5 pl-3']">
      <h2 class="text-xs font-semibold tracking-[0.02em] text-muted-foreground uppercase">{{ $t('folder.tree') }}</h2>
      <div class="flex items-center">
        <slot name="actions" />
        <button
          type="button"
          :class="[buttonSize, 'pressable grid shrink-0 place-items-center aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-foreground']"
          :aria-pressed="showItems"
          :aria-label="$t('tree.showItems')"
          :title="$t('tree.showItems')"
          @click="toggleItems"
        >
          <ListTree class="size-4" aria-hidden="true" />
        </button>
        <button
          v-for="b in [
            { key: 'collapse', icon: ChevronsDownUp, run: collapse },
            { key: 'expand', icon: ChevronsUpDown, run: expand },
          ]"
          :key="b.key"
          type="button"
          :class="[buttonSize, 'pressable grid shrink-0 place-items-center']"
          :aria-label="$t(`tree.${b.key}All`)"
          :title="$t(`tree.${b.key}All`)"
          @click="b.run"
        >
          <component :is="b.icon" class="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div :class="['min-h-0 flex-1 overflow-y-auto', panel ? 'px-2 pt-0.5 pb-3' : 'p-1.5']">
      <nav :aria-label="$t('folder.tree')">
        <ul class="flex flex-col gap-0.5">
          <FolderTreeNode :row="root" :variant="variant" root />
          <FolderTreeNode v-for="r in rows" :key="r.id" :row="r" :variant="variant" @toggle="toggle" />
          <TreeItemNode v-for="item in rootItems" :key="`item:${item.id}`" :row="item" :variant="variant" />
        </ul>
      </nav>
    </div>
  </div>
</template>

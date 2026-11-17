<script setup lang="ts">
import { Package } from '@lucide/vue'
import { colorVars, itemColor } from '~/lib/item-colors'
import { iconFrom } from '~/lib/item-icons'
import type { TreeItemRow } from '~/lib/tree-state'

// An item in the tree ("Show items"): like a file in an editor's tree, its icon (own, else its folder's, else the
// general item icon) in the item's colour, then its name. The same height and padding as a folder row; a blank where the
// chevron would be, so names line up with the folders'. No row actions: the item's card has them.
const props = defineProps<{ row: TreeItemRow; variant: 'panel' | 'drawer' }>()
const iconSet = useItemIconSet()
const shown = computed(() => iconFrom(iconSet.value, props.row.icon) ?? iconFrom(iconSet.value, props.row.folderIcon) ?? Package)
const vars = computed(() => colorVars(itemColor({ id: props.row.id, color: props.row.color })))
const panel = computed(() => props.variant === 'panel')
const chevronSize = computed(() => (panel.value ? 'size-5' : 'size-11'))
</script>

<template>
  <li>
    <NuxtLink
      :to="`/item/${row.id}`"
      :aria-current="row.current ? 'page' : undefined"
      :class="[
        'relative flex items-center gap-1.5 rounded-field text-sm font-medium outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring',
        panel ? 'h-8 px-3' : 'min-h-11 pr-3',
        row.current ? 'row-selected' : 'text-icon hover:bg-(--ghost-hover) hover:text-foreground',
      ]"
    >
      <span :class="[chevronSize, 'shrink-0']" aria-hidden="true" />
      <component :is="shown" class="colored size-4 shrink-0 text-(--c)" :style="vars" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
    </NuxtLink>
  </li>
</template>

<script setup lang="ts">
import { Boxes, ChevronRight, Folder } from '@lucide/vue'
import type { TreeRow } from '~/lib/tree-state'

const props = defineProps<{
  row: TreeRow
  variant: 'panel' | 'drawer'
  /** The inventory root: Boxes icon, links to `/`, never has a chevron. */
  root?: boolean
}>()
const emit = defineEmits<{ toggle: [id: string] }>()

const panel = computed(() => props.variant === 'panel')
const to = computed(() => (props.root ? '/' : `/folder/${props.row.id}`))
// Drawer rows are touch targets: 44 px tall with a 44 px chevron; the guide line runs under the parent's chevron.
const chevronSize = computed(() => (panel.value ? 'size-[18px]' : 'size-11'))
</script>

<template>
  <li class="flex flex-col gap-0.5">
    <div
      :class="[
        'relative flex items-center gap-1.5 rounded-icon pr-2 text-sm font-semibold transition-colors duration-150',
        panel ? 'h-8 pl-1' : 'min-h-11',
        row.current ? 'bg-accent-soft text-accent-soft-foreground' : 'text-icon hover:bg-hover hover:text-foreground',
      ]"
    >
      <button
        v-if="row.hasChildren"
        type="button"
        :class="[
          chevronSize,
          'relative z-10 grid shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-chip hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        ]"
        :aria-expanded="row.open"
        :aria-label="$t(row.open ? 'tree.collapse' : 'tree.expand', { name: row.name })"
        @click="emit('toggle', row.id)"
      >
        <ChevronRight
          :class="['size-3.5 motion-safe:transition-transform motion-safe:duration-150', row.open ? 'rotate-90' : '']"
          aria-hidden="true"
        />
      </button>
      <span v-else :class="[chevronSize, 'shrink-0']" aria-hidden="true" />
      <!-- The link stretches over the whole row (after:inset-0); the chevron sits above it. -->
      <NuxtLink
        :to="to"
        :aria-current="row.current ? 'page' : undefined"
        class="flex min-w-0 flex-1 items-center gap-1.5 self-stretch outline-none after:absolute after:inset-0 after:rounded-icon focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        <Boxes v-if="root" class="size-4 shrink-0" aria-hidden="true" />
        <Folder v-else :class="['size-4 shrink-0', row.current ? '' : 'text-primary']" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
      </NuxtLink>
      <span
        :class="['shrink-0 text-xs font-bold tabular-nums', row.current ? 'text-accent-soft-foreground' : 'text-subtle-foreground']"
      >
        {{ row.itemCount }}
      </span>
    </div>
    <ul
      v-if="row.open"
      :class="['flex flex-col gap-0.5 border-l border-tree-line pl-1', panel ? 'ml-3' : 'ml-[21px]']"
    >
      <FolderTreeNode
        v-for="child in row.children"
        :key="child.id"
        :row="child"
        :variant="variant"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
</template>

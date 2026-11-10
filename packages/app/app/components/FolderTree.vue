<script setup lang="ts">
import { folderTree, type TreeNode } from '~/lib/views'

const { state } = useWorkspace()
const route = useRoute()

const rootName = computed(() => state.snapshot?.inventory.name ?? '')
const currentId = computed(() => (route.name === 'folder-id' ? String(route.params.id) : null))

interface Row {
  id: string
  name: string
  depth: number
}
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const n of nodes) {
      out.push({ id: n.id, name: n.name, depth })
      walk(n.children, depth + 1)
    }
  }
  if (state.snapshot) walk(folderTree(state.snapshot), 1)
  return out
})

const link = 'flex min-h-11 items-center rounded-field pr-3 text-sm font-semibold'
const active = 'bg-accent-soft text-accent-soft-foreground'
</script>

<template>
  <nav v-if="state.snapshot" :aria-label="$t('folder.tree')" class="grid grid-cols-1 gap-0.5 p-3">
    <NuxtLink
      to="/"
      :class="[link, 'pl-3 font-bold', currentId === null && route.name === 'index' ? active : 'text-icon']"
      :aria-current="currentId === null && route.name === 'index' ? 'page' : undefined"
    >
      <span class="truncate">{{ rootName }}</span>
    </NuxtLink>
    <NuxtLink
      v-for="r in rows"
      :key="r.id"
      :to="`/folder/${r.id}`"
      :class="[link, r.id === currentId ? active : 'text-icon']"
      :style="{ paddingLeft: `${12 + r.depth * 16}px` }"
      :aria-current="r.id === currentId ? 'page' : undefined"
    >
      <span class="truncate">{{ r.name }}</span>
    </NuxtLink>
  </nav>
</template>

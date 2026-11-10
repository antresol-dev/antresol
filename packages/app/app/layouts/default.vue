<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { showsTree } from '~/lib/shell'

const route = useRoute()
// Below 1024 px one column and the page scrolls; from 1024 px three full-height columns, each scrolling on its own.
const desktop = useMediaQuery('(min-width: 1024px)')
const withTree = computed(() => showsTree(typeof route.name === 'string' ? route.name : null))
</script>

<template>
  <div
    :class="[
      'min-h-dvh bg-background text-foreground lg:grid lg:h-dvh lg:overflow-hidden',
      withTree ? 'lg:grid-cols-[212px_264px_minmax(0,1fr)]' : 'lg:grid-cols-[212px_minmax(0,1fr)]',
    ]"
  >
    <div v-if="desktop" class="min-h-0 overflow-y-auto bg-rail">
      <AppNav variant="rail" />
    </div>
    <TreePanel v-if="desktop && withTree" />
    <div class="min-w-0 lg:min-h-0 lg:overflow-y-auto">
      <slot />
    </div>
    <NavDrawer />
  </div>
</template>

<!-- eslint-disable vue/multi-word-component-names -- name fixed by the task brief -->
<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import { collapseCrumbs, type Crumb } from '~/lib/views'

const props = defineProps<{ rootName: string; crumbs: Crumb[] }>()

const shown = computed(() => collapseCrumbs(props.crumbs))
const last = computed(() => props.crumbs.at(-1))
</script>

<template>
  <nav :aria-label="$t('folder.path')" class="flex min-w-0 items-center gap-1 text-[13px] font-semibold text-subtle-foreground">
    <NuxtLink to="/" class="flex min-h-11 min-w-0 shrink items-center">
      <span class="truncate rounded-full bg-chip px-2.5 py-[5px]">{{ rootName }}</span>
    </NuxtLink>
    <template v-for="c in shown" :key="c === 'ellipsis' ? 'ellipsis' : (c.id ?? 'root')">
      <ChevronRight class="size-3.5 shrink-0" aria-hidden="true" />
      <span v-if="c === 'ellipsis'" class="px-1">{{ $t('folder.ellipsis') }}</span>
      <span v-else-if="c.id === last?.id" aria-current="page" class="min-w-0 truncate px-2.5 py-[5px] font-bold text-foreground">
        {{ c.name }}
      </span>
      <NuxtLink v-else :to="`/folder/${c.id}`" class="flex min-h-11 min-w-0 shrink items-center">
        <span class="truncate rounded-full bg-chip px-2.5 py-[5px]">{{ c.name }}</span>
      </NuxtLink>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { Folder } from '@lucide/vue'
import type { FolderRow } from '~/lib/views'

defineProps<{ folders: FolderRow[] }>()
</script>

<template>
  <ul class="rounded-card border border-border bg-surface py-1">
    <li
      v-for="f in folders"
      :key="f.id"
      class="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-[58px] not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
    >
      <NuxtLink :to="`/folder/${f.id}`" class="flex h-[50px] items-center gap-3 px-3.5">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-icon bg-accent-soft text-accent-soft-foreground">
          <Folder class="size-[17px]" aria-hidden="true" />
        </span>
        <span class="min-w-0 grow truncate text-[15px] font-semibold">{{ f.name }}</span>
        <span class="shrink-0 text-[13px] font-semibold text-muted-foreground">{{ f.itemCount }}</span>
      </NuxtLink>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { SearchRow } from '~/lib/views'

defineProps<{ rows: SearchRow[]; query: string }>()
</script>

<template>
  <EmptyState v-if="rows.length === 0" :text="$t('search.nothing', { q: query })" />
  <ul v-else class="overflow-hidden rounded-card border border-border bg-surface py-1">
    <li
      v-for="row in rows"
      :key="`${row.itemId}:${row.variantId ?? ''}`"
      class="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
    >
      <NuxtLink
        :to="{ path: `/item/${row.itemId}`, query: row.variantId ? { variant: row.variantId } : {} }"
        class="flex min-h-[62px] items-center gap-3 px-3.5 py-2 outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[15px] font-bold" :class="row.outOfStock && 'text-dimmed-foreground'">
            {{ row.name }}
            <span v-if="row.variantName" class="font-semibold text-muted-foreground">· {{ row.variantName }}</span>
          </span>
          <span v-if="row.path" class="truncate text-[13px] text-muted-foreground">{{ row.path }}</span>
        </span>
        <span class="shrink-0 text-base font-bold tabular-nums" :class="row.outOfStock && 'text-muted-foreground'">
          {{ row.number }}
          <span class="text-xs font-semibold text-muted-foreground">{{ row.unit }}</span>
        </span>
      </NuxtLink>
    </li>
  </ul>
</template>

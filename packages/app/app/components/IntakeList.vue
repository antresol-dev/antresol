<script setup lang="ts">
import { PackageOpen, Pencil } from '@lucide/vue'
import type { IntakeRow } from '~/lib/intake-list'

defineProps<{ rows: IntakeRow[] }>()
</script>

<template>
  <!-- A flat list on the page: rows divided by lines, a row tinted under the pointer. -->
  <ul class="surface-list">
    <li
      v-for="row in rows"
      :key="row.id"
      class="relative rounded-field transition-colors duration-(--dur-fast) hover:bg-hover not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-15 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
    >
      <NuxtLink :to="`/intakes/${row.id}`" class="flex min-h-14 min-w-0 items-center gap-3 rounded-field px-3 py-1.5">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-thumb bg-thumb text-thumb-foreground">
          <component :is="row.status === 'draft' ? Pencil : PackageOpen" class="size-5" aria-hidden="true" />
        </span>
        <span class="flex min-w-0 grow flex-col gap-0.5">
          <span class="flex min-w-0 items-center gap-1.5">
            <span class="min-w-0 truncate text-base font-semibold">{{ row.title }}</span>
            <span
              v-if="row.status === 'draft'"
              class="shrink-0 rounded-chip bg-chip px-1.5 py-px text-xs font-semibold text-subtle-foreground"
            >{{ $t('intakes.draft') }}</span>
          </span>
          <span class="truncate text-sm text-muted-foreground">
            {{ $t('intakes.lines', row.lineCount) }} · {{ row.date }}<template v-if="row.by"> · {{ row.by }}</template>
          </span>
        </span>
      </NuxtLink>
    </li>
  </ul>
</template>

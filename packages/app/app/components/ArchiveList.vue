<script setup lang="ts">
import { Boxes, Folder, Layers, Package, Trash2 } from '@lucide/vue'
import type { Component } from 'vue'
import { Button } from '@/components/ui/button'

export interface ArchiveRow {
  key: string
  kind: 'folder' | 'item' | 'variant' | 'inventory'
  name: string
  sub: string
  /** Buttons off: the source can't be written to right now. */
  locked: boolean
  /** A write for this row is running. */
  busy: boolean
}

defineProps<{ rows: ArchiveRow[] }>()
defineEmits<{ restore: [key: string]; remove: [key: string] }>()

const icons: Record<ArchiveRow['kind'], Component> = { folder: Folder, item: Package, variant: Layers, inventory: Boxes }
</script>

<template>
  <ul class="surface-list">
    <li
      v-for="row in rows"
      :key="row.key"
      class="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-15 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
    >
      <div class="flex min-h-14 items-center gap-3 px-3 py-1.5">
        <span
          :class="[
            'flex shrink-0 items-center justify-center',
            row.kind === 'folder'
              ? 'size-8 rounded-icon bg-accent-soft text-accent-soft-foreground'
              : 'size-8 rounded-thumb bg-thumb text-thumb-foreground',
          ]"
        >
          <component :is="icons[row.kind]" class="size-5" aria-hidden="true" />
        </span>
        <span class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-base font-semibold">{{ row.name }}</span>
          <span class="truncate text-sm text-muted-foreground">{{ row.sub }}</span>
        </span>
        <Button
          variant="outline"
          class="h-11 shrink-0"
          :disabled="row.locked || row.busy"
          @click="$emit('restore', row.key)"
        >
          {{ $t(row.busy ? 'status.saving' : 'archive.restore') }}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="size-11 shrink-0 text-icon hover:text-destructive"
          :aria-label="$t('archive.delete')"
          :disabled="row.locked || row.busy"
          @click="$emit('remove', row.key)"
        >
          <Trash2 class="size-5" aria-hidden="true" />
        </Button>
      </div>
    </li>
  </ul>
</template>

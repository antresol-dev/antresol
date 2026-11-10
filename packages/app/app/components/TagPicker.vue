<script setup lang="ts">
import type { Id, InventorySnapshot } from '@graymatter/core'
import { Plus } from '@lucide/vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { tagMatches } from '~/lib/tags'

// A filter field over the inventory's tags as checkboxes. A tag typed in the field that doesn't exist yet can be created
// on the spot (the parent writes it) and comes back checked.
const props = defineProps<{ snapshot: InventorySnapshot; busy?: boolean; locked?: boolean }>()
const selected = defineModel<Id[]>({ required: true })
const emit = defineEmits<{ create: [name: string] }>()

const query = ref('')
const matches = computed(() => tagMatches(props.snapshot, query.value))

function toggle(id: Id, on: boolean): void {
  selected.value = on ? [...selected.value.filter((x) => x !== id), id] : selected.value.filter((x) => x !== id)
}

function create(): void {
  emit('create', query.value.trim())
  query.value = ''
}
</script>

<template>
  <div class="grid gap-2">
    <Input v-model="query" :aria-label="$t('itemForm.filterTags')" :placeholder="$t('itemForm.filterTags')" autocomplete="off" class="h-11 rounded-field bg-surface" @keydown.enter.prevent="matches.canCreate && !locked && create()" />
    <ul class="grid max-h-[28dvh] grid-cols-1 gap-0.5 overflow-x-hidden overflow-y-auto rounded-field border border-border bg-background p-1">
      <li v-for="tag in matches.tags" :key="tag.id" class="min-w-0">
        <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm transition-colors duration-150 hover:bg-hover has-focus-visible:ring-2 has-focus-visible:ring-ring">
          <Checkbox :model-value="selected.includes(tag.id)" @update:model-value="toggle(tag.id, $event === true)" />
          <span class="min-w-0 flex-1 truncate">{{ tag.name }}</span>
        </label>
      </li>
      <li v-if="matches.tags.length === 0 && !matches.canCreate" class="px-2 py-3 text-sm text-subtle-foreground">
        {{ $t('itemForm.noTags') }}
      </li>
      <li v-if="matches.canCreate" class="min-w-0">
        <button
          type="button"
          :disabled="locked"
          class="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm font-semibold outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          @click="create"
        >
          <Plus class="size-4 shrink-0 text-icon" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ $t('itemForm.createTag', { name: query.trim() }) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

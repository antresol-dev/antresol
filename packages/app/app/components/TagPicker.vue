<script setup lang="ts">
import type { Id, InventorySnapshot } from '@antresol/core'
import { Plus } from '@lucide/vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { colorVars } from '~/lib/item-colors'
import { draftTagAliases, tagPicked, togglePicked } from '~/lib/draft-tags'
import { tagMatches } from '~/lib/tags'

// A filter field over the inventory's tags as checkboxes. A tag typed in the field that doesn't exist yet can be created
// on the spot (the parent writes it) and comes back checked.
const props = defineProps<{
  snapshot: InventorySnapshot
  busy?: boolean
  locked?: boolean
  /** Tags that are not in the snapshot yet (a draft's new tags): shown and searched like the others. */
  extraTags?: { id: Id; name: string; color?: string | null }[]
}>()
const selected = defineModel<Id[]>({ required: true })
const emit = defineEmits<{ create: [name: string] }>()

const query = ref('')
// A draft tag with the name of a real tag is that tag: the real one shows it checked and unticking drops both ids.
const aliases = computed(() => draftTagAliases(props.snapshot.tags, props.extraTags ?? []))
const matches = computed(() => {
  const base = tagMatches(props.snapshot, query.value)
  // A draft tag named like a tag that is now in the snapshot (created meanwhile) is the same tag: shown once.
  const known = new Set(props.snapshot.tags.map((t) => t.name.trim().toLowerCase()))
  const extra = (props.extraTags ?? []).filter((t) => !known.has(t.name.trim().toLowerCase()))
  if (extra.length === 0) return base
  const q = query.value.trim().toLowerCase()
  const own = extra.filter((t) => t.name.toLowerCase().includes(q)).map((t) => ({ ...t, color: t.color ?? null }))
  return {
    tags: [...base.tags, ...own].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    canCreate: base.canCreate && !extra.some((t) => t.name.toLowerCase() === q),
  }
})

function toggle(id: Id, on: boolean): void {
  selected.value = togglePicked(selected.value, id, on, aliases.value)
}

function create(): void {
  emit('create', query.value.trim())
  query.value = ''
}
</script>

<template>
  <div class="grid gap-2">
    <Input v-model="query" :aria-label="$t('itemForm.filterTags')" :placeholder="$t('itemForm.filterTags')" autocomplete="off" class="h-11" @keydown.enter.prevent="matches.canCreate && !locked && create()" />
    <ul class="grid max-h-[28dvh] grid-cols-1 gap-0.5 overflow-x-hidden overflow-y-auto rounded-field border border-input bg-field p-1">
      <li v-for="tag in matches.tags" :key="tag.id" class="min-w-0">
        <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-chip px-3 text-sm transition-colors duration-(--dur-fast) hover:bg-hover has-focus-visible:ring-2 has-focus-visible:ring-ring">
          <Checkbox :model-value="tagPicked(selected, tag.id, aliases)" @update:model-value="toggle(tag.id, $event === true)" />
          <span v-if="tag.color" class="colored size-2 shrink-0 rounded-full bg-(--c)" :style="colorVars(tag.color)" aria-hidden="true" />
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
          class="flex min-h-11 w-full items-center gap-2 rounded-chip px-3 text-left text-sm font-semibold outline-none transition-colors duration-(--dur-fast) hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          @click="create"
        >
          <Plus class="size-4 shrink-0 text-icon" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ $t('itemForm.createTag', { name: query.trim() }) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

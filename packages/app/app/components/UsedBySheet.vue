<script setup lang="ts">
import { type UsageTarget, usedBy, usedByArchivedCount } from '~/lib/views'

// The items that use a tag, an attribute or a unit: a tap on a row opens the item. `target` is kept by the parent while
// the sheet animates out; `name` is what the sheet is about (the summary line).
const props = defineProps<{ target: (UsageTarget & { name: string }) | null }>()
const open = defineModel<boolean>('open', { required: true })

const router = useRouter()
const { state } = useWorkspace()
const rows = computed(() => (props.target && state.snapshot ? usedBy(state.snapshot, props.target) : []))
const archived = computed(() => (props.target && state.snapshot ? usedByArchivedCount(state.snapshot, props.target) : 0))

function go(id: string): void {
  open.value = false
  void router.push(`/item/${id}`)
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('dictionaries.usedByTitle', rows.length)" :summary="target?.name">
    <p v-if="rows.length === 0" class="text-sm text-muted-foreground">{{ $t('dictionaries.usedByEmpty') }}</p>
    <ul v-else class="surface-list">
      <li
        v-for="row in rows"
        :key="row.id"
        class="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <button type="button" class="flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-1.5 text-left" @click="go(row.id)">
          <ItemThumb :id="row.id" :folder-name="row.folderName" :cover="row.cover" class="size-9 rounded-thumb text-xs" />
          <span class="flex min-w-0 grow flex-col gap-0.5">
            <span class="truncate text-base font-semibold">{{ row.name }}</span>
            <span v-if="row.path" class="truncate text-sm text-muted-foreground">{{ row.path }}</span>
          </span>
        </button>
      </li>
    </ul>
    <p v-if="archived > 0" class="pt-2 text-sm text-muted-foreground">{{ $t('dictionaries.usedByArchived', archived) }}</p>
  </AppSheet>
</template>

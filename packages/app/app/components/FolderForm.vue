<script setup lang="ts">
import type { Folder, Id } from '@graymatter/core'
import { ChevronDown } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { errorMessageKey } from '~/lib/errors'
import { folderChoices, pathOf, snapshotIndex } from '~/lib/views'

const props = defineProps<{ mode: 'create' | 'rename'; parentId: Id | null; folder: Folder | null }>()
const emit = defineEmits<{ done: [] }>()

const workspace = useWorkspace()
const { ids } = useCommandIds(['folderId'])
const { state } = workspace

const existing = props.mode === 'rename' ? props.folder : null
const name = ref(existing?.name ?? '')
const description = ref(existing?.description ?? '')
// New folder: where it goes, the current folder to begin with (or the root). The same list-picker as in "Add item".
const parentId = ref<Id | null>(props.parentId)
const picking = ref(false)
const choices = computed(() => (state.snapshot ? folderChoices(state.snapshot, parentId.value) : []))
// "Electronics / ICs": the inventory, then the folders down to the chosen one.
const parentPath = computed(() => {
  const s = state.snapshot
  if (!s) return ''
  const folders = parentId.value === null ? [] : pathOf(snapshotIndex(s), parentId.value)
  return [s.inventory.name, ...folders.map((f) => f.name)].join(' / ')
})
function pick(id: Id | null): void {
  parentId.value = id
  picking.value = false
}
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)

// Rename sends only what differs from the folder as it was opened: a stale form must not revert another device's edit.
const baseline = captureBaseline({ name: existing?.name ?? '', description: existing?.description ?? null })
const changes = computed(() =>
  changedFields(
    baseline,
    { name: name.value.trim(), description: description.value.trim() || null },
  ),
)
const canSubmit = computed(
  () =>
    !busy.value &&
    !state.readOnly &&
    !!state.snapshot &&
    (props.mode === 'create' || (!!existing && Object.keys(changes.value).length > 0)),
)

async function submit(): Promise<void> {
  const snapshot = state.snapshot
  if (!canSubmit.value || !snapshot) return
  busy.value = true
  errorKey.value = null
  try {
    if (props.mode === 'create') {
      await workspace.apply({
        type: 'folder.create',
        id: ids.folderId,
        inventoryId: snapshot.inventory.id,
        parentId: parentId.value,
        name: name.value.trim(),
        description: description.value.trim() || null,
      })
    } else if (existing) {
      await workspace.apply({
        type: 'folder.update',
        id: existing.id,
        ...changes.value,
      })
    }
    emit('done')
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="grid gap-3.5" novalidate @submit.prevent="submit">
    <div class="grid gap-1.5">
      <Label for="folder-name">{{ $t('form.name') }}</Label>
      <Input
        id="folder-name"
        v-model="name"
        autocomplete="off"
        :aria-invalid="errorKey ? true : undefined"
        aria-describedby="folder-form-error"
        class="h-11"
      />
    </div>
    <div v-if="mode === 'create'" class="grid gap-1.5">
      <Label for="folder-parent">{{ $t('folderForm.parent') }}</Label>
      <button
        id="folder-parent"
        type="button"
        :aria-expanded="picking"
        class="flex h-11 w-full min-w-0 items-center gap-2 rounded-field border border-input bg-field px-3 text-left text-sm transition-colors duration-150 hover:bg-hover"
        @click="picking = !picking"
      >
        <span class="min-w-0 flex-1 truncate">{{ parentPath }}</span>
        <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-150 motion-reduce:transition-none" :class="picking ? 'rotate-180' : ''" aria-hidden="true" />
      </button>
      <FolderPickerList v-if="picking" :choices="choices" :aria-label="$t('folderForm.chooseParent')" @select="pick" />
    </div>
    <div class="grid gap-1.5">
      <Label for="folder-description">
        {{ $t('form.description') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <Input id="folder-description" v-model="description" autocomplete="off" class="h-11" />
    </div>
    <p id="folder-form-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : mode === 'create' ? 'folderForm.create' : 'folderForm.save') }}
    </Button>
  </form>
</template>

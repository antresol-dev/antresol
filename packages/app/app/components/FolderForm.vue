<script setup lang="ts">
import type { Folder, Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { errorMessageKey } from '~/lib/errors'

const props = defineProps<{ mode: 'create' | 'rename'; parentId: Id | null; folder: Folder | null }>()
const emit = defineEmits<{ done: [] }>()

const workspace = useWorkspace()
const { ids } = useCommandIds(['folderId'])
const { state } = workspace

const existing = props.mode === 'rename' ? props.folder : null
const name = ref(existing?.name ?? '')
const description = ref(existing?.description ?? '')
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
        parentId: props.parentId,
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
        class="h-11 rounded-field bg-surface"
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="folder-description">
        {{ $t('form.description') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <Input id="folder-description" v-model="description" autocomplete="off" class="h-11 rounded-field bg-surface" />
    </div>
    <p id="folder-form-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : mode === 'create' ? 'folderForm.create' : 'folderForm.save') }}
    </Button>
  </form>
</template>

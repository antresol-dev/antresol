<script setup lang="ts">
import { newId, type Id, type IntakeDraftContent, type InventorySnapshot } from '@antresol/core'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { folderChoicesWithDraft } from '~/lib/intake-entities'
import { nameClash, useExisting, withNewFolder, withoutNewFolder } from '~/lib/intake-draft'

// A draft folder of an intake (spec 2026-11-16 §4): its name and where it goes (the inventory's folders and this draft's
// own). Opened empty it makes a new one ("New folder" in the screen header); opened on a draft folder it renames, moves
// or removes it. A name the parent already has is not saved: "Use existing" takes the existing folder instead.
const props = defineProps<{
  /** The draft folder to edit; null: a new one. */
  folderId: Id | null
  /** Where a new folder starts (the parent). */
  startParentId?: Id | null
  content: IntakeDraftContent
  snapshot: InventorySnapshot
  readOnly: boolean
  edit: (change: (c: IntakeDraftContent) => IntakeDraftContent) => Promise<boolean>
}>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()

const name = ref('')
const parentId = ref<Id | null>(null)
const busy = ref(false)
const errorKey = ref<{ key: string; params?: Record<string, string> } | null>(null)
let formId: Id = newId()

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    const f = props.folderId ? (props.content.newFolders ?? []).find((x) => x.id === props.folderId) : null
    formId = f?.id ?? newId()
    name.value = f?.name ?? ''
    parentId.value = f ? f.parentId : (props.startParentId ?? null)
    errorKey.value = null
  },
  { immediate: true },
)

const editing = computed(() => !!props.folderId)
const choices = computed(() =>
  folderChoicesWithDraft(props.snapshot, props.content, parentId.value, editing.value ? formId : undefined).map((c) => ({
    ...c,
    name: c.draft ? t('intakes.folder.newSuffix', { name: c.name }) : c.name,
  })),
)
const clash = computed(() => (name.value.trim() === '' ? null : nameClash(props.snapshot, props.content, { kind: 'folder', name: name.value, parentId: parentId.value }, formId)))
const existingName = computed(() => {
  const c = clash.value
  return c ? (props.snapshot.folders.find((f) => f.id === c.id)?.name ?? (props.content.newFolders ?? []).find((f) => f.id === c.id)?.name ?? name.value.trim()) : ''
})
const disabled = computed(() => busy.value || props.readOnly)
const canSave = computed(() => !disabled.value && name.value.trim() !== '' && !clash.value)

async function save(): Promise<void> {
  if (!canSave.value) return
  const folder = { id: formId, name: name.value, parentId: parentId.value }
  const next = withNewFolder(props.content, props.snapshot, folder)
  if ('errorKey' in next) {
    errorKey.value = { key: next.errorKey, params: next.params }
    return
  }
  busy.value = true
  try {
    const ok = await props.edit((c) => {
      const r = withNewFolder(c, props.snapshot, folder)
      return 'errorKey' in r ? c : r
    })
    if (ok) open.value = false
  } finally {
    busy.value = false
  }
}

/** The existing folder takes the place of the draft one (its subfolders and items go to it); for a new folder: nothing is made. */
async function useTheExisting(): Promise<void> {
  const c = clash.value
  if (!c || c.draft || disabled.value) return
  if (!editing.value) {
    toast(t('intakes.usingExisting', { name: existingName.value }))
    open.value = false
    return
  }
  busy.value = true
  try {
    const name = existingName.value
    if (await props.edit((x) => useExisting(x, formId, c.id))) {
      toast(t('intakes.usingExisting', { name }))
      open.value = false
    }
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  if (!editing.value || disabled.value) return
  const result = withoutNewFolder(props.content, formId)
  if ('errorKey' in result) {
    errorKey.value = { key: result.errorKey, params: result.params }
    return
  }
  busy.value = true
  try {
    const ok = await props.edit((c) => {
      const r = withoutNewFolder(c, formId)
      return 'errorKey' in r ? c : r
    })
    if (ok) open.value = false
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t(editing ? 'intakes.folder.editTitle' : 'intakes.folder.newTitle')" :locked="busy" initial-focus="#intake-folder-name">
    <form id="intake-folder-form" class="mt-4 grid gap-4" novalidate @submit.prevent="save">
      <div class="grid gap-2">
        <Label for="intake-folder-name">{{ $t('form.name') }}</Label>
        <Input id="intake-folder-name" v-model="name" autocomplete="off" class="h-11" :aria-invalid="clash ? true : undefined" :aria-describedby="clash ? 'intake-folder-clash' : undefined" @input="errorKey = null" />
        <p v-if="clash" id="intake-folder-clash" class="text-sm">
          {{ $t('intakes.folder.exists', { name: existingName }) }}
          <button
            v-if="!clash.draft"
            type="button"
            class="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :disabled="disabled"
            @click="useTheExisting"
          >
            {{ $t('intakes.useExisting', { name: existingName }) }}
          </button>
        </p>
      </div>
      <div class="grid gap-2">
        <Label>{{ $t('intakes.folder.parent') }}</Label>
        <FolderPickerList :choices="choices" @select="parentId = $event; errorKey = null" />
      </div>
      <p role="alert" class="text-sm text-destructive">
        <template v-if="errorKey">{{ $t(errorKey.key, errorKey.params ?? {}) }}</template>
      </p>
    </form>
    <template #footer>
      <Button type="submit" form="intake-folder-form" data-primary class="h-11 rounded-field" :disabled="!canSave">
        {{ $t(busy ? 'status.saving' : editing ? 'intakes.folder.save' : 'intakes.folder.add') }}
      </Button>
      <Button v-if="editing" type="button" variant="outline" class="h-11 text-destructive" :disabled="disabled" @click="remove">
        {{ $t('intakes.folder.remove') }}
      </Button>
      <Button type="button" variant="outline" class="h-11" :disabled="busy" @click="open = false">
        {{ $t('ui.cancel') }}
      </Button>
    </template>
  </AppSheet>
</template>

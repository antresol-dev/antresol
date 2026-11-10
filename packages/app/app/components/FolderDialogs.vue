<script setup lang="ts">
import { newId, type Folder } from '@graymatter/core'
import { toast } from 'vue-sonner'
import type { FolderDialog } from '~/composables/useDialogs'
import { errorMessageKey } from '~/lib/errors'
import { showsInside } from '~/lib/shell'
import { folderView } from '~/lib/views'

// The folder sheets for the whole app: header buttons, row menus and the tree open them through useFolderDialog().
const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace
const route = useRoute()
const router = useRouter()
const { dialog, close } = useFolderDialog()

// What the sheets show: the last dialog and its folder as they were when it opened. Both stay after closing, so a
// sheet keeps its title and text while it animates out, and after an archive, when the new snapshot no longer has
// the folder.
const shown = shallowRef<FolderDialog | null>(null)
const folder = shallowRef<Folder | null>(null)
watch(
  dialog,
  (d) => {
    if (!d) return
    shown.value = d
    if (d.kind === 'create') {
      folder.value = null
      return
    }
    const s = state.snapshot
    folder.value = (s && folderView(s, d.folderId)?.folder) ?? null
    // Gone meanwhile (archived on another device): nothing to act on.
    if (!folder.value) close()
  },
  { immediate: true },
)

const openWhen = (kinds: FolderDialog['kind'][]) =>
  computed({
    get: () => !!dialog.value && kinds.includes(dialog.value.kind),
    set: (open: boolean) => {
      if (!open) close()
    },
  })
const formOpen = openWhen(['create', 'rename'])
const moveOpen = openWhen(['move'])
const archiveOpen = openWhen(['archive'])

const renaming = computed(() => shown.value?.kind === 'rename')
const parentId = computed(() => (shown.value?.kind === 'create' ? shown.value.parentId : null))
// A fresh form for every target: FolderForm reads its initial values once.
const formKey = computed(() => {
  const d = shown.value
  if (!d) return ''
  return d.kind === 'create' ? `create:${d.parentId ?? ''}` : `${d.kind}:${d.folderId}`
})

const formBusy = ref(false)
const archiving = ref(false)

async function archive(): Promise<void> {
  const target = folder.value
  if (!target || archiving.value) return
  // Decided on the snapshot before the archive: afterwards the folder and its subtree are gone from it.
  const leave = showsInside(state.snapshot, typeof route.name === 'string' ? route.name : null, route.params, target.id)
  archiving.value = true
  let archived = false
  try {
    await workspace.apply({ type: 'archive', target: 'folder', id: target.id, archiveId: newId() })
    archived = true
    close()
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    archiving.value = false
  }
  // The open screen showed the folder, something inside it or an item in it: go to its parent.
  if (archived && leave) await router.push(target.parentId === null ? '/' : `/folder/${target.parentId}`)
}
</script>

<template>
  <AppSheet
    v-model:open="formOpen"
    :title="$t(renaming ? 'folderMenu.renameTitle' : 'folderMenu.new')"
    :locked="formBusy"
    initial-focus="#folder-name"
  >
    <FolderForm
      v-if="shown?.kind === 'create' || (shown?.kind === 'rename' && folder)"
      :key="formKey"
      v-model:busy="formBusy"
      :mode="renaming ? 'rename' : 'create'"
      :parent-id="parentId"
      :folder="folder"
      @done="close"
    />
  </AppSheet>
  <MoveFolderSheet v-if="folder && shown?.kind === 'move'" v-model:open="moveOpen" :folder-id="folder.id" />
  <ConfirmSheet
    v-model:open="archiveOpen"
    :title="$t('folderMenu.archiveTitle')"
    :description="$t('folderMenu.archiveConfirm', { name: folder?.name ?? '' })"
    :confirm-label="$t(archiving ? 'status.saving' : 'folderMenu.archive')"
    :busy="archiving"
    destructive
    @confirm="archive"
  />
</template>

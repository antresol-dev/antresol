<script setup lang="ts">
import { newId } from '@graymatter/core'
import { Archive, Ellipsis, FolderInput, FolderPlus, Pencil } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessageKey } from '~/lib/errors'
import { folderView } from '~/lib/views'

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace
const route = useRoute()
const router = useRouter()

const folderId = computed(() => (route.name === 'folder-id' ? String(route.params.id) : null))
const view = computed(() => (state.snapshot ? folderView(state.snapshot, folderId.value) : null))
const folder = computed(() => view.value?.folder ?? null)

const dialog = ref<'create' | 'rename' | 'move' | 'archive' | null>(null)
const archiving = ref(false)
const locked = computed(() => !!state.readOnly || state.saving || archiving.value)

const formOpen = computed({
  get: () => dialog.value === 'create' || dialog.value === 'rename',
  set: (open) => {
    if (!open) dialog.value = null
  },
})
const moveOpen = computed({
  get: () => dialog.value === 'move',
  set: (open) => {
    if (!open) dialog.value = null
  },
})
const archiveOpen = computed({
  get: () => dialog.value === 'archive',
  set: (open) => {
    if (!open) dialog.value = null
  },
})

async function archive(): Promise<void> {
  const target = folder.value
  if (!target) return
  archiving.value = true
  try {
    await workspace.apply({ type: 'archive', target: 'folder', id: target.id, archiveId: newId() })
    dialog.value = null
    await router.push(target.parentId === null ? '/' : `/folder/${target.parentId}`)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    archiving.value = false
  }
}

const itemClass = 'min-h-11 gap-2 px-2 text-sm'
</script>

<template>
  <template v-if="view">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-full border border-border bg-surface text-icon"
          :aria-label="$t('folderMenu.label')"
        >
          <Ellipsis class="size-5" stroke-width="1.75" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-56 bg-surface p-1.5">
        <DropdownMenuItem :disabled="locked" :class="itemClass" @select="dialog = 'create'">
          <FolderPlus class="size-4 shrink-0" aria-hidden="true" />
          {{ $t('folderMenu.new') }}
        </DropdownMenuItem>
        <template v-if="folder">
          <DropdownMenuItem :disabled="locked" :class="itemClass" @select="dialog = 'rename'">
            <Pencil class="size-4 shrink-0" aria-hidden="true" />
            {{ $t('folderMenu.rename') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="locked" :class="itemClass" @select="dialog = 'move'">
            <FolderInput class="size-4 shrink-0" aria-hidden="true" />
            {{ $t('folderMenu.move') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="locked" :class="[itemClass, 'text-destructive']" @select="dialog = 'archive'">
            <Archive class="size-4 shrink-0" aria-hidden="true" />
            {{ $t('folderMenu.archive') }}
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <AppSheet v-model:open="formOpen" :title="$t(dialog === 'rename' ? 'folderMenu.renameTitle' : 'folderMenu.new')">
      <FolderForm
        v-if="dialog === 'create' || dialog === 'rename'"
        :mode="dialog"
        :parent-id="folderId"
        :folder="folder"
        @done="dialog = null"
      />
    </AppSheet>
    <MoveFolderSheet v-if="folder && dialog === 'move'" v-model:open="moveOpen" :folder-id="folder.id" />
    <ConfirmSheet
      v-if="folder"
      v-model:open="archiveOpen"
      :title="$t('folderMenu.archiveTitle')"
      :description="$t('folderMenu.archiveConfirm', { name: folder.name })"
      :confirm-label="$t(archiving ? 'status.saving' : 'folderMenu.archive')"
      :busy="archiving"
      destructive
      @confirm="archive"
    />
  </template>
</template>

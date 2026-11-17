<script setup lang="ts">
import { folderNameTaken, type Id } from '@antresol/core'
import { Check } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { errorMessageKey } from '~/lib/errors'
import { moveTargets } from '~/lib/views'

const props = defineProps<{ folderId: Id }>()
const open = defineModel<boolean>('open', { required: true })
/** The move is being written; FolderDialogs keeps the sheet open meanwhile. */
const busy = defineModel<boolean>('busy', { default: false })

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const targets = computed(() => (state.snapshot ? moveTargets(state.snapshot, props.folderId) : []))
// Parents that already hold a folder of this name (archived ones included) can't be chosen.
const takenIn = (parentId: Id | null): 'active' | 'archived' | null => {
  const s = state.snapshot
  const f = s?.folders.find((x) => x.id === props.folderId)
  return s && f ? folderNameTaken(s, parentId, f.name, f.id) : null
}
const locked = computed(() => busy.value || !!state.readOnly)

async function choose(parentId: Id | null, current: boolean): Promise<void> {
  if (current) {
    open.value = false
    return
  }
  if (locked.value) return
  busy.value = true
  try {
    await workspace.apply({ type: 'folder.move', id: props.folderId, parentId })
    open.value = false
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('folderMenu.moveTitle')" :description="$t('folderMenu.moveHint')" :locked="busy">
    <ul class="grid max-h-[50dvh] grid-cols-1 gap-0.5 overflow-x-hidden overflow-y-auto p-1">
      <li v-for="target in targets" :key="target.id ?? 'root'" class="min-w-0">
        <button
          type="button"
          :disabled="(locked && !target.current) || !!takenIn(target.id)"
          :aria-current="target.current ? 'true' : undefined"
          class="pressable flex min-h-11 w-full items-center gap-2 py-1.5 pr-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50"
          :class="target.current ? 'row-selected font-semibold' : ''"
          :style="{ paddingLeft: `${8 + Math.min(target.depth * 16, 64)}px` }"
          @click="choose(target.id, target.current)"
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5">
            <span class="min-w-0 truncate">{{ target.name }}</span>
            <RootMark v-if="target.id === null" />
          </span>
          <span v-if="takenIn(target.id)" class="shrink-0 text-xs text-destructive">
            {{ $t(takenIn(target.id) === 'archived' ? 'nameTaken.inListArchived' : 'nameTaken.inList') }}
          </span>
          <Check v-if="target.current" class="size-4 shrink-0" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </AppSheet>
</template>

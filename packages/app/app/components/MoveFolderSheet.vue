<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { Check } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { errorMessageKey } from '~/lib/errors'
import { moveTargets } from '~/lib/views'

const props = defineProps<{ folderId: Id }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const targets = computed(() => (state.snapshot ? moveTargets(state.snapshot, props.folderId) : []))
const busy = ref(false)
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
          :disabled="locked && !target.current"
          :aria-current="target.current ? 'true' : undefined"
          class="flex min-h-11 w-full items-center gap-2 rounded-sm py-1.5 pr-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          :class="target.current ? 'bg-accent-soft font-semibold text-accent-soft-foreground' : ''"
          :style="{ paddingLeft: `${8 + Math.min(target.depth * 16, 64)}px` }"
          @click="choose(target.id, target.current)"
        >
          <span class="min-w-0 flex-1 truncate">{{ target.name }}</span>
          <Check v-if="target.current" class="size-4 shrink-0" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </AppSheet>
</template>

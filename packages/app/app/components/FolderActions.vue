<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { Archive, FolderInput, FolderPlus, Pencil } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Folder actions in the screen header (shell design 6.3), neutral like every action:
// - from 1024 px: "New folder" with its label, then Rename, Move and Archive as 36 px outline icon buttons;
// - below 1024 px (compact): the same four as 44 px transparent icon buttons in the top bar.
// At the inventory root there is only "New folder": the inventory's own actions live in the switcher.
const props = defineProps<{ folderId: Id | null; compact: boolean }>()

const { state } = useWorkspace()
const { open } = useFolderDialog()

const locked = computed(() => !!state.readOnly || state.saving)

const newFolder = (): void => open({ kind: 'create', parentId: props.folderId })
const folderActions = computed(() => {
  const id = props.folderId
  if (id === null) return []
  return [
    { key: 'rename', label: 'folderMenu.rename', icon: Pencil, run: () => open({ kind: 'rename', folderId: id }) },
    { key: 'move', label: 'folderMenu.move', icon: FolderInput, run: () => open({ kind: 'move', folderId: id }) },
    { key: 'archive', label: 'folderMenu.archive', icon: Archive, run: () => open({ kind: 'archive', folderId: id }) },
  ]
})

const compactButton = 'size-11 rounded-field text-icon hover:text-foreground disabled:opacity-35'
const iconButton = 'size-9 rounded-thumb text-icon'
</script>

<template>
  <template v-if="compact">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon" :class="compactButton" :aria-label="$t('folderMenu.new')" :disabled="locked" @click="newFolder">
          <FolderPlus class="size-5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ $t('folderMenu.new') }}</TooltipContent>
    </Tooltip>
    <Tooltip v-for="a in folderActions" :key="a.key">
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon" :class="compactButton" :aria-label="$t(a.label)" :disabled="locked" @click="a.run">
          <component :is="a.icon" class="size-5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ $t(a.label) }}</TooltipContent>
    </Tooltip>
  </template>

  <template v-else>
    <Button variant="outline" class="h-9 gap-[7px] rounded-thumb px-3.5 font-bold" :disabled="locked" @click="newFolder">
      <FolderPlus aria-hidden="true" />
      {{ $t('folderMenu.new') }}
    </Button>
    <Tooltip v-for="a in folderActions" :key="a.key">
      <TooltipTrigger as-child>
        <Button variant="outline" size="icon" :class="iconButton" :aria-label="$t(a.label)" :disabled="locked" @click="a.run">
          <component :is="a.icon" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ $t(a.label) }}</TooltipContent>
    </Tooltip>
  </template>
</template>

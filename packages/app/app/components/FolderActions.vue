<script setup lang="ts">
import type { Id } from '@antresol/core'
import { Archive, ClipboardCheck, FolderInput, FolderPlus, Pencil, Plus } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { HeaderMenuAction } from './HeaderMenu.vue'

// Folder actions in the screen header (shell design 6.3), neutral like every action:
// - from 1024 px: the accent "Add item", "New folder" with its label, Rename, Move and Archive as raised 36 px icon
//   buttons;
// - below 1024 px (compact, design system F9): "New folder" as a flat 44 px icon button; Count this folder, Rename,
//   Move and Archive in the "⋯" menu, Archive last and destructive.
// At the inventory root there are only "Add item" and "New folder": the inventory's own actions live in the switcher.
const props = defineProps<{ folderId: Id | null; compact: boolean }>()

const { state } = useWorkspace()
const { open } = useFolderDialog()
const quickAdd = useQuickAdd()

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

// "Count this folder" (spec 4.14): a raised button from 1024 px; on a phone in the "⋯" menu (and the folder row's menu).
const countTo = computed(() => (props.folderId === null ? null : `/count/${props.folderId}`))

const { t } = useI18n()
const menu = computed<HeaderMenuAction[]>(() => {
  const to = countTo.value
  const count: HeaderMenuAction[] = to
    ? [{ key: 'count', label: t('countFolder.menu'), icon: ClipboardCheck, run: () => void navigateTo(to), disabled: !!state.readOnly }]
    : []
  return [
    ...count,
    ...folderActions.value.map((a) => ({
      key: a.key,
      label: t(a.label),
      icon: a.icon,
      run: a.run,
      destructive: a.key === 'archive',
      disabled: locked.value,
    })),
  ]
})

const compactButton = 'size-11 disabled:opacity-35'
const iconButton = 'size-9'
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
    <HeaderMenu v-if="menu.length > 0" :actions="menu" />
  </template>

  <!-- The labelled buttons 6 px apart, the icon buttons 2 px apart: the header's room goes to the title. -->
  <div v-else class="flex items-center gap-1.5">
    <Button class="h-9 gap-2 px-3 btn-label" :disabled="locked" @click="quickAdd.open()">
      <Plus aria-hidden="true" />
      {{ $t('quickAdd.title') }}
    </Button>
    <Button variant="outline" class="h-9 gap-2 px-3 btn-label" :disabled="locked" @click="newFolder">
      <FolderPlus aria-hidden="true" />
      {{ $t('folderMenu.new') }}
    </Button>
    <div class="flex items-center gap-0.5">
      <Tooltip v-if="countTo">
        <TooltipTrigger as-child>
          <Button variant="outline" size="icon" :class="iconButton" :aria-label="$t('countFolder.menu')" :disabled="!!state.readOnly" @click="navigateTo(countTo)">
            <ClipboardCheck aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t('countFolder.menu') }}</TooltipContent>
      </Tooltip>
      <Tooltip v-for="a in folderActions" :key="a.key">
        <TooltipTrigger as-child>
          <Button variant="outline" size="icon" :class="iconButton" :aria-label="$t(a.label)" :disabled="locked" @click="a.run">
            <component :is="a.icon" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t(a.label) }}</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>

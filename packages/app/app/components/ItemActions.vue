<script setup lang="ts">
import type { Id } from '@antresol/core'
import { Archive, FolderInput, Pencil } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { HeaderMenuAction } from './HeaderMenu.vue'

// Item actions in the card's header, neutral like every action:
// - from 1024 px: "Edit" with its label, Move and Archive as raised 36 px icon buttons;
// - below 1024 px (compact, design system F9): Edit as a flat 44 px icon button, Move and Archive in the "⋯" menu,
//   Archive last and destructive.
const props = defineProps<{ itemId: Id; compact: boolean }>()

const { state } = useWorkspace()
const { open } = useItemDialog()

const locked = computed(() => !!state.readOnly || state.saving)

const moveArchive = [
  { key: 'move', label: 'itemMenu.move', icon: FolderInput },
  { key: 'archive', label: 'itemMenu.archive', icon: Archive },
] as const
const run = (kind: 'edit' | 'move' | 'archive'): void => open({ kind, itemId: props.itemId })
const { t } = useI18n()
const menu = computed<HeaderMenuAction[]>(() =>
  moveArchive.map((a) => ({
    key: a.key,
    label: t(a.label),
    icon: a.icon,
    run: () => run(a.key),
    destructive: a.key === 'archive',
    disabled: locked.value,
  })),
)

const compactButton = 'size-11 disabled:opacity-35'
const iconButton = 'size-9'
</script>

<template>
  <template v-if="compact">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon" :class="compactButton" :aria-label="$t('itemMenu.edit')" :disabled="locked" @click="run('edit')">
          <Pencil class="size-5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ $t('itemMenu.edit') }}</TooltipContent>
    </Tooltip>
    <HeaderMenu :actions="menu" />
  </template>

  <!-- The labelled button 6 px from the icon buttons, the icon buttons 4 px apart (as FolderActions). -->
  <div v-else class="flex items-center gap-1.5">
    <Button variant="outline" class="h-9 gap-2 px-3 btn-label" :disabled="locked" @click="run('edit')">
      <Pencil aria-hidden="true" />
      {{ $t('itemMenu.edit') }}
    </Button>
    <div class="flex items-center gap-1">
      <Tooltip v-for="a in moveArchive" :key="a.key">
        <TooltipTrigger as-child>
          <Button variant="outline" size="icon" :class="iconButton" :aria-label="$t(a.label)" :disabled="locked" @click="run(a.key)">
            <component :is="a.icon" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t(a.label) }}</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>

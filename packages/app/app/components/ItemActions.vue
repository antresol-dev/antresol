<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { Archive, FolderInput, Pencil } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Item actions in the card's header, neutral like every action:
// - from 1024 px: "Edit" with its label, Move and Archive as raised 36 px icon buttons;
// - below 1024 px (compact): the three as flat 44 px icon buttons in the top bar (the owner, 2026-11-12: raised ones sit
//   too close to the screen's top edge, and a margin would take room the screen needs).
const props = defineProps<{ itemId: Id; compact: boolean }>()

const { state } = useWorkspace()
const { open } = useItemDialog()

const locked = computed(() => !!state.readOnly || state.saving)

const moveArchive = [
  { key: 'move', label: 'itemMenu.move', icon: FolderInput },
  { key: 'archive', label: 'itemMenu.archive', icon: Archive },
] as const
const run = (kind: 'edit' | 'move' | 'archive'): void => open({ kind, itemId: props.itemId })

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
    <Tooltip v-for="a in moveArchive" :key="a.key">
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon" :class="compactButton" :aria-label="$t(a.label)" :disabled="locked" @click="run(a.key)">
          <component :is="a.icon" class="size-5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ $t(a.label) }}</TooltipContent>
    </Tooltip>
  </template>

  <template v-else>
    <Button variant="outline" class="h-9 gap-[7px] px-3.5 btn-label" :disabled="locked" @click="run('edit')">
      <Pencil aria-hidden="true" />
      {{ $t('itemMenu.edit') }}
    </Button>
    <Tooltip v-for="a in moveArchive" :key="a.key">
      <TooltipTrigger as-child>
        <Button variant="outline" size="icon" :class="iconButton" :aria-label="$t(a.label)" :disabled="locked" @click="run(a.key)">
          <component :is="a.icon" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ $t(a.label) }}</TooltipContent>
    </Tooltip>
  </template>
</template>

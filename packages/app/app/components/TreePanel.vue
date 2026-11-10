<script setup lang="ts">
import { FolderPlus } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { state } = useWorkspace()
const { open } = useFolderDialog()
const locked = computed(() => !state.snapshot || !!state.readOnly || state.saving)
</script>

<template>
  <!-- A plain container: the tree inside is the "Folders" landmark (one name, not two). -->
  <div class="flex min-h-0 flex-col border-r border-border bg-surface">
    <div class="flex shrink-0 items-center justify-between gap-2 pt-3.5 pr-3.5 pb-1.5 pl-4">
      <h2 class="text-xs font-bold tracking-[0.02em] text-muted-foreground uppercase">
        {{ $t('folder.tree') }}
      </h2>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded-lg text-icon outline-none transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            :aria-label="$t('folderMenu.new')"
            :disabled="locked"
            @click="open({ kind: 'create', parentId: null })"
          >
            <FolderPlus class="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ $t('folderMenu.new') }}</TooltipContent>
      </Tooltip>
    </div>
    <!-- pt-0.5: room for the first row's focus ring inside the scroll container. -->
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-3">
      <FolderTree variant="panel" />
    </div>
  </div>
</template>

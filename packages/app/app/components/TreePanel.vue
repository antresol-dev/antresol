<script setup lang="ts">
import { FolderPlus, Search } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { state } = useWorkspace()
const { open } = useFolderDialog()
const { paletteOpen } = useShell()
const locked = computed(() => !state.snapshot || !!state.readOnly || state.saving)
// The palette's shortcut as the platform writes it.
const mac = /Mac/.test(navigator.userAgent)
</script>

<template>
  <!-- A plain container: the tree inside is the "Folders" landmark (one name, not two). -->
  <div class="flex min-h-0 flex-col border-r border-border bg-surface">
    <button
      type="button"
      class="mx-3 mt-3.5 mb-2 flex min-h-11 shrink-0 items-center gap-2 rounded-thumb border border-border bg-background px-3 text-left text-sm font-semibold text-muted-foreground outline-none transition-colors duration-150 hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      aria-haspopup="dialog"
      :aria-expanded="paletteOpen"
      :aria-keyshortcuts="mac ? 'Meta+K' : 'Control+K'"
      :disabled="!state.current"
      @click="paletteOpen = true"
    >
      <Search class="size-[15px] shrink-0" aria-hidden="true" />
      <span class="flex-1">{{ $t('search.label') }}</span>
      <kbd
        aria-hidden="true"
        class="rounded-md border border-b-2 border-border bg-surface px-1.5 text-[11px] font-semibold text-subtle-foreground"
      >
        {{ mac ? $t('search.shortcut.mac') : $t('search.shortcut.other') }}
      </kbd>
    </button>
    <div class="flex shrink-0 items-center justify-between gap-2 pt-1.5 pr-3.5 pb-1.5 pl-4">
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

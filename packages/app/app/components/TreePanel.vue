<script setup lang="ts">
import { FolderPlus, Search } from '@lucide/vue'
import { TREE_WIDTH_MIN, TREE_WIDTH_STEP } from '~/lib/tree-width'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { state } = useWorkspace()
const { open } = useFolderDialog()
const { paletteOpen } = useShell()
const locked = computed(() => !state.snapshot || !!state.readOnly || state.saving)
// The palette's shortcut as the platform writes it.
const mac = /Mac/.test(navigator.userAgent)

// The right edge is a separator: drag it, or focus it and press the arrows; a double click restores the default width.
const { width, max, set, save, reset } = useTreeWidth()
const panel = useTemplateRef<HTMLElement>('panel')
let dragging = false
function down(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
function move(e: PointerEvent): void {
  if (dragging && panel.value) set(e.clientX - panel.value.getBoundingClientRect().left)
}
function up(): void {
  if (!dragging) return
  dragging = false
  save()
}
function key(e: KeyboardEvent): void {
  const delta = e.key === 'ArrowRight' ? TREE_WIDTH_STEP : e.key === 'ArrowLeft' ? -TREE_WIDTH_STEP : 0
  if (delta === 0) return
  e.preventDefault()
  set(width.value + delta)
  save()
}
</script>

<template>
  <!-- A plain container: the tree inside is the "Folders" landmark (one name, not two). -->
  <div ref="panel" class="relative flex min-h-0 flex-col border-r border-border bg-surface">
    <div
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="$t('tree.resize')"
      :aria-valuenow="width"
      :aria-valuemin="TREE_WIDTH_MIN"
      :aria-valuemax="max"
      class="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none transition-colors duration-(--dur-fast) hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @dblclick="reset"
      @keydown="key"
    />
    <button
      type="button"
      class="raised pressable mx-3 mt-4 mb-2 flex min-h-11 shrink-0 items-center gap-2 px-3 text-left text-sm font-semibold text-muted-foreground hover:text-accent-ink disabled:pointer-events-none disabled:opacity-50"
      aria-haspopup="dialog"
      :aria-expanded="paletteOpen"
      :aria-keyshortcuts="mac ? 'Meta+K' : 'Control+K'"
      :disabled="!state.current"
      @click="paletteOpen = true"
    >
      <Search class="size-4 shrink-0" aria-hidden="true" />
      <span class="flex-1">{{ $t('search.label') }}</span>
      <kbd
        aria-hidden="true"
        class="rounded-chip bg-chip px-1.5 text-xs font-semibold text-subtle-foreground"
      >
        {{ mac ? $t('search.shortcut.mac') : $t('search.shortcut.other') }}
      </kbd>
    </button>
    <!-- The hierarchy sits flat on the panel (the owner, 2026-11-12: neither concave nor raised); the section header with
         its buttons lives in FolderTree. -->
    <FolderTree variant="panel">
      <template #actions>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="pressable grid size-8 shrink-0 place-items-center rounded-chip disabled:pointer-events-none disabled:opacity-50"
              :aria-label="$t('folderMenu.new')"
              :disabled="locked"
              @click="open({ kind: 'create', parentId: null })"
            >
              <FolderPlus class="size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ $t('folderMenu.new') }}</TooltipContent>
        </Tooltip>
      </template>
    </FolderTree>
  </div>
</template>

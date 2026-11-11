<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { Archive, Folder, FolderInput, Pencil } from '@lucide/vue'
import type { ComponentPublicInstance } from 'vue'
import { piecesLabel, type FolderRow } from '~/lib/views'
import type RowMenu from './RowMenu.vue'

defineProps<{ folders: FolderRow[] }>()

const { t } = useI18n()
const { state } = useWorkspace()
const { open } = useFolderDialog()

const locked = computed(() => !!state.readOnly || state.saving)
const actions = computed(() => [
  { key: 'rename', label: t('folderMenu.rename'), icon: Pencil, disabled: locked.value },
  { key: 'move', label: t('folderMenu.move'), icon: FolderInput, disabled: locked.value },
  { key: 'archive', label: t('folderMenu.archive'), icon: Archive, destructive: true, disabled: locked.value },
])

function select(folderId: Id, key: string): void {
  if (key === 'rename' || key === 'move' || key === 'archive') open({ kind: key, folderId })
}

// One finger presses one row at a time: a single long-press tracker for the list, aimed at the row it went down on.
const menus = new Map<Id, InstanceType<typeof RowMenu>>()
function setMenu(id: Id, el: Element | ComponentPublicInstance | null): void {
  if (el) menus.set(id, el as InstanceType<typeof RowMenu>)
  else menus.delete(id)
}
let pressed: Id | null = null
const press = useLongPress(() => {
  if (pressed !== null) menus.get(pressed)?.openSheet()
})
function pointerdown(id: Id, e: PointerEvent): void {
  pressed = id
  press.onPointerdown(e)
}
</script>

<template>
  <!-- overflow-hidden keeps the hover background inside the rounded card; the focus ring is inset for the same reason. -->
  <ul class="overflow-hidden rounded-card border border-border bg-surface py-1">
    <li
      v-for="f in folders"
      :key="f.id"
      class="group relative flex items-center transition-colors duration-150 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-[58px] not-first:before:h-px not-first:before:bg-divider not-first:before:content-[''] hover:bg-hover"
    >
      <NuxtLink
        :to="`/folder/${f.id}`"
        class="flex h-[50px] min-w-0 flex-1 items-center gap-3 px-3.5 outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        @pointerdown="pointerdown(f.id, $event)"
        @pointermove="press.onPointermove"
        @pointerup="press.onPointerup"
        @pointercancel="press.onPointercancel"
        @contextmenu="press.onContextmenu"
        @click.capture="press.onClickCapture"
      >
        <span class="flex size-8 shrink-0 items-center justify-center rounded-icon bg-accent-soft text-accent-soft-foreground">
          <Folder class="size-[17px]" aria-hidden="true" />
        </span>
        <span class="min-w-0 grow truncate text-[15px] font-semibold">{{ f.name }}</span>
        <span v-if="f.pieces !== null" class="shrink-0 text-[13px] font-semibold text-muted-foreground tabular-nums">{{ piecesLabel(f.pieces) }}</span>
      </NuxtLink>
      <!-- Always in the layout where it can show (hidden only on touch below 1024 px), so the count never moves. -->
      <RowMenu
        :ref="(el) => setMenu(f.id, el)"
        class="row-action -ml-1 mr-2.5 size-[30px]"
        :label="f.name"
        :actions="actions"
        @select="select(f.id, $event)"
      />
    </li>
  </ul>
</template>

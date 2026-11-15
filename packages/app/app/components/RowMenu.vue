<script setup lang="ts">
import { Ellipsis } from '@lucide/vue'
import { cn } from 'cn'
import type { Component, HTMLAttributes } from 'vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface RowMenuAction {
  key: string
  label: string
  icon: Component
  destructive?: boolean
  disabled?: boolean
}

// Attributes (class: `row-action`, size, radius) go to the "⋯" button, not to the menu root.
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const triggerAttrs = computed(() => ({
  ...attrs,
  class: cn(
    // A flat ghost button (radius 10 like the mock-up's "⋯"): muted, the accent tint and ink under the pointer and while
    // its menu is open.
    'pressable grid shrink-0 place-items-center rounded-chip text-muted-foreground hover:text-accent-ink data-[state=open]:bg-(--ghost-pressed) data-[state=open]:text-accent-ink',
    attrs.class as HTMLAttributes['class'],
  ),
}))

defineProps<{
  /** The row's name: the sheet's title, and the "⋯" button reads "More actions for {label}". */
  label: string
  actions: RowMenuAction[]
  /** The "⋯" button's whole accessible name, where the menu belongs to something other than a named row. */
  buttonLabel?: string
}>()
const emit = defineEmits<{ select: [key: string] }>()

const menuOpen = ref(false)
const sheetOpen = ref(false)
// The back gesture closes the dropdown; the sheet is an AppSheet and watches by itself.
useCloseWatcher(menuOpen)

function choose(key: string): void {
  sheetOpen.value = false
  emit('select', key)
}

defineExpose({
  /** The same actions in a sheet titled with the row's name: what a long press opens. */
  openSheet(): void {
    menuOpen.value = false
    sheetOpen.value = true
  },
})
</script>

<template>
  <DropdownMenu v-model:open="menuOpen">
    <DropdownMenuTrigger as-child>
      <button type="button" v-bind="triggerAttrs" :aria-label="buttonLabel ?? $t('rowMenu.more', { name: label })">
        <Ellipsis class="size-4" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      class="grid w-56 gap-0.5 motion-safe:data-[state=open]:animate-pop-in motion-safe:data-[state=closed]:animate-pop-out"
    >
      <DropdownMenuItem
        v-for="a in actions"
        :key="a.key"
        :disabled="a.disabled"
        :variant="a.destructive ? 'destructive' : 'default'"
        class="min-h-11 gap-3 px-3 font-semibold"
        @select="emit('select', a.key)"
      >
        <component :is="a.icon" class="size-4" aria-hidden="true" />
        {{ a.label }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <AppSheet v-model:open="sheetOpen" :title="label">
    <ul class="-mx-1 grid gap-0.5">
      <li v-for="a in actions" :key="a.key">
        <button
          type="button"
          :disabled="a.disabled"
          :class="[
            // A row tile (14); its icon square 4 px in stays concentric (10).
            'pressable flex min-h-11 w-full items-center gap-3 px-1 py-1 text-left text-base font-semibold disabled:pointer-events-none disabled:opacity-50',
            a.destructive ? 'text-destructive' : '',
          ]"
          @click="choose(a.key)"
        >
          <span class="grid size-9 shrink-0 place-items-center rounded-icon bg-chip">
            <component :is="a.icon" class="size-5" aria-hidden="true" />
          </span>
          <span class="min-w-0 truncate">{{ a.label }}</span>
        </button>
      </li>
    </ul>
  </AppSheet>
</template>

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
    'grid shrink-0 place-items-center rounded-lg text-icon outline-none transition-colors duration-150 hover:bg-chip hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-chip',
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
      class="grid w-56 gap-0.5 rounded-thumb bg-surface p-1.5 motion-safe:data-[state=open]:animate-pop-in motion-safe:data-[state=closed]:animate-pop-out"
    >
      <DropdownMenuItem
        v-for="a in actions"
        :key="a.key"
        :disabled="a.disabled"
        :variant="a.destructive ? 'destructive' : 'default'"
        class="min-h-11 gap-2.5 rounded-lg px-2.5 font-semibold transition-colors duration-150 focus:bg-hover focus:text-foreground"
        @select="emit('select', a.key)"
      >
        <component :is="a.icon" class="size-4" aria-hidden="true" />
        {{ a.label }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <AppSheet v-model:open="sheetOpen" :title="label">
    <ul class="-mx-1.5 grid gap-0.5">
      <li v-for="a in actions" :key="a.key">
        <button
          type="button"
          :disabled="a.disabled"
          :class="[
            'flex min-h-11 w-full items-center gap-3 rounded-thumb px-1.5 py-1 text-left text-[15px] font-bold outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
            a.destructive ? 'text-destructive' : '',
          ]"
          @click="choose(a.key)"
        >
          <span class="grid size-9 shrink-0 place-items-center rounded-icon bg-chip">
            <component :is="a.icon" class="size-[18px]" aria-hidden="true" />
          </span>
          <span class="min-w-0 truncate">{{ a.label }}</span>
        </button>
      </li>
    </ul>
  </AppSheet>
</template>

<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

defineProps<{ title: string; description?: string }>()
const open = defineModel<boolean>('open', { required: true })

// The Android back gesture closes the sheet instead of leaving the screen.
useCloseWatcher(open)

// Sheets open from header buttons, row menus, the tree and long presses, never from a DialogTrigger, so Reka has
// nothing to return focus to and it would drop to <body>. Remember what had focus when the sheet opened (before the
// sheet takes it) and go back there when it closes.
let opener: HTMLElement | null = null
watch(
  open,
  (isOpen) => {
    if (isOpen) opener = openerOf(document.activeElement)
  },
  { immediate: true },
)

function openerOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return null
  // A menu item goes away with its menu: the way back is the button that opened the menu (Reka labels the menu with it).
  const menu = active.closest('[role="menu"]')
  const trigger = menu ? document.getElementById(menu.getAttribute('aria-labelledby') ?? '') : null
  return trigger ?? active
}

function returnFocus(event: Event): void {
  event.preventDefault()
  const sheet = event.target instanceof Node ? event.target : null
  const active = document.activeElement
  // Focus already moved on, into a sheet that opened in place of this one: leave it there.
  if (sheet && active && active !== document.body && !sheet.contains(active)) return
  const back = opener?.isConnected ? opener : null
  opener = null
  // The opener is gone (its row was archived, the screen changed): the screen's heading.
  if (back) back.focus()
  else document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
}
</script>

<template>
  <Dialog v-model:open="open">
    <!-- A bottom sheet below 768 px that slides up, a centred window from 768 px that scales in; no movement under reduced motion. -->
    <DialogContent
      :show-close-button="false"
      class="top-auto bottom-0 left-0 max-w-full translate-x-0 translate-y-0 rounded-b-none rounded-t-card border-x-0 border-b-0 bg-surface p-4 pb-6 motion-safe:data-[state=open]:animate-sheet-in motion-safe:data-[state=closed]:animate-sheet-out motion-reduce:animate-none sm:max-w-full md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-[480px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border md:pb-4 md:motion-safe:data-[state=open]:animate-pop-in md:motion-safe:data-[state=closed]:animate-pop-out"
      @close-auto-focus="returnFocus"
    >
      <DialogHeader class="text-left">
        <DialogTitle class="text-lg font-bold tracking-[-0.02em]">{{ title }}</DialogTitle>
        <DialogDescription :class="description ? 'text-subtle-foreground' : 'sr-only'">
          {{ description ?? title }}
        </DialogDescription>
      </DialogHeader>
      <slot />
      <DialogFooter v-if="$slots.footer" class="gap-2">
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

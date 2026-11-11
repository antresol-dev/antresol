<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { isSubmitChord, pressPrimary } from '~/lib/sheet-keys'

const props = defineProps<{
  title: string
  description?: string
  /** What the sheet is about, a line under the title: "10 kΩ · Resistor 0.25 W · 5 %" (see bucketDescription). */
  summary?: string
  initialFocus?: string
  /** A write is running: Esc, a click outside and the back gesture leave the sheet open. */
  locked?: boolean
}>()
const open = defineModel<boolean>('open', { required: true })

// The Android back gesture closes the sheet instead of leaving the screen.
useCloseWatcher(open, () => !!props.locked)

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

// A sheet with fields focuses the one named by the selector, not the first focusable thing.
function focusInitial(event: Event): void {
  if (!props.initialFocus) return
  const target = event.target instanceof Element ? event.target.querySelector<HTMLElement>(props.initialFocus) : null
  if (!target) return
  event.preventDefault()
  target.focus()
}

// Ctrl+Enter / ⌘+Enter presses the sheet's main button when it is available (once here, not in every sheet).
function submitChord(event: KeyboardEvent): void {
  if (!isSubmitChord(event) || event.defaultPrevented || !(event.currentTarget instanceof HTMLElement)) return
  if (pressPrimary(event.currentTarget)) event.preventDefault()
}

function refuseWhileLocked(event: Event): void {
  if (props.locked) event.preventDefault()
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
      class="max-h-[calc(100dvh-1rem)] overflow-y-auto top-auto bottom-0 left-0 max-w-full translate-x-0 translate-y-0 rounded-b-none rounded-t-card border-x-0 border-b-0 bg-surface p-4 pb-6 motion-safe:data-[state=open]:animate-sheet-in motion-safe:data-[state=closed]:animate-sheet-out motion-reduce:animate-none sm:max-w-full md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-[480px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border md:pb-4 md:motion-safe:data-[state=open]:animate-pop-in md:motion-safe:data-[state=closed]:animate-pop-out"
      @escape-key-down="refuseWhileLocked"
      @pointer-down-outside="refuseWhileLocked"
      @interact-outside="refuseWhileLocked"
      @open-auto-focus="focusInitial"
      @close-auto-focus="returnFocus"
      @keydown="submitChord"
    >
      <DialogHeader class="text-left">
        <DialogTitle class="text-lg font-bold tracking-[-0.02em]">{{ title }}</DialogTitle>
        <DialogDescription :class="description ? 'text-subtle-foreground' : 'sr-only'">
          {{ description ?? title }}
        </DialogDescription>
      </DialogHeader>
      <p v-if="summary" class="-mt-1 text-sm font-semibold break-words">{{ summary }}</p>
      <slot />
      <DialogFooter v-if="$slots.footer" class="gap-2">
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { X } from '@lucide/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { KEYBOARD_SETTLE_MS, keyboardWatch, opensKeyboard, revealDelta } from '~/lib/keyboard'
import { keepOpener, waitsForKeyboard } from '~/lib/sheet-close'
import { isSubmitChord, pressPrimary } from '~/lib/sheet-keys'

const props = defineProps<{
  title: string
  description?: string
  /** What the sheet is about, a line under the title: "10 kΩ · Resistor 0.25 W · 5 %" (see bucketDescription). */
  summary?: string
  initialFocus?: string
  /** A write is running: Esc, a click outside, the back gesture and the close button leave the sheet open. */
  locked?: boolean
}>()
const open = defineModel<boolean>('open', { required: true })

// The Android back gesture closes the sheet instead of leaving the screen.
useCloseWatcher(open, () => !!props.locked)

// The phone's keyboard and the sheet (the owner, 2026-11-12: sheets jumped when the keyboard came up and shook when
// they closed). The page's viewport is resizes-content, so the keyboard shrinks the layout and the sheet, fixed at the
// bottom with its height in dvh, stands on it in one step. Around that:
// - opening: the sheet slides in first; on a touch screen its field takes focus (and the keyboard comes) afterwards;
// - the keyboard coming or going keeps the field being typed in in sight, inside the sheet;
// - closing: the keyboard goes away first and the sheet slides out once, after the viewport has grown back. `shown` is
//   what Reka shows; it follows `open` except for that wait.
const shown = ref(open.value)
// Reka's content element (the sheet itself), from its open-auto-focus event.
let sheet: HTMLElement | null = null
// The sheet's height while it leaves: content its parent drops at once (a form under v-if="open") doesn't shrink it.
const leavingHeight = ref<number | null>(null)
// From the moment the close starts until the sheet is gone or reopened: the content takes no taps (a second tap on Add
// during the keyboard wait would save twice).
const leaving = ref(false)
// When a text field in the sheet last lost focus: a tap on a button or outside starts the keyboard down before the close.
let fieldLeftAt = Number.NEGATIVE_INFINITY
const coarse = useMediaQuery('(pointer: coarse)')
// Taken when the screen's sheets are set up, before any keyboard: it learns the viewport's full height from there.
const keyboard = keyboardWatch()

// Sheets open from header buttons, row menus, the tree and long presses, never from a DialogTrigger, so Reka has
// nothing to return focus to and it would drop to <body>. Remember what had focus when the sheet opened (before the
// sheet takes it) and go back there when it closes.
let opener: HTMLElement | null = null
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      opener = keepOpener(shown.value, opener, openerOf(document.activeElement))
      leavingHeight.value = null
      leaving.value = false
      shown.value = true
    } else {
      leaving.value = true
      void leave()
    }
  },
  { immediate: true },
)

async function leave(): Promise<void> {
  if (!shown.value) {
    leaving.value = false
    return
  }
  // Closed before this opening's content mounted: `sheet` is still the last one's, gone from the page.
  const el = sheet?.isConnected ? sheet : null
  const active = document.activeElement
  const typing = !!el && active instanceof HTMLElement && el.contains(active) && opensKeyboard(active)
  if (el) leavingHeight.value = el.getBoundingClientRect().height
  if (typing) active.blur()
  if (
    waitsForKeyboard({
      coarse: coarse.value,
      typing,
      recentlyTyped: performance.now() - fieldLeftAt < KEYBOARD_SETTLE_MS,
      keyboardOpen: !!keyboard?.isOpen(),
    })
  ) {
    await keyboard!.closed(KEYBOARD_SETTLE_MS)
  }
  // Opened again meanwhile: it stays.
  if (!open.value) {
    shown.value = false
    leaving.value = false
  }
}

function noteFieldLeft(event: FocusEvent): void {
  if (event.target instanceof HTMLElement && opensKeyboard(event.target)) fieldLeftAt = performance.now()
}

function openerOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return null
  // A menu item goes away with its menu: the way back is the button that opened the menu (Reka labels the menu with it).
  const menu = active.closest('[role="menu"]')
  const trigger = menu ? document.getElementById(menu.getAttribute('aria-labelledby') ?? '') : null
  return trigger ?? active
}

// A sheet with fields focuses the one named by the selector, not the first focusable thing. On a touch screen it waits
// for the slide-in to finish, so the keyboard doesn't arrive in the middle of it (Ionic focuses after a modal's present
// animation; Vaul leaves autofocus off). Focus goes to the sheet itself meanwhile (left alone it stays on the opener behind
// the modal for the length of the slide-in).
function focusInitial(event: Event): void {
  sheet = event.target instanceof HTMLElement ? event.target : null
  const el = sheet
  if (!props.initialFocus || !el) return
  const target = el.querySelector<HTMLElement>(props.initialFocus)
  if (!target) return
  event.preventDefault()
  el.focus({ preventScroll: true })
  if (!coarse.value) {
    target.focus()
    return
  }
  void Promise.all(el.getAnimations().map((a) => a.finished)).then(
    () => {
      const active = document.activeElement
      // Not when the sheet is leaving, or when a tap already put focus somewhere in it.
      if (open.value && el.isConnected && (active === el || !el.contains(active))) target.focus({ preventScroll: true })
    },
    // The slide-in was cancelled: the sheet closed before it was in.
    () => {},
  )
}

// The keyboard came or went (the viewport changed): the field being typed in stays in sight, scrolled inside the
// sheet. The visible bottom is the visual viewport's too, where the keyboard doesn't resize the page (iOS).
useEventListener(globalThis.visualViewport ?? undefined, 'resize', () => {
  const el = sheet
  const field = document.activeElement
  if (!shown.value || !el || !(field instanceof HTMLElement) || !el.contains(field) || !opensKeyboard(field)) return
  const box = el.getBoundingClientRect()
  const viewport = globalThis.visualViewport
  const bottom = Math.min(box.bottom, viewport ? viewport.offsetTop + viewport.height : box.bottom)
  const delta = revealDelta(field.getBoundingClientRect(), { top: box.top, bottom }, 16)
  if (delta !== 0) el.scrollTop += delta
})

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
  <Dialog :open="shown" @update:open="open = $event">
    <!-- A bottom sheet below 768 px that slides up, a centred window from 768 px that scales in; no movement under
         reduced motion. No transitions on it: the keyboard changes its max height, and that must not animate. -->
    <DialogContent
      :show-close-button="false"
      class="max-h-[calc(100dvh-1rem)] overflow-y-auto top-auto bottom-0 left-0 max-w-full translate-x-0 translate-y-0 rounded-b-none rounded-t-card border-x-0 border-b-0 p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] outline-none motion-safe:data-[state=open]:animate-sheet-in motion-safe:data-[state=closed]:animate-sheet-out motion-reduce:animate-none sm:max-w-full md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-[480px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border md:pb-5 md:motion-safe:data-[state=open]:animate-pop-in md:motion-safe:data-[state=closed]:animate-pop-out"
      :inert="leaving || undefined"
      :class="leaving && 'pointer-events-none'"
      :style="leavingHeight === null ? undefined : { height: `${leavingHeight}px` }"
      @escape-key-down="refuseWhileLocked"
      @pointer-down-outside="refuseWhileLocked"
      @interact-outside="refuseWhileLocked"
      @open-auto-focus="focusInitial"
      @close-auto-focus="returnFocus"
      @keydown="submitChord"
      @focusout="noteFieldLeft"
    >
      <!-- pr-10: the title stays clear of the close button. -->
      <DialogHeader class="pr-10 text-left">
        <DialogTitle class="text-lg font-semibold tracking-[-0.02em]">{{ title }}</DialogTitle>
        <DialogDescription :class="description ? 'text-subtle-foreground' : 'sr-only'">
          {{ description ?? title }}
        </DialogDescription>
      </DialogHeader>
      <p v-if="summary" class="-mt-1 text-sm font-semibold break-words">{{ summary }}</p>
      <slot />
      <DialogFooter v-if="$slots.footer" class="gap-2">
        <slot name="footer" />
      </DialogFooter>
      <!-- The close button: top right, a 44 px target, flat. Last in the DOM, so the sheet's first field or button still
           takes focus first. -->
      <button
        type="button"
        class="pressable absolute top-2 right-2 grid size-11 place-items-center text-icon hover:text-accent-ink disabled:pointer-events-none disabled:opacity-50"
        :aria-label="$t('ui.close')"
        :disabled="locked"
        @click="open = false"
      >
        <X class="size-5" aria-hidden="true" />
      </button>
    </DialogContent>
  </Dialog>
</template>

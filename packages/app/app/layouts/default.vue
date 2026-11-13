<script setup lang="ts">
import { until, useEventListener, useMediaQuery } from '@vueuse/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NAV_DRAWER_ID } from '~/composables/useShell'
import { launchAction, launchReady, showsTree } from '~/lib/shell'
import { swipeAction } from '~/lib/swipe'

const route = useRoute()
const { state } = useWorkspace()
const { drawerOpen, paletteOpen } = useShell()
const { dialog: folderDialog } = useFolderDialog()
const { dialog: itemDialog } = useItemDialog()
// Below 1024 px one column and the page scrolls; from 1024 px three full-height columns, each scrolling on its own.
const desktop = useMediaQuery('(min-width: 1024px)')
const { width: treeWidth } = useTreeWidth()
const withTree = computed(() => showsTree(typeof route.name === 'string' ? route.name : null))
// Launched from a PWA shortcut (`?action=add` / `?action=search`): open that UI once, then drop the parameter. Add needs
// a writable inventory; search needs one at all. Both wait for the workspace to load.
const quickAdd = useQuickAdd()
const router = useRouter()
const launch = launchAction(route.query)
if (launch) {
  void router.replace({ query: { ...route.query, action: undefined } })
  // A one-shot wait for an inventory whose source has finished connecting, so offline it already knows it is read-only
  // (never on the welcome page with no sources: it gives up after 10 s), dropped if the
  // user navigates first.
  const startPath = route.path
  void until(() => launchReady(state)).toBeTruthy({ timeout: 10_000, throwOnTimeout: false }).then(() => {
    if (!state.current || route.path !== startPath) return
    // A read-only inventory can't take new items; the quieter fallback is the search palette.
    if (launch === 'add' && !state.readOnly) quickAdd.open()
    else paletteOpen.value = true
  })
}
// Tooltips on icon buttons wait a moment, so moving across the header doesn't flash them.
const TOOLTIP_DELAY = 400

// An open layer other than the phone menu: the palette, a folder or item sheet, or any open Reka sheet or "⋯" menu.
const OTHER_LAYERS = `[role="dialog"][data-state="open"]:not(#${NAV_DRAWER_ID}), [role="menu"][data-state="open"]`
const layerOpen = (): boolean =>
  paletteOpen.value || folderDialog.value !== null || itemDialog.value !== null || document.querySelector(OTHER_LAYERS) !== null

// ⌘K / Ctrl+K opens the palette anywhere and closes it again. The physical K key counts on non-Latin layouts.
const isK = (e: KeyboardEvent): boolean =>
  e.key.toLowerCase() === 'k' || (e.code === 'KeyK' && !/^[a-z]$/i.test(e.key))
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat || !isK(e)) return
  if (paletteOpen.value) {
    e.preventDefault()
    paletteOpen.value = false
    return
  }
  // Not over another layer, and only with an inventory to search.
  if (!state.current || drawerOpen.value || layerOpen()) return
  e.preventDefault()
  paletteOpen.value = true
})

// Phone menu swipes (design 6.2), decided when the finger lifts; the menu doesn't follow it. Off while another layer is
// open and when the touch starts in a field.
const FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
let swipeStart: { x: number; y: number } | null = null
useEventListener(
  window,
  'touchstart',
  (e: TouchEvent) => {
    swipeStart = null
    const touch = e.touches[0]
    if (desktop.value || e.touches.length !== 1 || !touch || layerOpen()) return
    if (e.target instanceof Element && e.target.closest(FIELDS)) return
    swipeStart = { x: touch.clientX, y: touch.clientY }
  },
  { passive: true },
)
useEventListener(
  window,
  'touchend',
  (e: TouchEvent) => {
    const start = swipeStart
    swipeStart = null
    const touch = e.changedTouches[0]
    // A long press may have opened a sheet meanwhile.
    if (!start || !touch || desktop.value || layerOpen()) return
    const action = swipeAction(start, { x: touch.clientX, y: touch.clientY }, drawerOpen.value)
    if (action) drawerOpen.value = action === 'open'
  },
  { passive: true },
)
useEventListener(
  window,
  'touchcancel',
  () => {
    swipeStart = null
  },
  { passive: true },
)
</script>

<template>
  <TooltipProvider :delay-duration="TOOLTIP_DELAY">
    <div
      :class="[
        'min-h-dvh text-foreground lg:grid lg:h-dvh lg:overflow-hidden',
        withTree ? '' : 'lg:grid-cols-[212px_minmax(0,1fr)]',
      ]"
      :style="withTree ? { gridTemplateColumns: `212px ${treeWidth}px minmax(0, 1fr)` } : undefined"
    >
      <div v-if="desktop" class="surface-rail min-h-0 overflow-y-auto">
        <AppNav variant="rail" />
      </div>
      <TreePanel v-if="desktop && withTree" />
      <div class="min-w-0 lg:min-h-0 lg:overflow-y-auto">
        <slot />
      </div>
      <MobileDock />
      <NavDrawer />
      <FolderDialogs />
      <ItemDialogs />
      <QuickAddSheet />
      <ReceiveSheet />
      <ShareSheet />
      <SearchPalette />
    </div>
  </TooltipProvider>
</template>

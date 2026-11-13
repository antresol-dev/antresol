<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { DialogOverlay } from '@/components/ui/dialog'
import { MENU_BUTTON_ID, NAV_DRAWER_ID } from '~/composables/useShell'

const { drawerOpen } = useShell()
const router = useRouter()
const desktop = useMediaQuery('(min-width: 1024px)')

// Any navigation closes the drawer: a new route.fullPath, and also a tap on the row that is already open.
onScopeDispose(
  router.afterEach(() => {
    drawerOpen.value = false
  }),
)
// The three-column layout has no drawer.
watch(desktop, (wide) => {
  if (wide) drawerOpen.value = false
})
// The Android back gesture closes the drawer instead of leaving the screen.
useCloseWatcher(drawerOpen)

// The drawer has no DialogTrigger, so Reka would drop focus to <body>: return it to ☰ (Esc, the scrim, back gesture).
function returnFocus(event: Event): void {
  const button = document.getElementById(MENU_BUTTON_ID)
  if (!button) return
  event.preventDefault()
  button.focus()
}
</script>

<template>
  <DialogRoot v-model:open="drawerOpen">
    <DialogPortal>
      <DialogOverlay />
      <DialogContent
        :id="NAV_DRAWER_ID"
        :aria-describedby="undefined"
        class="fixed inset-y-0 left-0 z-50 flex w-[86%] max-w-[340px] flex-col bg-rail pb-[env(safe-area-inset-bottom)] shadow-xl outline-none motion-safe:data-[state=open]:animate-drawer-in motion-safe:data-[state=closed]:animate-drawer-out motion-reduce:animate-none"
        @close-auto-focus="returnFocus"
      >
        <DialogTitle class="sr-only">{{ $t('nav.menu') }}</DialogTitle>
        <AppNav variant="drawer" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

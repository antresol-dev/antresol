<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { Plus, Search } from '@lucide/vue'
import { currentInventoryName, sectionOf } from '~/lib/shell'

const { state } = useWorkspace()
const { paletteOpen } = useShell()
const route = useRoute()
const quickAdd = useQuickAdd()

// Below 1024 px, on every section of the app once an inventory is chosen. "+" (quick add) joins it on the folder and
// item screens when the inventory can be written to.
const section = computed(() => sectionOf(typeof route.name === 'string' ? route.name : null))
const shown = computed(() => !!state.current && section.value !== null)
const canAdd = computed(() => section.value === 'items' && !state.readOnly)
const name = computed(() => currentInventoryName(state))

// The dock's full height (bar, fade strip, safe area) as --dock-h on <html>, so the toasts, rendered elsewhere, sit above it.
const dock = ref<HTMLElement | null>(null)
const { height } = useElementSize(dock, undefined, { box: 'border-box' })
watchEffect(() => {
  const root = document.documentElement.style
  if (dock.value && height.value > 0) root.setProperty('--dock-h', `${height.value}px`)
  else root.removeProperty('--dock-h')
})
onBeforeUnmount(() => document.documentElement.style.removeProperty('--dock-h'))
</script>

<template>
  <!-- The strip fades to transparent upwards and lets taps through; only the bar takes them. -->
  <div
    v-if="shown"
    ref="dock"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-linear-to-t from-background from-70% to-transparent pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:hidden"
  >
    <div class="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4">
      <button
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="paletteOpen"
        class="raised pressable pointer-events-auto flex h-14 min-w-0 flex-1 items-center gap-2 px-4 text-left text-base font-semibold text-muted-foreground hover:text-accent-ink"
        @click="paletteOpen = true"
      >
        <Search class="size-5 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ $t('search.field', { name }) }}</span>
      </button>
      <button
        v-if="canAdd"
        type="button"
        :aria-label="$t('quickAdd.title')"
        class="accent-button pressable pointer-events-auto grid size-14 shrink-0 place-items-center"
        @click="quickAdd.open()"
      >
        <Plus class="size-6" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

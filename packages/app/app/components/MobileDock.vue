<script setup lang="ts">
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
</script>

<template>
  <!-- The strip fades to transparent upwards and lets taps through; only the bar takes them. -->
  <div
    v-if="shown"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-linear-to-t from-background from-70% to-transparent pt-3.5 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:hidden"
  >
    <div class="mx-auto flex w-full max-w-[720px] items-center gap-2.5 px-4">
      <button
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="paletteOpen"
        class="pointer-events-auto flex h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-[18px] border border-border bg-surface px-4 text-left text-[15px] font-semibold text-muted-foreground shadow-sm outline-none transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        @click="paletteOpen = true"
      >
        <Search class="size-[18px] shrink-0" aria-hidden="true" />
        <span class="truncate">{{ $t('search.field', { name }) }}</span>
      </button>
      <button
        v-if="canAdd"
        type="button"
        :aria-label="$t('quickAdd.title')"
        class="pointer-events-auto grid size-[52px] shrink-0 place-items-center rounded-fab bg-primary text-primary-foreground shadow-md outline-none transition-colors duration-150 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        @click="quickAdd.open()"
      >
        <Plus class="size-6" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

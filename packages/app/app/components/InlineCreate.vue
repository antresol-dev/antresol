<script setup lang="ts">
import { X } from '@lucide/vue'

// A create form shown inside a sheet, under the control that opened it ("New attribute…" in a select). It has a title
// and a × in the top-right corner, styled as AppSheet's own close button: cancelling closes the form and creates
// nothing, and the host puts focus back on the control. Esc inside the form cancels it only (not the sheet around it).
defineProps<{
  title: string
  closeLabel: string
  /** The form is saving: it can't be cancelled. */
  busy?: boolean
}>()
const emit = defineEmits<{ cancel: [] }>()
</script>

<template>
  <section class="grid gap-4" :aria-label="title" @keydown.esc.stop.prevent="!busy && emit('cancel')">
    <header class="flex min-h-11 items-center justify-between gap-2">
      <h3 class="min-w-0 truncate text-sm font-semibold">{{ title }}</h3>
      <button
        type="button"
        class="pressable -mr-2 grid size-11 shrink-0 place-items-center text-icon hover:text-accent-ink disabled:pointer-events-none disabled:opacity-50"
        :aria-label="closeLabel"
        :disabled="busy"
        @click="emit('cancel')"
      >
        <X class="size-5" aria-hidden="true" />
      </button>
    </header>
    <slot />
  </section>
</template>

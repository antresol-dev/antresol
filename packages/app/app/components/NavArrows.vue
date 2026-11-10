<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue'

const { canBack, canForward, back, forward } = useNavHistory()

const button =
  'grid size-11 shrink-0 place-items-center rounded-field text-icon outline-none transition-[background-color,color,opacity] duration-150 enabled:hover:bg-hover enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35'
</script>

<template>
  <div class="flex shrink-0 items-center">
    <button type="button" :class="button" :aria-label="$t('nav.back')" :disabled="!canBack" @click="back">
      <ChevronLeft class="size-5" aria-hidden="true" />
    </button>
    <button type="button" :class="button" :aria-label="$t('nav.forward')" :disabled="!canForward" @click="forward">
      <ChevronRight class="size-5" aria-hidden="true" />
    </button>
  </div>
</template>

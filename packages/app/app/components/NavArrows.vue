<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { canBack, canForward, back, forward } = useNavHistory()

const arrows = computed(() => [
  { key: 'back', label: 'nav.back', icon: ChevronLeft, enabled: canBack.value, go: back },
  { key: 'forward', label: 'nav.forward', icon: ChevronRight, enabled: canForward.value, go: forward },
])

const button =
  'grid size-11 shrink-0 place-items-center rounded-field text-icon outline-none transition-[background-color,color,opacity] duration-150 enabled:hover:bg-hover enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35'
</script>

<template>
  <div class="flex shrink-0 items-center">
    <Tooltip v-for="a in arrows" :key="a.key">
      <TooltipTrigger as-child>
        <button type="button" :class="button" :aria-label="$t(a.label)" :disabled="!a.enabled" @click="a.go">
          <component :is="a.icon" class="size-5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ $t(a.label) }}</TooltipContent>
    </Tooltip>
  </div>
</template>

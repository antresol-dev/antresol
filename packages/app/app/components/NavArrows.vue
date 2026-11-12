<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { canBack, canForward, back, forward } = useNavHistory()

const arrows = computed(() => [
  { key: 'back', label: 'nav.back', icon: ChevronLeft, enabled: canBack.value, go: back },
  { key: 'forward', label: 'nav.forward', icon: ChevronRight, enabled: canForward.value, go: forward },
])

// Flat like browser arrows (the screen's own actions are the raised ones); 32 px wide below 1024 px to leave the top bar
// room for them.
const button = 'pressable grid h-11 w-8 shrink-0 place-items-center rounded-chip text-icon enabled:hover:text-accent-ink disabled:opacity-35 lg:w-11'
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

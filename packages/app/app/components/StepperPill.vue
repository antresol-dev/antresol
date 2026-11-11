<script setup lang="ts">
import { Minus, Plus } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BucketStepper } from '~/composables/useItemSteppers'
import { buzz } from '~/lib/stepper'

// One pill [− | +] (the stock card) or [− 100 pcs +] (a variant row; the number opens Count). 44 px zones. Only this
// bucket locks while a write to it runs (spec 4.12); the rest of the app stays usable.
const props = defineProps<{
  stepper: BucketStepper
  /** The variant's label for the buttons' names; null on the stock card. */
  name: string | null
  /** The confirmed stock between the buttons (variant rows). */
  amount?: { number: string; unit: string } | null
}>()
const emit = defineEmits<{ count: [] }>()

const { t } = useI18n()
const workspace = useWorkspace()

const busy = computed(() => {
  const st = props.stepper.state.value
  return st === 'sending' || st === 'failed' || workspace.isBucketSaving(props.stepper.itemId, props.stepper.variantId)
})
const locked = computed(() => !!workspace.state.readOnly || busy.value)

const minusLabel = computed(() => (props.name === null ? t('stockActions.useOne') : t('stockActions.useOneOf', { name: props.name })))
const plusLabel = computed(() => (props.name === null ? t('stockActions.addOne') : t('stockActions.addOneOf', { name: props.name })))

function press(step: 1 | -1): void {
  buzz()
  props.stepper.press(step)
}
const zone = 'size-11 shrink-0 rounded-full'
</script>

<template>
  <div class="flex shrink-0 items-center rounded-full border border-border bg-surface" :aria-busy="busy || undefined">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          size="icon"
          :class="zone"
          :aria-label="minusLabel"
          :disabled="locked || !stepper.canDecrease.value"
          @click="press(-1)"
        >
          <Minus class="size-5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ $t('stockActions.useOne') }}</TooltipContent>
    </Tooltip>
    <button
      v-if="amount"
      type="button"
      class="flex min-h-11 min-w-14 items-center justify-center rounded-md px-1 text-[15px] font-bold tabular-nums outline-none transition-colors duration-150 enabled:cursor-pointer enabled:hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      :aria-label="$t('stock.countAmount', { amount: `${amount.number} ${amount.unit}` })"
      :disabled="!!workspace.state.readOnly"
      @click="emit('count')"
    >
      <span class="flex items-baseline gap-1">
        {{ amount.number }}
        <span class="text-xs font-semibold text-muted-foreground">{{ amount.unit }}</span>
      </span>
    </button>
    <span v-else class="h-6 w-px shrink-0 bg-divider" aria-hidden="true" />
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon" :class="zone" :aria-label="plusLabel" :disabled="locked" @click="press(1)">
          <Plus class="size-5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ $t('stockActions.addOne') }}</TooltipContent>
    </Tooltip>
  </div>
</template>

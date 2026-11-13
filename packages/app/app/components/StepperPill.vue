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
// The pill (R(3,8), radius 14) and its halves: each sinks as its own rectangle, rounded on the pill's outer side only.
const zone = 'pill-step size-11 shrink-0'
</script>

<template>
  <div class="pill shrink-0 items-center" :aria-busy="busy || undefined">
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
      class="pill-step pressable flex min-h-11 min-w-18 items-center justify-center rounded-none px-1 text-base amount tabular-nums disabled:opacity-60"
      :aria-label="$t('stock.countAmount', { amount: `${amount.number} ${amount.unit}` })"
      :disabled="!!workspace.state.readOnly"
      @click="emit('count')"
    >
      <span class="flex items-baseline gap-1">
        {{ amount.number }}
        <span class="text-xs font-semibold text-muted-foreground">{{ amount.unit }}</span>
      </span>
    </button>
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

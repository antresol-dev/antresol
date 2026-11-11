<script setup lang="ts">
import { formatAmountParts, type UnitDef } from '@graymatter/core'
import { Loader2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { signedAmount, STEP_DELAY_MS, type BucketStepper } from '~/composables/useItemSteppers'

// The pending delta of a stepper, shown as pending (spec 4.12; anti-goal 1): "+3 → 48" with a ring counting down to the
// send and Undo; "Saving…" while it is on its way; red text with Retry and Discard when the send failed.
const props = defineProps<{ stepper: BucketStepper; unit: UnitDef }>()

const state = computed(() => props.stepper.state.value)
const delta = computed(() => signedAmount(props.stepper.pending.value, props.unit))
const total = computed(() => formatAmountParts(props.stepper.projected.value, props.unit))
// The delta's unit only when its prefix differs from the total's ("+50 cm → 2.5 m", but "+3 → 48 pcs").
const deltaUnit = computed(() => (delta.value.unit === total.value.unit ? '' : ` ${delta.value.unit}`))

const RING = 2 * Math.PI * 8
const action = 'h-11 rounded-field px-3 font-bold'
</script>

<template>
  <div
    v-if="state !== 'idle'"
    role="status"
    class="flex min-w-0 flex-wrap items-center gap-x-2 text-sm"
    :style="{ '--ring': `${RING}`, '--ring-time': `${STEP_DELAY_MS}ms` }"
  >
    <span class="flex min-h-11 min-w-0 items-center gap-2 font-semibold tabular-nums" :class="state === 'failed' && 'text-destructive'">
      <svg
        v-if="state === 'waiting'"
        :key="stepper.due.value ?? 0"
        class="size-5 shrink-0 -rotate-90 text-muted-foreground"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.5" />
        <circle class="countdown" cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2.5" :stroke-dasharray="RING" />
      </svg>
      <Loader2 v-else-if="state === 'sending'" class="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
      <span v-if="state === 'failed'">{{ $t('stock.notSaved') }}</span>
      <span class="whitespace-nowrap">
        {{ $t('stock.pending', { delta: `${delta.number}${deltaUnit}`, total: total.number }) }}
        <span class="text-xs" :class="state !== 'failed' && 'text-muted-foreground'">{{ total.unit }}</span>
      </span>
      <span v-if="state === 'sending'" class="text-muted-foreground">{{ $t('status.saving') }}</span>
    </span>
    <span class="ml-auto flex shrink-0 items-center gap-1">
      <Button v-if="state === 'waiting'" variant="ghost" :class="action" @click="stepper.undo()">{{ $t('stock.undo') }}</Button>
      <template v-else-if="state === 'failed'">
        <Button variant="ghost" :class="action" @click="stepper.retry()">{{ $t('stock.retry') }}</Button>
        <Button variant="ghost" :class="action" @click="stepper.discard()">{{ $t('stock.discard') }}</Button>
      </template>
    </span>
  </div>
</template>

<style scoped>
.countdown {
  stroke-dashoffset: 0;
  animation: countdown var(--ring-time) linear forwards;
}
@keyframes countdown {
  to {
    stroke-dashoffset: var(--ring);
  }
}
@media (prefers-reduced-motion: reduce) {
  .countdown {
    animation: none;
  }
}
</style>

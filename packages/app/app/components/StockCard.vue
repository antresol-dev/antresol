<script setup lang="ts">
import type { UnitDef } from '@antresol/core'
import { Button } from '@/components/ui/button'
import type { BucketStepper } from '~/composables/useItemSteppers'
import { countedAgo } from '~/lib/counted'
import { formatUnitPrice } from '~/lib/format'
import type { ItemView } from '~/lib/item-view'
import type { StockMode } from '~/lib/stock-forms'

// The stock card (spec 4.12): the big number on the left (a tap opens Count), one pill [− | +] on the right, then
// "Receive · Use · Count". Under the number: prices and when the stock was last counted. With variants the card shows
// the total only: every variant row has its own pill.
const props = defineProps<{
  total: ItemView['total']
  /** Prices are per one base unit (pcs, m), whatever prefix the total shows. */
  unit: UnitDef
  currency: string
  /** The stepper of the stock kept without a variant; null for an item with variants. */
  stepper: BucketStepper | null
  /** The last recount (all buckets shown counted), or null. */
  countedAt: string | null
  /** How many active variants the total adds up (0 without variants): a small note after the unit. */
  variantCount?: number
}>()

const emit = defineEmits<{ open: [mode: StockMode]; count: [] }>()

const { t } = useI18n()
const { state } = useWorkspace()
const readOnly = computed(() => !!state.readOnly)

const prices = computed(() => {
  const { avgUnitPrice: avg, lastUnitPrice: last } = props.total
  const price = (minor: number): string => formatUnitPrice(minor, props.currency)
  const each = props.unit.key === 'pcs'
  return [
    avg === null ? null : each ? t('stock.avgEach', { price: price(avg) }) : t('stock.avgPer', { price: price(avg), unit: props.unit.symbol }),
    last === null ? null : t('stock.last', { price: price(last) }),
  ]
    .filter((x): x is string => x !== null)
    .join(' · ')
})

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const counted = computed(() => {
  if (!props.countedAt) return null
  const ago = countedAgo(props.countedAt, new Date())
  return t('stock.counted', { when: relative.format(-ago.value, ago.unit) })
})

const amountClass = 'flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-left'
const numberClass = 'amount text-[32px] leading-none tracking-[-0.02em] tabular-nums wrap-anywhere'
const action = 'h-11 min-w-0 px-2 font-bold'
</script>

<template>
  <!-- data-stock is the card's state for the styles' CSS (Tinkerer's LED): "out" at zero or less, otherwise "ok". There is no
       "low" state: the app has no reorder threshold. -->
  <section class="stock-card raised-card grid min-w-0 gap-3 p-4.5" :data-stock="total.outOfStock ? 'out' : 'ok'" :aria-label="$t('item.stock')">
    <div class="flex min-w-0 items-start justify-between gap-3">
      <div class="grid min-w-0 gap-1.5">
        <!-- With a stepper the number is a flat button that opens Count. -->
        <button
          v-if="stepper"
          type="button"
          :class="[amountClass, 'pressable -mx-1.5 -my-1 justify-self-start rounded-chip px-1.5 py-1']"
          :aria-label="$t('stock.countAmount', { amount: `${total.number} ${total.unit}` })"
          :disabled="readOnly"
          @click="emit('count')"
        >
          <span :class="[numberClass, total.outOfStock && 'text-muted-foreground']">{{ total.number }}</span>
          <span class="text-sm leading-none font-semibold text-muted-foreground">{{ total.unit }}</span>
          <span v-if="total.outOfStock" class="ml-1.5 text-sm leading-none font-semibold text-muted-foreground">{{ $t('item.outOfStock') }}</span>
        </button>
        <p v-else :class="amountClass">
          <span :class="[numberClass, total.outOfStock && 'text-muted-foreground']">{{ total.number }}</span>
          <span class="text-sm leading-none font-semibold text-muted-foreground">{{ total.unit }}</span>
          <span v-if="total.outOfStock" class="ml-1.5 text-sm leading-none font-semibold text-muted-foreground">{{ $t('item.outOfStock') }}</span>
          <span v-if="variantCount" class="text-sm leading-none text-subtle-foreground">· {{ $t('item.variants', variantCount) }}</span>
        </p>
        <p v-if="prices" class="text-[13px] text-muted-foreground tabular-nums">{{ prices }}</p>
        <p v-if="counted" class="text-[13px] text-muted-foreground">{{ counted }}</p>
      </div>
      <StepperPill v-if="stepper" :stepper="stepper" :name="null" />
    </div>
    <PendingChip v-if="stepper && stepper.state.value !== 'idle'" :stepper="stepper" :unit="unit" />
    <div v-if="stepper" class="grid grid-cols-3 gap-4">
      <Button variant="outline" :class="action" :disabled="readOnly" @click="emit('open', 'receive')">{{ $t('stockActions.receive') }}</Button>
      <Button variant="outline" :class="action" :disabled="readOnly" @click="emit('open', 'use')">{{ $t('stockActions.use') }}</Button>
      <Button variant="outline" :class="action" :disabled="readOnly" @click="emit('count')">{{ $t('stock.count') }}</Button>
    </div>
  </section>
</template>

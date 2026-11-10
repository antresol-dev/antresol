<script setup lang="ts">
import { Minus, PencilLine, Plus } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatUnitPrice } from '~/lib/format'
import type { ItemView } from '~/lib/item-view'
import type { StockMode } from '~/lib/stock-forms'

const props = defineProps<{
  total: ItemView['total']
  /** Prices are per one base unit (pcs, m), whatever prefix the total shows. */
  unitSymbol: string
  currency: string
  /** Quick buttons for an item without variants; with variants every row has its own. */
  controls: boolean
}>()

const emit = defineEmits<{ step: [step: 'plus' | 'minus']; open: [mode: StockMode] }>()

const { t } = useI18n()
const { state } = useWorkspace()
const locked = computed(() => !!state.readOnly || state.saving)
const setAction = computed(() => [{ key: 'set', label: t('stockActions.setQuantity'), icon: PencilLine }])

const prices = computed(() => {
  const { avgUnitPrice: avg, lastUnitPrice: last } = props.total
  const price = (minor: number): string => formatUnitPrice(minor, props.currency)
  return [
    avg === null ? null : t('item.avgPrice', { price: price(avg), unit: props.unitSymbol }),
    last === null ? null : t('item.lastPrice', { price: price(last), unit: props.unitSymbol }),
  ]
    .filter((x): x is string => x !== null)
    .join(' · ')
})
</script>

<template>
  <section class="grid min-w-0 gap-2 rounded-card border border-border bg-surface p-4" :aria-label="$t('item.stock')">
    <p class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
      <span
        class="text-[32px] leading-none font-bold tracking-[-0.02em] tabular-nums wrap-anywhere"
        :class="total.outOfStock && 'text-muted-foreground'"
      >{{ total.number }}</span>
      <span class="text-sm font-semibold text-muted-foreground">{{ total.unit }}</span>
      <span v-if="total.outOfStock" class="ml-1.5 text-sm font-semibold text-muted-foreground">{{ $t('item.outOfStock') }}</span>
    </p>
    <p v-if="prices" class="text-[13px] text-muted-foreground tabular-nums">{{ prices }}</p>
    <div v-if="controls" class="mt-1 flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="icon"
            class="size-11 rounded-field bg-surface"
            :aria-label="$t('stockActions.useOne')"
            :disabled="locked || total.outOfStock"
            @click="emit('step', 'minus')"
          >
            <Minus class="size-5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t('stockActions.useOne') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="icon"
            class="size-11 rounded-field bg-surface"
            :aria-label="$t('stockActions.addOne')"
            :disabled="locked"
            @click="emit('step', 'plus')"
          >
            <Plus class="size-5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ $t('stockActions.addOne') }}</TooltipContent>
      </Tooltip>
      <Button variant="outline" class="h-11 rounded-field bg-surface px-4 font-bold" :disabled="locked" @click="emit('open', 'receive')">
        {{ $t('stockActions.receive') }}
      </Button>
      <Button variant="outline" class="h-11 rounded-field bg-surface px-4 font-bold" :disabled="locked" @click="emit('open', 'use')">
        {{ $t('stockActions.use') }}
      </Button>
      <RowMenu
        class="size-11"
        :label="$t('stockActions.moreFor')"
        :actions="setAction.map((a) => ({ ...a, disabled: locked }))"
        @select="emit('open', 'set')"
      />
    </div>
  </section>
</template>

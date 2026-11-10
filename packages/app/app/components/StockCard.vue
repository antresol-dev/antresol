<script setup lang="ts">
import { formatUnitPrice } from '~/lib/format'
import type { ItemView } from '~/lib/item-view'

const props = defineProps<{
  total: ItemView['total']
  /** Prices are per one base unit (pcs, m), whatever prefix the total shows. */
  unitSymbol: string
  currency: string
}>()

const { t } = useI18n()

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
  </section>
</template>

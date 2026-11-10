<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import type { Component } from 'vue'
import { ArrowRightLeft, Download, Minus, PencilLine, Plus, Upload } from '@lucide/vue'
import type { Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BucketRow } from '~/lib/item-view'
import type { StockMode } from '~/lib/stock-forms'

const props = defineProps<{
  buckets: BucketRow[]
  /** Variant to mark and scroll to (from ?variant=). */
  highlight: string | null
}>()

const emit = defineEmits<{ step: [step: 'plus' | 'minus', variantId: Id | null]; open: [mode: StockMode, variantId: Id | null] }>()

const { t } = useI18n()
const { state } = useWorkspace()
const locked = computed(() => !!state.readOnly || state.saving)

function actionsOf(row: BucketRow): { key: StockMode; label: string; icon: Component; disabled: boolean }[] {
  const all = [
    { key: 'receive' as const, label: t('stockActions.receive'), icon: Download },
    { key: 'use' as const, label: t('stockActions.use'), icon: Upload },
    { key: 'set' as const, label: t('stockActions.setQuantity'), icon: PencilLine },
    ...(props.buckets.length > 1 ? [{ key: 'transfer' as const, label: t('stockActions.moveTo'), icon: ArrowRightLeft }] : []),
  ]
  return all.map((a) => ({ ...a, disabled: locked.value || (a.key === 'use' && row.outOfStock) }))
}
const stepButton = 'size-11 shrink-0 rounded-field'

const rows = computed(() =>
  props.buckets.map((b) => ({
    ...b,
    key: b.variantId ?? 'none',
    sub: [...b.values.map((v) => v.value), b.description].filter((x): x is string => !!x).join(' · '),
  })),
)

const list = useTemplateRef<HTMLElement>('list')
const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

async function reveal(): Promise<void> {
  const id = props.highlight
  if (!id) return
  await nextTick()
  const row = list.value?.querySelector<HTMLElement>(`[data-variant="${CSS.escape(id)}"]`)
  row?.scrollIntoView({ block: 'center', behavior: reduceMotion.value ? 'auto' : 'smooth' })
}
onMounted(reveal)
watch(() => props.highlight, reveal)
</script>

<template>
  <section class="grid min-w-0 grid-cols-1 gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-subtle-foreground">{{ $t('item.variantsTitle') }}</h2>
    <ul ref="list" class="overflow-hidden rounded-card border border-border bg-surface py-1">
      <li
        v-for="row in rows"
        :key="row.key"
        :data-variant="row.variantId ?? undefined"
        :aria-current="row.variantId !== null && row.variantId === highlight ? 'true' : undefined"
        :class="[
          'relative flex min-h-[62px] items-center gap-3 px-3.5 py-2',
          'not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-[\'\']',
          row.variantId !== null && row.variantId === highlight && 'bg-accent-soft',
        ]"
      >
        <span class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[15px] font-bold" :class="row.outOfStock && 'text-dimmed-foreground'">
            {{ row.name ?? $t('item.noVariant') }}
          </span>
          <span v-if="row.sub" class="truncate text-[13px] text-muted-foreground">{{ row.sub }}</span>
        </span>
        <span class="shrink-0 text-base font-bold tabular-nums" :class="row.outOfStock && 'text-muted-foreground'">
          {{ row.number }}
          <span class="text-xs font-semibold text-muted-foreground">{{ row.unit }}</span>
        </span>
        <span class="flex shrink-0 items-center">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                :class="stepButton"
                :aria-label="$t('stockActions.useOneOf', { name: row.name ?? $t('item.noVariant') })"
                :disabled="locked || row.outOfStock"
                @click="emit('step', 'minus', row.variantId)"
              >
                <Minus class="size-5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ $t('stockActions.useOne') }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                :class="stepButton"
                :aria-label="$t('stockActions.addOneOf', { name: row.name ?? $t('item.noVariant') })"
                :disabled="locked"
                @click="emit('step', 'plus', row.variantId)"
              >
                <Plus class="size-5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ $t('stockActions.addOne') }}</TooltipContent>
          </Tooltip>
          <RowMenu
            class="size-11"
            :label="row.name ?? $t('item.noVariant')"
            :actions="actionsOf(row)"
            @select="(key) => emit('open', key as StockMode, row.variantId)"
          />
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import type { Component } from 'vue'
import { Archive, ArrowRightLeft, Camera, Download, Pencil, PencilLine, SlidersHorizontal, Upload } from '@lucide/vue'
import type { Id, UnitDef } from '@graymatter/core'
import type { BucketStepper } from '~/composables/useItemSteppers'
import type { BucketRow } from '~/lib/item-view'
import type { StockMode } from '~/lib/stock-forms'

const props = defineProps<{
  buckets: BucketRow[]
  /** Variant to mark and scroll to (from ?variant=). */
  highlight: string | null
  /** Each row's deferred stepper (spec 4.12). */
  stepperOf: (variantId: Id | null) => BucketStepper
  unit: UnitDef
}>()

const emit = defineEmits<{
  open: [mode: StockMode, variantId: Id | null]
  rename: [variantId: Id]
  attributes: [variantId: Id]
  photo: [variantId: Id]
  archive: [variantId: Id]
}>()

const { t } = useI18n()
const { state } = useWorkspace()
// Menus open sheets: those wait for their own write; only read-only turns them off.
const locked = computed(() => !!state.readOnly)

type MenuKey = StockMode | 'rename' | 'archive' | 'attributes' | 'photo'

function actionsOf(row: BucketRow): { key: MenuKey; label: string; icon: Component; destructive?: boolean; disabled: boolean }[] {
  const all: { key: MenuKey; label: string; icon: Component; destructive?: boolean }[] = [
    { key: 'receive', label: t('stockActions.receive'), icon: Download },
    { key: 'use', label: t('stockActions.use'), icon: Upload },
    { key: 'set', label: t('stock.count'), icon: PencilLine },
    ...(props.buckets.length > 1 ? [{ key: 'transfer' as const, label: t('stockActions.moveTo'), icon: ArrowRightLeft }] : []),
    // The stock kept without a variant is not a variant: nothing to rename or archive.
    ...(row.variantId !== null
      ? [
          ...(row.values.length > 0 ? [{ key: 'attributes' as const, label: t('variantMenu.attributes'), icon: SlidersHorizontal }] : []),
          { key: 'photo' as const, label: t('variantMenu.photo'), icon: Camera },
          { key: 'rename' as const, label: t('variantMenu.rename'), icon: Pencil },
          { key: 'archive' as const, label: t('variantMenu.archive'), icon: Archive, destructive: true },
        ]
      : []),
  ]
  return all.map((a) => ({ ...a, disabled: locked.value || (a.key === 'use' && row.outOfStock) }))
}

function choose(key: string, row: BucketRow): void {
  if (key === 'rename') {
    if (row.variantId !== null) emit('rename', row.variantId)
  } else if (key === 'attributes') {
    if (row.variantId !== null) emit('attributes', row.variantId)
  } else if (key === 'photo') {
    if (row.variantId !== null) emit('photo', row.variantId)
  } else if (key === 'archive') {
    if (row.variantId !== null) emit('archive', row.variantId)
  } else emit('open', key as StockMode, row.variantId)
}
const rows = computed(() =>
  props.buckets.map((b) => ({
    ...b,
    key: b.variantId ?? 'none',
    sub: b.description ?? '',
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
  <section class="grid min-w-0 grid-cols-1" :aria-label="$t('item.variantsTitle')">
    <ul ref="list" class="overflow-hidden rounded-card border border-border bg-surface py-1">
      <li
        v-for="row in rows"
        :key="row.key"
        :data-variant="row.variantId ?? undefined"
        :aria-current="row.variantId !== null && row.variantId === highlight ? 'true' : undefined"
        :class="[
          'relative grid min-w-0 px-3.5 py-2',
          'not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-[\'\']',
          row.variantId !== null && row.variantId === highlight && 'bg-accent-soft',
        ]"
      >
        <div class="flex min-h-[46px] min-w-0 items-center gap-2.5">
          <PhotoImg
            v-if="row.photo"
            :url="row.photo.url"
            size="thumb"
            alt=""
            class="size-10 shrink-0 rounded-icon object-cover"
          />
          <span class="flex min-w-0 grow flex-col gap-0.5">
            <span class="line-clamp-2 text-[15px] font-bold wrap-anywhere" :class="row.outOfStock && 'text-dimmed-foreground'">
              {{ row.name ?? $t('item.noVariant') }}
            </span>
            <span v-if="row.sub" class="truncate text-[13px] text-muted-foreground">{{ row.sub }}</span>
          </span>
          <StepperPill
            :stepper="stepperOf(row.variantId)"
            :name="row.name ?? $t('item.noVariant')"
            :amount="{ number: row.number, unit: row.unit }"
            @count="emit('open', 'set', row.variantId)"
          />
          <RowMenu
            class="-mr-1.5 size-11"
            :label="row.name ?? $t('item.noVariant')"
            :actions="actionsOf(row)"
            @select="(key) => choose(key, row)"
          />
        </div>
        <PendingChip v-if="stepperOf(row.variantId).state.value !== 'idle'" :stepper="stepperOf(row.variantId)" :unit="unit" />
      </li>
    </ul>
  </section>
</template>

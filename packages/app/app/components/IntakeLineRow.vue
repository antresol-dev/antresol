<script setup lang="ts">
import {
  BUILTIN_UNITS,
  bucketStock,
  formatAmount,
  formatAmountParts,
  formatAttributeValue,
  isCanonicalNumber,
  itemStock,
  intakeUnits,
  resolveUnit,
  type DraftLine,
  type IntakeDraftContent,
  type InventorySnapshot,
  type LineResolution,
} from '@antresol/core'
import { formatMoney } from '~/lib/format'
import { existingMatches } from '~/lib/quick-add'
import type { PhotoRef } from '~/lib/photo-url'
import { snapshotIndex } from '~/lib/views'

// One line of a draft intake (spec 2026-11-13 intakes §5): the picture, "TL072 · 4.7 kΩ" over "have 6 · Op-amps", and on the
// right "+10 pcs" over the ADD/NEW tag. A tap opens the line.
const props = defineProps<{
  line: DraftLine
  resolution: LineResolution
  /** A problem code from the last commit attempt, over the line's own resolution. */
  problem: string | null
  snapshot: InventorySnapshot
  content: IntakeDraftContent
}>()
defineEmits<{ open: [] }>()

const { t, te } = useI18n()

const ix = computed(() => snapshotIndex(props.snapshot))
const newItem = computed(() => props.content.newItems.find((n) => n.id === props.line.itemId) ?? null)
const item = computed(() => (newItem.value ? null : (ix.value.items.get(props.line.itemId) ?? null)))
const unit = computed(() => resolveUnit(newItem.value?.unitKey ?? item.value?.unitKey ?? 'pcs', intakeUnits(props.content, props.snapshot)) ?? BUILTIN_UNITS.pcs)
const name = computed(() => newItem.value?.name ?? item.value?.name ?? t('intakes.problem.unknown_item'))

/** The line's values as the attributes show them: "4.7 kΩ · 50 V". */
const values = computed(() =>
  props.line.axisValues
    .map(({ attributeId, value }) => {
      const a = props.snapshot.attributes.find((x) => x.id === attributeId)
      return a && (a.kind !== 'number' || isCanonicalNumber(value)) ? formatAttributeValue(a, value) : value
    })
    .join(' · '),
)

/** The line's picture: its own photo (a new variant's, or an older draft's), else the new item's photo, else the photo the
 *  inventory already has for the variant or the item; with none, the item's icon or letters (ItemThumb). */
const cover = computed<PhotoRef | null>(() => {
  if (props.line.photo) return props.line.photo
  if (newItem.value) return newItem.value.photos?.[0] ?? null
  const r = props.resolution
  const variantId = r.kind === 'add' ? r.variantId : null
  return (variantId !== null ? ix.value.variantCovers.get(variantId) : undefined) ?? ix.value.covers.get(props.line.itemId) ?? null
})
const thumbFolderId = computed(() => newItem.value?.folderId ?? item.value?.folderId ?? null)
const thumbFolder = computed(() => (thumbFolderId.value === null ? null : (ix.value.folders.get(thumbFolderId.value) ?? null)))

const problemCode = computed(() => props.problem ?? (props.resolution.kind === 'problem' ? props.resolution.code : null))
/** Copy for a problem code; one this version has no words for reads as a general one, never as a raw key. */
const problemText = computed(() => {
  const key = `intakes.problem.${problemCode.value}`
  return te(key) ? t(key) : t('intakes.problem.unknown')
})
const kind = computed(() => (problemCode.value ? 'problem' : props.resolution.kind))

const folderName = (folderId: string | null): string =>
  folderId === null ? props.snapshot.inventory.name : (ix.value.folders.get(folderId)?.name ?? props.snapshot.inventory.name)

const amount = computed(() => formatAmountParts(props.line.quantity, unit.value))

const caption = computed(() => {
  const r = props.resolution
  const parts: string[] = []
  if (r.kind === 'add') {
    const have = r.variantId === null ? itemStock(props.snapshot, r.itemId) : bucketStock(props.snapshot, r.itemId, r.variantId)
    parts.push(t('intakes.row.have', { amount: formatAmount(have.quantity, unit.value) }), folderName(item.value?.folderId ?? null))
  } else if (r.kind === 'newValue') {
    parts.push(t('intakes.row.newValue'), folderName(item.value?.folderId ?? null))
  } else if (r.kind === 'newItem' && newItem.value) {
    const n = newItem.value
    // "next to TL072": the thing it looks most like, when it lives in the same folder.
    const near = existingMatches(n.name, props.snapshot, 1, { everyWord: true })[0]
    const nearItem = near ? ix.value.items.get(near.itemId) : undefined
    parts.push(`→ ${folderName(n.folderId)}`)
    if (nearItem && nearItem.folderId === n.folderId) parts.push(t('intakes.row.nextTo', { name: nearItem.name }))
  }
  const currency = props.snapshot.inventory.currency
  if (props.line.totalPrice !== null && currency) parts.push(formatMoney(props.line.totalPrice, currency))
  return parts.join(' · ')
})

const tag = computed(() => {
  switch (kind.value) {
    case 'add':
      return { label: 'intakes.tag.add', class: 'tag-add' }
    case 'newValue':
      return { label: 'intakes.tag.newValue', class: 'bg-accent-soft text-accent-soft-foreground' }
    case 'newItem':
      return { label: 'intakes.tag.new', class: 'bg-accent-soft text-accent-soft-foreground' }
    default:
      return { label: 'intakes.tag.problem', class: 'border border-destructive text-destructive' }
  }
})
</script>

<template>
  <button
    type="button"
    class="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-field px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    @click="$emit('open')"
  >
    <ItemThumb
      :id="line.itemId"
      :folder-name="thumbFolder?.name ?? null"
      :cover="cover"
      :icon="item?.icon ?? null"
      :folder-icon="thumbFolder?.icon ?? null"
      :color="item?.color ?? null"
      class="size-9 rounded-thumb text-xs"
    />
    <span class="flex min-w-0 grow flex-col gap-0.5">
      <span class="min-w-0 text-base font-semibold wrap-anywhere">
        {{ name }}<span v-if="values" class="font-normal text-muted-foreground"> · {{ values }}</span>
      </span>
      <span v-if="problemCode" class="text-sm font-semibold text-destructive wrap-anywhere">{{ problemText }}</span>
      <span v-else class="truncate text-sm text-muted-foreground">{{ caption }}</span>
    </span>
    <span class="flex shrink-0 flex-col items-end gap-1">
      <span class="amount text-base whitespace-nowrap tabular-nums">
        <template v-if="kind === 'add'">+</template>{{ amount.number }}<span v-if="amount.unit" class="ml-1 text-sm font-normal text-muted-foreground">{{ amount.unit }}</span>
      </span>
      <span class="rounded-chip px-1.5 py-px text-xs font-semibold tracking-[0.04em] uppercase" :class="tag.class">
        {{ $t(tag.label) }}
      </span>
    </span>
  </button>
</template>

<style scoped>
/* "Adding to what you have": a green tint under the page's own text colour keeps the text's contrast in every style. */
.tag-add {
  background: color-mix(in oklab, #16a34a 18%, var(--surface));
  color: var(--foreground);
}
</style>

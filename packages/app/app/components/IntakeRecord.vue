<script setup lang="ts">
import { BUILTIN_UNITS, formatAmountParts, itemArchived, keepValuesTogether, resolveUnit, type CommittedLine, type Intake, type InventorySnapshot } from '@antresol/core'
import { ExternalLink } from '@lucide/vue'
import { formatDateTime, formatMoney } from '~/lib/format'
import { formatDay } from '~/lib/intake-list'
import { httpHref } from '~/lib/item-view'
import { snapshotIndex } from '~/lib/views'

// A committed intake: what was received, as the order listed it. Lines are not edited.
const props = defineProps<{ intake: Intake; snapshot: InventorySnapshot }>()

const ix = computed(() => snapshotIndex(props.snapshot))

interface LineView {
  line: CommittedLine
  amount: { number: string; unit: string }
  price: string | null
  href: string | null
  /** The item's name now and where it lives; null when the item is gone or archived. */
  live: { name: string; to: string } | null
}

const lines = computed<LineView[]>(() =>
  (props.intake.lines ?? []).map((line) => {
    const item = ix.value.items.get(line.itemId)
    const alive = item && !itemArchived(props.snapshot, item) ? item : null
    const variant = line.variantId ? props.snapshot.variants.find((v) => v.id === line.variantId) : null
    const query = variant && variant.archivedAt === null ? `?variant=${variant.id}` : ''
    const unit = resolveUnit(line.unitKey, props.snapshot.units) ?? BUILTIN_UNITS.pcs
    const currency = props.snapshot.inventory.currency
    return {
      line,
      amount: formatAmountParts(line.quantity, unit),
      price: line.totalPrice !== null && currency ? formatMoney(line.totalPrice, currency) : null,
      href: httpHref(line.sourceUrl),
      live: alive ? { name: alive.name, to: `/item/${alive.id}${query}` } : null,
    }
  }),
)

const label = (l: CommittedLine): string => (l.variantLabel ? `${l.itemName} · ${keepValuesTogether(l.variantLabel)}` : l.itemName)
const meta = computed(() => {
  const i = props.intake
  return [formatDay(i.header.purchasedOn), i.committedAt ? formatDateTime(i.committedAt) : null, i.updatedBy || null]
})
</script>

<template>
  <section class="grid min-w-0 grid-cols-1 gap-4">
    <div class="grid min-w-0 gap-1">
      <p class="text-sm text-muted-foreground wrap-anywhere">
        {{ $t('intakes.record.purchased', { date: meta[0] }) }}<template v-if="meta[1]"> · {{ $t('intakes.record.committed', { date: meta[1] }) }}</template><template v-if="meta[2]"> · {{ meta[2] }}</template>
      </p>
      <p v-if="intake.header.note" class="text-base whitespace-pre-line text-muted-foreground wrap-anywhere">{{ intake.header.note }}</p>
    </div>

    <section class="grid min-w-0 grid-cols-1 gap-2">
      <h2 class="section-label px-1 text-xs">{{ $t('intakes.record.lines', lines.length) }}</h2>
      <EmptyState v-if="lines.length === 0" :text="$t('intakes.record.noLines')" />
      <ul v-else class="surface-list">
        <li
          v-for="{ line, amount, price, href, live } in lines"
          :key="line.lineId"
          class="relative grid gap-0.5 px-3 py-3 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
        >
          <div class="flex min-w-0 items-baseline gap-3">
            <span class="min-w-0 grow text-base font-semibold wrap-anywhere">{{ label(line) }}</span>
            <span class="amount shrink-0 text-base tabular-nums">
              +{{ amount.number }}
              <span class="text-xs font-semibold text-muted-foreground">{{ amount.unit }}</span>
            </span>
          </div>
          <p class="min-w-0 text-sm text-muted-foreground wrap-anywhere">
            <NuxtLink
              v-if="live"
              :to="live.to"
              class="relative rounded-chip font-semibold text-foreground underline decoration-border underline-offset-2 outline-none transition-colors duration-(--dur-fast) after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >{{ $t('intakes.record.now', { name: live.name }) }}</NuxtLink>
            <template v-else>{{ $t('intakes.record.gone') }}</template>
            <template v-if="price"> · {{ price }}</template>
            <template v-if="href">
              ·
              <a
                :href="href"
                target="_blank"
                rel="noopener noreferrer"
                class="relative inline-flex items-center gap-1 rounded-chip font-semibold text-foreground underline decoration-border underline-offset-2 outline-none transition-colors duration-(--dur-fast) after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {{ $t('journal.whereBought') }}
                <ExternalLink class="size-4" aria-hidden="true" />
                <span class="sr-only">{{ $t('journal.newTab') }}</span>
              </a>
            </template>
            <template v-else-if="line.sourceUrl"> · {{ line.sourceUrl }}</template>
          </p>
        </li>
      </ul>
    </section>
  </section>
</template>

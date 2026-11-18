<script setup lang="ts">
import { BUILTIN_UNITS, folderArchived, formatAmountParts, itemArchived, keepValuesTogether, resolveUnit, type CommittedLine, type Intake, type InventorySnapshot } from '@antresol/core'
import { ExternalLink } from '@lucide/vue'
import { formatDateTime, formatMoney } from '~/lib/format'
import { formatDay } from '~/lib/intake-list'
import { httpHref } from '~/lib/item-view'
import { snapshotIndex } from '~/lib/views'

// A committed intake: what was received, as the order listed it. Lines are not edited.
const props = defineProps<{ intake: Intake; snapshot: InventorySnapshot }>()

const { t } = useI18n()
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

// What the commit created, as it was named then; an item or folder still there links to its place now.
interface CreatedRow {
  key: string
  text: string
  to: string | null
}
const created = computed(() => {
  const c = props.intake.created
  if (!c) return []
  const path = (id: string | null): string => {
    const names: string[] = []
    for (let cur = id, n = 0; cur !== null && n < 32; n++) {
      const f = c.folders.find((x) => x.id === cur)
      const e = f ?? props.snapshot.folders.find((x) => x.id === cur)
      if (!e) break
      names.unshift(e.name)
      cur = e.parentId
    }
    return names.join(' / ')
  }
  const alive = (id: string) => ix.value.folders.has(id) && !folderArchived(props.snapshot, id)
  const sections: { key: string; title: string; rows: CreatedRow[] }[] = [
    { key: 'folders', title: 'intakes.created.folders', rows: c.folders.map((f) => ({ key: f.id, text: path(f.id) || f.name, to: alive(f.id) ? `/folder/${f.id}` : null })) },
    { key: 'units', title: 'intakes.created.units', rows: (c.units ?? []).map((u) => ({ key: u.id, text: `${u.name} (${u.symbol})`, to: null })) },
    { key: 'attributes', title: 'intakes.created.attributes', rows: c.attributes.map((a) => ({ key: a.id, text: a.name, to: null })) },
    { key: 'tags', title: 'intakes.created.tags', rows: c.tags.map((x) => ({ key: x.id, text: x.name, to: null })) },
    {
      key: 'options',
      title: 'intakes.created.options',
      rows: (c.appendedOptions ?? []).map((o) => ({ key: o.attributeId, text: t('intakes.created.option', { name: o.name, values: o.values.join(', + ') }), to: null })),
    },
    {
      key: 'items',
      title: 'intakes.created.items',
      rows: c.items.map((i) => {
        const item = ix.value.items.get(i.id)
        const where = path(i.folderId)
        return { key: i.id, text: where ? `${i.name} · ${where}` : i.name, to: item && !itemArchived(props.snapshot, item) ? `/item/${i.id}` : null }
      }),
    },
  ]
  return sections.filter((x) => x.rows.length > 0)
})

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

    <section v-if="created.length > 0" class="grid min-w-0 grid-cols-1 gap-3" :aria-label="$t('intakes.created.title')">
      <h2 class="section-label px-3 text-xs">{{ $t('intakes.created.title') }}</h2>
      <div v-for="sec in created" :key="sec.key" class="grid min-w-0 gap-1">
        <h3 class="px-3 text-sm font-semibold text-muted-foreground">{{ $t(sec.title) }}</h3>
        <ul class="surface-list">
          <li
            v-for="row in sec.rows"
            :key="row.key"
            class="relative min-w-0 px-3 py-3 text-sm wrap-anywhere not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
          >
            <NuxtLink
              v-if="row.to"
              :to="row.to"
              class="relative rounded-chip font-semibold text-foreground underline decoration-border underline-offset-2 outline-none transition-colors duration-(--dur-fast) after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >{{ row.text }}</NuxtLink>
            <template v-else>{{ row.text }}</template>
          </li>
        </ul>
      </div>
    </section>

    <section class="grid min-w-0 grid-cols-1 gap-2">
      <h2 class="section-label px-3 text-xs">{{ $t('intakes.record.lines', lines.length) }}</h2>
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

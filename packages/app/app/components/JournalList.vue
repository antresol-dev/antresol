<script setup lang="ts">
import { StorageError, type Intake, type Movement } from '@antresol/core'
import { Check, ExternalLink } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { errorMessageKey } from '~/lib/errors'
import { formatMoney } from '~/lib/format'
import { journalDays, journalRows, type JournalDay, type JournalRow } from '~/lib/item-view'

const props = defineProps<{ itemId: string }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const movements = shallowRef<Movement[] | null>(null)
const failure = shallowRef<unknown>(null)
const busy = ref(false)

const sourceStatus = computed(() => {
  const cur = state.current
  return cur ? (state.sources.find((s) => s.config.id === cur.sourceId)?.status ?? null) : null
})
const connected = computed(() => sourceStatus.value === 'ready' || sourceStatus.value === 'read_only')

// Only the latest request may write; older answers are dropped.
let latest = 0
async function load(): Promise<void> {
  const n = ++latest
  busy.value = true
  try {
    const list = await workspace.loadMovements(props.itemId)
    if (n !== latest) return
    movements.value = list
    failure.value = null
  } catch (e) {
    if (n !== latest) return
    failure.value = e
  } finally {
    if (n === latest) busy.value = false
  }
}
onScopeDispose(() => latest++)

watch(
  () => props.itemId,
  () => {
    movements.value = null
    failure.value = null
    void load()
  },
  { immediate: true },
)
// A new snapshot follows every write and refresh; the source turning ready ends a cold start or an outage.
watch(() => state.snapshot, () => void load())
watch(connected, (now) => {
  if (now) void load()
})

async function retry(): Promise<void> {
  if (!connected.value) await workspace.refresh().catch(() => {})
  await load()
}

const unavailable = computed(() => failure.value instanceof StorageError && failure.value.code === 'unavailable')
// While the source is still connecting on startup, a refusal is not an answer yet: keep the skeleton.
const waiting = computed(
  () => movements.value === null && (failure.value === null || (unavailable.value && sourceStatus.value === 'connecting')),
)
const failureText = computed(() => {
  if (failure.value === null || waiting.value) return null
  return unavailable.value ? t('journal.needsConnection') : t(errorMessageKey(failure.value))
})

// Titles of the intakes for the links to them: the cached list; none yet (or none readable), no link.
const intakeList = shallowRef<Intake[] | null>(null)
const intakes = useIntakes()
async function loadIntakes(): Promise<void> {
  try {
    intakeList.value = await intakes.list()
  } catch {
    // The history reads fine without the links.
  }
}
watch(() => [props.itemId, state.snapshot], () => void loadIntakes(), { immediate: true })

const currency = computed(() => state.snapshot?.inventory.currency ?? null)

type Part = { kind: 'text'; text: string } | { kind: 'link'; href: string } | { kind: 'route'; to: string; text: string }
// Grouped by day (Today, Yesterday, Nov 10); a row shows its time only, and the device when it is another one.
const days = computed(() => {
  const s = state.snapshot
  if (!s || !movements.value) return []
  return journalDays(journalRows(s, props.itemId, movements.value, intakeList.value), new Date()).map((day) => ({
    key: day.day,
    label: dayLabel(day),
    entries: day.rows.map((row) => ({ row, title: titleOf(row), parts: partsOf(row), meta: metaOf(row) })),
  }))
})

const timeFormat = new Intl.DateTimeFormat('en', { timeStyle: 'short' })
const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const yearDayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
function dayLabel(day: JournalDay): string {
  if (day.relative) return t(`journal.${day.relative}`)
  const [y, m, d] = day.day.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m - 1, d)
  return (y === new Date().getFullYear() ? dayFormat : yearDayFormat).format(date)
}
function metaOf(row: JournalRow): string {
  const time = timeFormat.format(new Date(row.at))
  return row.by === state.deviceName ? time : `${time} · ${row.by}`
}

function titleOf(row: JournalRow): string {
  if (row.counted) return t('journal.counted')
  if (!row.transfer) return t(`journal.kind.${row.kind}`)
  const name = (n: string | null): string => n ?? t('item.noVariant')
  return t('journal.moved', { from: name(row.transfer.from), to: name(row.transfer.to) })
}
function partsOf(row: JournalRow): Part[] {
  const parts: Part[] = []
  if (row.variantName) parts.push({ kind: 'text', text: row.variantName })
  if (row.totalPrice !== null && currency.value) parts.push({ kind: 'text', text: formatMoney(row.totalPrice, currency.value) })
  // Only a checked http(s) address becomes a link; anything else stays plain text.
  if (row.sourceHref) parts.push({ kind: 'link', href: row.sourceHref })
  else if (row.sourceUrl) parts.push({ kind: 'text', text: row.sourceUrl })
  if (row.note) parts.push({ kind: 'text', text: row.note })
  if (row.intake) parts.push({ kind: 'route', to: `/intakes/${row.intake.id}`, text: t('journal.intake', { title: row.intake.title }) })
  return parts
}
</script>

<template>
  <section class="grid min-w-0 grid-cols-1 gap-2">
    <h2 class="section-label text-base">{{ $t('journal.title') }}</h2>

    <div v-if="waiting" role="status" class="grid gap-5 px-3 py-4">
      <span class="sr-only">{{ $t('journal.loading') }}</span>
      <div v-for="n in 3" :key="n" class="grid gap-2" aria-hidden="true">
        <div class="flex justify-between gap-6">
          <Skeleton class="h-4 w-2/5" />
          <Skeleton class="h-4 w-12" />
        </div>
        <Skeleton class="h-3 w-1/3" />
      </div>
    </div>

    <EmptyState v-else-if="failureText" :text="failureText">
      <Button
        variant="outline"
        class="h-11"
        :disabled="busy || state.refreshing"
        @click="retry"
      >
        {{ $t('status.retry') }}
      </Button>
    </EmptyState>

    <EmptyState v-else-if="days.length === 0" :text="$t('journal.empty')" />

    <template v-else>
      <section v-for="day in days" :key="day.key" class="grid min-w-0 gap-1.5" :aria-label="day.label">
        <h3 class="pt-1 text-xs font-semibold text-muted-foreground">{{ day.label }}</h3>
        <!-- A flat list on the page, rows divided by lines. -->
        <ul class="surface-list">
          <li
            v-for="{ row, title, parts, meta } in day.entries"
            :key="row.id"
            class="relative grid gap-0.5 px-3 py-2 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
          >
            <div class="flex min-w-0 items-baseline gap-3">
              <span class="min-w-0 grow text-base font-semibold wrap-anywhere">{{ title }}</span>
              <!-- A recount that matched shows the quantity it confirmed: "Counted 37 pcs ✓". -->
              <span v-if="row.counted && row.balance" class="amount flex shrink-0 items-baseline gap-1 text-base tabular-nums">
                {{ row.balance.number }}
                <span class="text-xs font-semibold text-muted-foreground">{{ row.balance.unit }}</span>
                <Check class="size-4 self-center" aria-hidden="true" />
              </span>
              <span v-else class="amount shrink-0 text-base tabular-nums">
                {{ row.number }}
                <span class="text-xs font-semibold text-muted-foreground">{{ row.unit }}</span>
              </span>
            </div>
            <p v-if="parts.length > 0" class="min-w-0 text-sm text-muted-foreground wrap-anywhere">
              <template v-for="(part, i) in parts" :key="i">
                <template v-if="i > 0"> · </template>
                <a
                  v-if="part.kind === 'link'"
                  :href="part.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="relative inline-flex items-center gap-1 rounded-chip font-semibold text-foreground underline decoration-border underline-offset-2 outline-none transition-colors duration-(--dur-fast) after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {{ $t('journal.whereBought') }}
                  <ExternalLink class="size-4" aria-hidden="true" />
                  <span class="sr-only">{{ $t('journal.newTab') }}</span>
                </a>
                <NuxtLink
                  v-else-if="part.kind === 'route'"
                  :to="part.to"
                  class="relative rounded-chip font-semibold text-foreground underline decoration-border underline-offset-2 outline-none transition-colors duration-(--dur-fast) after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >{{ part.text }}</NuxtLink>
                <template v-else>{{ part.text }}</template>
              </template>
            </p>
            <p class="flex min-w-0 items-baseline justify-between gap-3 text-xs text-subtle-foreground">
              <span class="min-w-0 truncate">{{ meta }}</span>
              <span v-if="row.balance && !row.counted" class="shrink-0 tabular-nums">
                {{ $t('journal.balance', { amount: `${row.balance.number} ${row.balance.unit}` }) }}
              </span>
            </p>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

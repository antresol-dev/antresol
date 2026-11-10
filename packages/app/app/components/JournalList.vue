<script setup lang="ts">
import { StorageError, type Movement } from '@graymatter/core'
import { ExternalLink } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { errorMessageKey } from '~/lib/errors'
import { formatDateTime, formatMoney } from '~/lib/format'
import { journalRows, type JournalRow } from '~/lib/item-view'

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

const currency = computed(() => state.snapshot?.inventory.currency ?? null)

type Part = { kind: 'text'; text: string } | { kind: 'link'; href: string }
const entries = computed(() => {
  const s = state.snapshot
  if (!s || !movements.value) return []
  return journalRows(s, props.itemId, movements.value).map((row) => ({ row, title: titleOf(row), parts: partsOf(row) }))
})

function titleOf(row: JournalRow): string {
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
  return parts
}
</script>

<template>
  <section class="grid min-w-0 grid-cols-1 gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-subtle-foreground">{{ $t('journal.title') }}</h2>

    <div v-if="waiting" role="status" class="grid gap-5 rounded-card border border-border bg-surface px-3.5 py-4">
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
        class="h-11 rounded-field bg-surface transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="busy || state.refreshing"
        @click="retry"
      >
        {{ $t('status.retry') }}
      </Button>
    </EmptyState>

    <EmptyState v-else-if="entries.length === 0" :text="$t('journal.empty')" />

    <ul v-else class="rounded-card border border-border bg-surface py-1">
      <li
        v-for="{ row, title, parts } in entries"
        :key="row.id"
        class="relative grid gap-0.5 px-3.5 py-2.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <div class="flex min-w-0 items-baseline gap-3">
          <span class="min-w-0 grow text-[15px] font-bold wrap-anywhere">{{ title }}</span>
          <span class="shrink-0 text-base font-bold tabular-nums">
            {{ row.number }}
            <span class="text-xs font-semibold text-muted-foreground">{{ row.unit }}</span>
          </span>
        </div>
        <p v-if="parts.length > 0" class="min-w-0 text-[13px] text-muted-foreground wrap-anywhere">
          <template v-for="(part, i) in parts" :key="i">
            <template v-if="i > 0"> · </template>
            <a
              v-if="part.kind === 'link'"
              :href="part.href"
              target="_blank"
              rel="noopener noreferrer"
              class="relative inline-flex items-center gap-1 rounded-sm font-semibold text-foreground underline decoration-border underline-offset-2 outline-none transition-colors duration-150 after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-[''] hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {{ $t('journal.whereBought') }}
              <ExternalLink class="size-3" aria-hidden="true" />
              <span class="sr-only">{{ $t('journal.newTab') }}</span>
            </a>
            <template v-else>{{ part.text }}</template>
          </template>
        </p>
        <p class="text-xs text-subtle-foreground">{{ formatDateTime(row.at) }} · {{ row.by }}</p>
      </li>
    </ul>
  </section>
</template>

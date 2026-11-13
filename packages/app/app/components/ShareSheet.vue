<script setup lang="ts">
import type { SourceReceipt } from '@antresol/core'
import { until } from '@vueuse/core'
import { Button } from '@/components/ui/button'
import { formatDate } from '~/lib/format'
import type { MatchRow } from '~/lib/quick-add'
import { boughtRows, parseShare, shareMatches, valueChips, type ParsedShare, type ValueChip } from '~/lib/share'
import { launchReady } from '~/lib/shell'

// "Do I have it?" for a shop page shared to the app (/share) or pasted into the palette (spec 4.10): the cleaned title,
// what the inventory has like it, its values by stock and earlier receipts of the same lot.
const { t } = useI18n()
const router = useRouter()
const workspace = useWorkspace()
const { state } = workspace
const { shared, close } = useShare()
const quickAdd = useQuickAdd()
const receive = useReceive()

const parsed = computed<ParsedShare | null>(() => (shared.value ? parseShare(shared.value) : null))
// What the sheet shows while it animates out.
const shown = shallowRef<ParsedShare>({ query: '', url: null, lotKey: null })
watch(
  parsed,
  (p) => {
    if (p) shown.value = p
  },
  { immediate: true },
)
const open = computed({
  get: () => shared.value !== null,
  set: (value: boolean) => {
    if (!value) close()
  },
})

const snapshot = computed(() => state.snapshot)
const canWrite = computed(() => !!state.current && !state.readOnly)
const matches = computed<MatchRow[]>(() => (snapshot.value ? shareMatches(shown.value.query, snapshot.value) : []))
const chips = computed<ValueChip[]>(() => (snapshot.value ? valueChips(shown.value.query, snapshot.value) : []))

// Earlier receipts of the lot: one read per share, once the inventory's source has connected. Offline or failing, the
// title search still answers.
const receipts = ref<SourceReceipt[]>([])
let asked = 0
watch(
  parsed,
  async (p) => {
    const ask = ++asked
    receipts.value = []
    if (!p?.lotKey) return
    await until(() => launchReady(state)).toBeTruthy({ timeout: 10_000, throwOnTimeout: false })
    if (ask !== asked || !state.current) return
    try {
      const found = await workspace.findReceiptsBySource(p.lotKey)
      if (ask === asked) receipts.value = found
    } catch {
      // Shown as nothing: the matches below do not depend on it.
    }
  },
  { immediate: true },
)
const bought = computed(() => (snapshot.value ? boughtRows(receipts.value, snapshot.value).slice(0, 3) : []))

const nearestChips = computed(() => chips.value.filter((c) => c.nearest))

const chipLabel = (c: ValueChip): string =>
  c.inStock
    ? t(c.number ? 'share.valueIn' : 'share.valueInMixed', { value: c.text, number: c.number })
    : c.number !== null
      ? t('share.valueOut', { value: c.text })
      : t('share.valueNone', { value: c.text })
const detail = (m: MatchRow): string => [m.path || snapshot.value?.inventory.name, m.amount].filter((x): x is string => !!x).join(' · ')

// Leave this sheet first, so the next one takes focus from the screen.
async function leaveThen(next: () => void): Promise<void> {
  close()
  await nextTick()
  next()
}
function openItem(m: MatchRow): void {
  void leaveThen(() => void router.push({ path: `/item/${m.itemId}`, query: m.variantId ? { variant: m.variantId } : {} }))
}
function openNearest(e: { itemId: string; variantId: string | null }): void {
  void leaveThen(() => void router.push({ path: `/item/${e.itemId}`, query: e.variantId ? { variant: e.variantId } : {} }))
}
function receiveInto(m: MatchRow): void {
  // An item with variants: receiving "into the item" would go to the stock kept without a variant. Its card asks which.
  if (m.variantId === null && m.hasVariants) return openItem(m)
  const url = shown.value.url ?? ''
  void leaveThen(() => receive.open({ itemId: m.itemId, variantId: m.variantId, url }))
}
function addNew(): void {
  const { query, url } = shown.value
  void leaveThen(() => quickAdd.open({ name: query, url: url ?? '' }))
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('share.title')" :summary="shown.query || undefined">
    <div class="grid min-w-0 gap-4 pt-2">
      <p v-if="!snapshot" class="text-sm text-muted-foreground">
        {{ $t(state.refreshing || state.sources.some((s) => s.status === 'connecting') ? 'share.loading' : 'share.noInventory') }}
      </p>
      <template v-else>
        <ul v-if="chips.length > 0" class="flex flex-wrap gap-1.5" :aria-label="$t('share.values')">
          <li
            v-for="c in chips"
            :key="c.text"
            :aria-label="chipLabel(c)"
            :class="[
              'rounded-chip px-2 py-1 text-xs font-semibold tabular-nums',
              c.inStock ? 'bg-chip text-foreground' : 'border border-border text-subtle-foreground',
            ]"
          >
            <span aria-hidden="true">
              {{ c.text }}
              <template v-if="c.inStock"> {{ $t('share.chipIn', { number: c.number }) }}</template>
              <template v-else-if="c.number !== null"> · {{ c.number }}</template>
              <template v-else> — {{ $t('share.no') }}</template>
            </span>
          </li>
        </ul>

        <ul v-if="nearestChips.length > 0" class="grid gap-1" :aria-label="$t('share.nearest')">
          <li v-for="c in nearestChips" :key="c.text" class="text-sm text-subtle-foreground">
            {{ $t('share.noValue', { wanted: c.nearest!.wanted }) }}
            <template v-for="(e, i) in [c.nearest!.below, c.nearest!.above]" :key="i">
              <template v-if="e">
                <span v-if="i === 1 && c.nearest!.below" aria-hidden="true"> · </span>
                <button
                  type="button"
                  class="pressable inline-flex min-h-11 items-center font-semibold text-foreground tabular-nums underline-offset-4 hover:underline"
                  :aria-label="$t('share.openNearest', { value: e.value })"
                  @click="openNearest(e)"
                >
                  {{ $t('share.nearestHit', { value: e.value, stock: e.stock }) }}
                </button>
              </template>
            </template>
          </li>
        </ul>

        <ul v-if="bought.length > 0" class="grid gap-2" :aria-label="$t('share.boughtBefore')">
          <li v-for="(b, i) in bought" :key="i" class="grid min-w-0 rounded-field bg-chip px-3 py-2 text-sm">
            <span class="truncate font-semibold">
              {{ b.name }}<span v-if="b.variantName" class="font-semibold text-subtle-foreground"> · {{ b.variantName }}</span>
            </span>
            <span class="text-subtle-foreground">{{ $t('share.bought', { date: formatDate(b.at), amount: b.bought, left: b.left }) }}</span>
          </li>
        </ul>

        <section class="grid min-w-0 gap-1" aria-labelledby="share-matches">
          <h3 id="share-matches" class="text-xs font-semibold text-subtle-foreground">{{ $t('share.matches') }}</h3>
          <ul v-if="matches.length > 0" class="grid gap-0.5">
            <li v-for="m in matches" :key="`${m.itemId}:${m.variantId ?? ''}`" class="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                class="pressable flex min-h-11 min-w-0 flex-1 items-center gap-3 px-1 py-1 text-left"
                :aria-label="$t('share.open', { name: m.variantName ? `${m.name} · ${m.variantName}` : m.name })"
                @click="openItem(m)"
              >
                <ItemThumb :id="m.itemId" :folder-name="m.folderName" :cover="m.cover" class="size-9 rounded-thumb text-xs" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-sm font-semibold" :class="m.outOfStock && 'text-dimmed-foreground'">
                    {{ m.name }}<span v-if="m.variantName" class="font-semibold text-muted-foreground"> · {{ m.variantName }}</span>
                  </span>
                  <span class="truncate text-xs text-muted-foreground">{{ detail(m) }}</span>
                </span>
              </button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="h-9 shrink-0"
                :disabled="!canWrite"
                @click="receiveInto(m)"
              >
                {{ $t(m.variantId === null && m.hasVariants ? 'share.openCard' : 'share.receive') }}
              </Button>
            </li>
          </ul>
          <p v-else class="py-1 text-sm text-muted-foreground">{{ $t('share.nothing') }}</p>
        </section>

        <p v-if="shown.url" class="truncate text-xs text-muted-foreground">{{ shown.url }}</p>
        <Button type="button" class="h-11 rounded-field" data-primary :disabled="!canWrite || shown.query === ''" @click="addNew">
          {{ $t('share.quickAdd') }}
        </Button>
      </template>
    </div>
  </AppSheet>
</template>

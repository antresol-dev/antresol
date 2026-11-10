<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { itemView } from '~/lib/item-view'

const props = defineProps<{ itemId: string; variantId: string | null }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const snapshot = computed(() => state.snapshot)
const view = computed(() => (snapshot.value ? itemView(snapshot.value, props.itemId) : null))

// Header: the item's name, wrapping when long; the path is the inventory root and every folder of the item, links only.
const title = computed(() => view.value?.item.name ?? snapshot.value?.inventory.name ?? t('app.name'))
const crumbs = computed(() => {
  const s = snapshot.value
  const v = view.value
  if (!s || !v) return []
  return [{ name: s.inventory.name, to: '/' }, ...v.crumbs.map((c) => ({ name: c.name, to: `/folder/${c.id}` }))]
})

// No snapshot and nothing loading: say why instead of showing a skeleton forever (as the folder screen does).
const blocker = computed(() => {
  if (snapshot.value || state.refreshing) return null
  const current = state.current ? state.sources.find((s) => s.config.id === state.current?.sourceId) : null
  const source = current ?? state.sources.find((s) => s.status === 'unreachable' || s.status === 'error')
  if (source?.status === 'unreachable') return { kind: 'offline' as const, source }
  if (source?.status === 'error') return { kind: 'error' as const, source }
  // Sources answered but there is no inventory to show the item in.
  if (!state.current && state.sources.every((s) => s.status === 'ready' || s.status === 'read_only')) return { kind: 'gone' as const }
  return null
})
const fixTo = computed(() => {
  const b = blocker.value
  return b && b.kind === 'error' && b.source.config.kind === 'neon' ? `/settings/sources/${b.source.config.id}` : '/settings'
})

function retry(): void {
  void workspace.refresh().catch(() => {})
}

const highlight = computed(() => (view.value?.hasVariants ? props.variantId : null))
const linkClass =
  'min-h-11 content-center rounded-md text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'
</script>

<template>
  <ScreenHeader :title="title" :crumbs="crumbs" wrap-title />
  <ScreenBody>
    <template v-if="view && snapshot">
      <div v-if="view.item.description || view.tags.length > 0" class="grid min-w-0 gap-2.5">
        <p v-if="view.item.description" class="text-[15px] whitespace-pre-line text-muted-foreground wrap-anywhere">
          {{ view.item.description }}
        </p>
        <ul v-if="view.tags.length > 0" class="flex min-w-0 flex-wrap gap-1.5" :aria-label="$t('item.tags')">
          <li
            v-for="tag in view.tags"
            :key="tag.id"
            class="max-w-full truncate rounded-full bg-chip px-2.5 py-1 text-[13px] font-semibold"
          >
            {{ tag.name }}
          </li>
        </ul>
      </div>
      <StockCard :total="view.total" :unit-symbol="view.unit.symbol" :currency="view.currency" />
      <BucketList v-if="view.hasVariants" :buckets="view.buckets" :highlight="highlight" />
      <ItemAttributes v-if="view.attributes.length > 0" :attributes="view.attributes" />
      <JournalList :item-id="itemId" />
    </template>
    <EmptyState v-else-if="snapshot || blocker?.kind === 'gone'" :text="$t('empty.itemGone')">
      <NuxtLink to="/" :class="linkClass">
        {{ $t('empty.backTo', { name: snapshot?.inventory.name ?? $t('app.name') }) }}
      </NuxtLink>
    </EmptyState>
    <EmptyState v-else-if="blocker?.kind === 'offline'" :text="$t('empty.offlineNoCopy')">
      <Button variant="outline" class="h-11 rounded-field bg-surface" @click="retry">{{ $t('status.retry') }}</Button>
    </EmptyState>
    <EmptyState
      v-else-if="blocker?.kind === 'error'"
      :text="$t('empty.sourceFailed', { source: blocker.source.config.name, reason: $t(`errors.probe.${blocker.source.reason ?? 'failed'}`) })"
    >
      <NuxtLink :to="fixTo" :class="linkClass">{{ $t('status.fix') }}</NuxtLink>
    </EmptyState>
    <div v-else class="grid grid-cols-1 gap-3.5" aria-hidden="true">
      <Skeleton class="h-[104px] rounded-card" />
      <Skeleton class="h-40 rounded-card" />
    </div>
  </ScreenBody>
</template>

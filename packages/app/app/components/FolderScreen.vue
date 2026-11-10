<script setup lang="ts">
import { createSearch } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { folderView, searchRows } from '~/lib/views'

const props = defineProps<{ folderId: string | null }>()

const route = useRoute()
const router = useRouter()
const workspace = useWorkspace()
const { state } = workspace

const snapshot = computed(() => state.snapshot)
const routeQuery = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))

// The field keeps its own value so fast typing never waits for the router.
const text = ref(routeQuery.value)
watch(routeQuery, (q) => {
  if (q !== text.value) text.value = q
})
watch(text, (q) => {
  if (q === routeQuery.value) return
  const { q: _drop, ...rest } = route.query
  void router.replace({ query: q ? { ...rest, q } : rest })
})

const query = computed(() => text.value.trim())
const view = computed(() => (snapshot.value ? folderView(snapshot.value, props.folderId) : null))
const search = computed(() => (snapshot.value ? createSearch(snapshot.value) : null))
const rows = computed(() =>
  snapshot.value && search.value && query.value ? searchRows(snapshot.value, search.value.search(query.value)) : [],
)

const creating = ref(false)
const noInventories = computed(
  () =>
    !snapshot.value &&
    !state.refreshing &&
    state.inventories.length === 0 &&
    state.sources.every((s) => s.status === 'ready' || s.status === 'read_only'),
)

// No snapshot and nothing loading: say why instead of showing a skeleton forever.
const blocker = computed(() => {
  if (snapshot.value || state.refreshing || noInventories.value) return null
  const current = state.current ? state.sources.find((s) => s.config.id === state.current?.sourceId) : null
  const source = current ?? state.sources.find((s) => s.status === 'unreachable' || s.status === 'error')
  if (!source) return null
  if (source.status === 'unreachable') return { kind: 'offline' as const, source }
  if (source.status === 'error') return { kind: 'error' as const, source }
  return null
})
const fixTo = computed(() =>
  blocker.value?.source.config.kind === 'neon' ? `/settings/sources/${blocker.value.source.config.id}` : '/settings',
)

function retry(): void {
  void workspace.refresh().catch(() => {})
}
</script>

<template>
  <EmptyState v-if="noInventories" :text="$t('empty.noInventories')">
    <Button class="h-11 rounded-field" :disabled="!!state.readOnly" @click="creating = true">
      {{ $t('inventory.create') }}
    </Button>
    <AppSheet v-model:open="creating" :title="$t('inventory.new')">
      <InventoryForm v-if="creating" mode="create" @done="creating = false" />
    </AppSheet>
  </EmptyState>
  <EmptyState v-else-if="blocker?.kind === 'offline'" :text="$t('empty.offlineNoCopy')">
    <Button variant="outline" class="h-11 rounded-field bg-surface" @click="retry">{{ $t('status.retry') }}</Button>
  </EmptyState>
  <EmptyState
    v-else-if="blocker?.kind === 'error'"
    :text="$t('empty.sourceFailed', { source: blocker.source.config.name, reason: $t(`errors.probe.${blocker.source.reason ?? 'failed'}`) })"
  >
    <NuxtLink :to="fixTo" class="min-h-11 content-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
      {{ $t('status.fix') }}
    </NuxtLink>
  </EmptyState>
  <div v-else-if="!snapshot" class="grid grid-cols-1 gap-3.5" aria-hidden="true">
    <Skeleton class="h-[46px] rounded-field" />
    <Skeleton class="h-40 rounded-card" />
  </div>
  <template v-else>
    <SearchField v-model="text" />
    <SearchResults v-if="query" :rows="rows" :query="query" />
    <EmptyState v-else-if="!view" :text="$t('empty.folderGone')">
      <NuxtLink to="/" class="min-h-11 content-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
        {{ $t('empty.backTo', { name: snapshot.inventory.name }) }}
      </NuxtLink>
    </EmptyState>
    <template v-else>
      <Breadcrumbs v-if="view.crumbs.length > 0" :root-name="snapshot.inventory.name" :crumbs="view.crumbs" />
      <FolderList v-if="view.folders.length > 0" :folders="view.folders" />
      <ItemList v-if="view.items.length > 0" :items="view.items" />
      <EmptyState v-if="view.folders.length === 0 && view.items.length === 0" :text="$t('empty.folder')" />
    </template>
  </template>
</template>

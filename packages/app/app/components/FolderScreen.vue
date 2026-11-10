<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { folderView } from '~/lib/views'

const props = defineProps<{ folderId: string | null }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const snapshot = computed(() => state.snapshot)
const view = computed(() => (snapshot.value ? folderView(snapshot.value, props.folderId) : null))

// Header: the folder's name (the inventory's at the root); the path is the root and the ancestors, links only.
const title = computed(() => {
  const s = snapshot.value
  if (!s) return t('app.name')
  return view.value?.folder?.name ?? s.inventory.name
})
const subtitle = computed(() => {
  const v = view.value
  if (!v) return null
  return t('folder.summary', {
    folders: t('folder.folderCount', v.folders.length),
    items: t('folder.itemCount', v.items.length),
  })
})
const crumbs = computed(() => {
  const s = snapshot.value
  const v = view.value
  if (!s || !v?.folder) return []
  return [
    { name: s.inventory.name, to: '/' },
    ...v.crumbs.slice(0, -1).map((c) => ({ name: c.name, to: `/folder/${c.id}` })),
  ]
})
const current = computed(() => (view.value ? title.value : null))

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
  <ScreenHeader :title="title" :subtitle="subtitle" :crumbs="crumbs" :current="current">
    <template v-if="view" #actions="{ compact }">
      <FolderActions :folder-id="folderId" :compact="compact" />
    </template>
  </ScreenHeader>
  <ScreenBody>
    <EmptyState v-if="noInventories" :text="$t('empty.noInventories')">
      <Button class="h-11 rounded-field" :disabled="!!state.readOnly" @click="creating = true">
        {{ $t('inventory.create') }}
      </Button>
      <AppSheet v-model:open="creating" :title="$t('inventory.new')">
        <InventoryForm v-if="creating" mode="create" @done="creating = false" />
      </AppSheet>
      <NuxtLink
        v-if="state.archivedInventories.length > 0"
        to="/archive"
        class="min-h-11 content-center rounded-md text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {{ $t('archive.open') }}
      </NuxtLink>
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
      <Skeleton class="h-40 rounded-card" />
    </div>
    <template v-else>
      <EmptyState v-if="!view" :text="$t('empty.folderGone')">
        <NuxtLink to="/" class="min-h-11 content-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
          {{ $t('empty.backTo', { name: snapshot.inventory.name }) }}
        </NuxtLink>
      </EmptyState>
      <template v-else>
        <FolderList v-if="view.folders.length > 0" :folders="view.folders" />
        <ItemList v-if="view.items.length > 0" :items="view.items" />
        <EmptyState v-if="view.folders.length === 0 && view.items.length === 0" :text="$t('empty.folder')" />
      </template>
    </template>
  </ScreenBody>
</template>

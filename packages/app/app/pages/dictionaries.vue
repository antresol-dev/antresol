<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { dictionaryView } from '~/lib/dictionaries'

definePageMeta({ layout: 'default' })

const workspace = useWorkspace()
const { state } = workspace

/** The current inventory's snapshot only: never another inventory's paired with the current ref. */
const view = computed(() => {
  const s = state.snapshot
  return s && s.inventory.id === state.current?.inventoryId ? dictionaryView(s) : null
})

// Nothing to show and nothing loading: say why instead of showing a skeleton forever (as the folder screen does).
const blocker = computed(() => {
  if (view.value || state.refreshing) return null
  const current = state.current ? state.sources.find((s) => s.config.id === state.current?.sourceId) : null
  const source = current ?? state.sources.find((s) => s.status === 'unreachable' || s.status === 'error')
  if (source?.status === 'unreachable') return { kind: 'offline' as const, source }
  if (source?.status === 'error') return { kind: 'error' as const, source }
  // Sources answered and there is no inventory: tags, attributes and units belong to one.
  if (!state.current && state.sources.every((s) => s.status === 'ready' || s.status === 'read_only')) {
    return { kind: 'none' as const }
  }
  return null
})
const fixTo = computed(() => {
  const b = blocker.value
  return b && b.kind === 'error' && b.source.config.kind === 'neon' ? `/settings/sources/${b.source.config.id}` : '/settings'
})
const linkClass =
  'min-h-11 content-center rounded-chip text-sm font-semibold text-accent-ink underline-offset-4 hover:underline'

const creating = ref(false)
const creatingBusy = ref(false)

function retry(): void {
  void workspace.refresh().catch(() => {})
}
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="$t('dictionaries.title')" />
    <ScreenBody>
      <template v-if="view">
        <!-- A divider and room between the sections: their headings lead, not their buttons. -->
        <TagsSection :rows="view.tags" />
        <AttributesSection :rows="view.attributes" class="mt-1.5 border-t border-divider pt-5" />
        <UnitsSection :rows="view.units" class="mt-1.5 border-t border-divider pt-5" />
      </template>
      <EmptyState v-else-if="blocker?.kind === 'none'" :text="$t('empty.noInventories')">
        <Button class="h-11 rounded-field" :disabled="!!state.readOnly" @click="creating = true">
          {{ $t('inventory.create') }}
        </Button>
        <AppSheet v-model:open="creating" :title="$t('inventory.new')" :locked="creatingBusy" initial-focus="#inventory-name">
          <InventoryForm v-if="creating" v-model:busy="creatingBusy" mode="create" @done="creating = false" />
        </AppSheet>
      </EmptyState>
      <EmptyState v-else-if="blocker?.kind === 'offline'" :text="$t('empty.offlineNoCopy')">
        <Button variant="outline" class="h-11" @click="retry">{{ $t('status.retry') }}</Button>
      </EmptyState>
      <EmptyState
        v-else-if="blocker?.kind === 'error'"
        :text="$t('empty.sourceFailed', { source: blocker.source.config.name, reason: $t(`errors.probe.${blocker.source.reason ?? 'failed'}`) })"
      >
        <NuxtLink :to="fixTo" :class="linkClass">{{ $t('status.fix') }}</NuxtLink>
      </EmptyState>
      <div v-else class="grid grid-cols-1 gap-3.5" aria-hidden="true">
        <Skeleton class="h-40 rounded-card" />
      </div>
    </ScreenBody>
  </main>
</template>

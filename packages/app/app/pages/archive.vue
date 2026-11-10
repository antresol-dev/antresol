<script setup lang="ts">
import type { Command } from '@graymatter/core'
import { toast } from 'vue-sonner'
import type { ArchiveRow } from '~/components/ArchiveList.vue'
import { archiveEntries } from '~/lib/archive'
import { errorMessageKey } from '~/lib/errors'
import { formatDate } from '~/lib/format'
import type { InventoryRef } from '~/lib/types'

definePageMeta({ layout: 'default' })

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

interface Job {
  row: ArchiveRow
  ref: InventoryRef
  restore: Command
  remove: Command
  /** Text of the delete confirmation. */
  confirm: string
}

const snapshot = computed(() => state.snapshot)
const manySources = computed(() => state.sources.length > 1)
const sourceReady = (sourceId: string): boolean => state.sources.find((s) => s.config.id === sourceId)?.status === 'ready'

const writing = ref<string | null>(null)
const confirming = ref<Job | null>(null)

const inventoryJobs = computed<Job[]>(() =>
  state.archivedInventories.map((e) => {
    const sub = [manySources.value ? e.sourceName : null, t('archive.archivedOn', { date: formatDate(e.inventory.archivedAt ?? '') })]
    return {
      row: {
        key: `inventory:${e.ref.sourceId}:${e.ref.inventoryId}`,
        kind: 'inventory',
        name: e.inventory.name,
        sub: sub.filter((x): x is string => !!x).join(' · '),
        locked: !sourceReady(e.ref.sourceId),
        busy: false,
      },
      ref: e.ref,
      restore: { type: 'restore', archiveId: e.inventory.archiveId ?? '' },
      remove: { type: 'deletePermanently', target: 'inventory', id: e.ref.inventoryId },
      confirm: t('archive.confirmInventory', { name: e.inventory.name }),
    }
  }),
)

const entryJobs = computed<Job[]>(() => {
  const s = snapshot.value
  const ref = state.current
  if (!s || !ref) return []
  return archiveEntries(s).map((e) => {
    const name = e.target === 'variant' && e.itemName ? `${e.itemName} · ${e.name}` : e.name
    const sub = [
      e.path || s.inventory.name,
      e.target === 'folder' && e.itemCount > 0 ? t('archive.withItems', e.itemCount) : null,
      t('archive.archivedOn', { date: formatDate(e.archivedAt) }),
    ]
    return {
      row: {
        key: `${e.target}:${e.id}`,
        kind: e.target,
        name,
        sub: sub.filter((x): x is string => !!x).join(' · '),
        locked: !!state.readOnly,
        busy: false,
      },
      ref,
      restore: { type: 'restore', archiveId: e.archiveId },
      remove: { type: 'deletePermanently', target: e.target, id: e.id },
      confirm: t(`archive.confirm.${e.target}`, { name }),
    }
  })
})

const jobs = computed(() => [...inventoryJobs.value, ...entryJobs.value])
const rowsOf = (list: Job[]): ArchiveRow[] => list.map((j) => ({ ...j.row, busy: writing.value === j.row.key }))
const find = (key: string): Job | undefined => jobs.value.find((j) => j.row.key === key)

const loading = computed(() => !snapshot.value && state.current !== null)
const empty = computed(() => !loading.value && jobs.value.length === 0)

async function run(job: Job, command: Command, done?: () => string): Promise<void> {
  if (writing.value) return
  writing.value = job.row.key
  try {
    await workspace.applyTo(job.ref, command)
    if (done) toast.success(done())
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    writing.value = null
  }
}

function restore(key: string): void {
  const job = find(key)
  if (job) void run(job, job.restore, () => t('archive.restored', { name: job.row.name }))
}
function ask(key: string): void {
  confirming.value = find(key) ?? null
}
const confirmOpen = computed({
  get: () => confirming.value !== null,
  set: (open) => {
    if (!open && !writing.value) confirming.value = null
  },
})
async function remove(): Promise<void> {
  const job = confirming.value
  if (!job) return
  await run(job, job.remove)
  confirming.value = null
}
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="$t('archive.title')" />
    <ScreenBody>
      <section v-if="inventoryJobs.length > 0" class="grid min-w-0 grid-cols-1 gap-2">
        <h2 class="px-1 text-[13px] font-semibold text-subtle-foreground">{{ $t('archive.inventories') }}</h2>
        <ArchiveList :rows="rowsOf(inventoryJobs)" @restore="restore" @remove="ask" />
      </section>
      <section v-if="snapshot && entryJobs.length > 0" class="grid min-w-0 grid-cols-1 gap-2">
        <h2 class="px-1 text-[13px] font-semibold text-subtle-foreground wrap-anywhere">{{ snapshot.inventory.name }}</h2>
        <ArchiveList :rows="rowsOf(entryJobs)" @restore="restore" @remove="ask" />
      </section>
      <div v-else-if="loading" class="grid grid-cols-1 gap-3.5" aria-hidden="true">
        <Skeleton class="h-40 rounded-card" />
      </div>
      <EmptyState v-if="empty" :text="$t('archive.empty')" />
    </ScreenBody>
    <ConfirmSheet
      v-model:open="confirmOpen"
      :title="$t('archive.deleteTitle')"
      :description="confirming?.confirm ?? ''"
      :confirm-label="$t(writing ? 'status.saving' : 'archive.deleteConfirm')"
      :busy="!!writing"
      destructive
      @confirm="remove"
    />
  </main>
</template>

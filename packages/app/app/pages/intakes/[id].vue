<script setup lang="ts">
import { StorageError, type Id } from '@antresol/core'
import { Pencil } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { errorMessageKey } from '~/lib/errors'
import type { LocalIntakeDraft } from '~/lib/intake-drafts'
import { intakeTitle } from '~/lib/intake-list'

definePageMeta({ layout: 'default' })

const { t } = useI18n()
const route = useRoute('intakes-id')
const id = computed(() => String(route.params.id))
const { state } = useWorkspace()
const intakes = useIntakes()
const { list, rows, loading, failureKey, reload } = useIntakeList()

const snapshot = computed(() => {
  const s = state.snapshot
  return s && s.inventory.id === state.current?.inventoryId ? s : null
})
/** The database's row of this intake, and the row as listed (with this device's draft over it). */
const row = computed(() => rows.value?.find((i) => i.id === id.value) ?? null)
const intake = computed(() => list.value?.find((i) => i.id === id.value) ?? null)
const shops = computed(() => [...new Set((list.value ?? []).map((i) => i.header.shop?.trim()).filter((x): x is string => !!x))].sort())

// The draft to edit, from this device or the database; `missing`: there is none (committed, deleted, never was).
const opened = shallowRef<{ id: Id; draft: LocalIntakeDraft } | null>(null)
const missing = ref(false)
const loadErrorKey = ref<string | null>(null)
let latest = 0

async function open(): Promise<void> {
  const target = id.value
  const n = ++latest
  try {
    const draft = await intakes.drafts.load(target, row.value, { create: false })
    if (n !== latest) return
    opened.value = { id: target, draft }
    missing.value = false
    loadErrorKey.value = null
  } catch (e) {
    if (n !== latest) return
    opened.value = null
    if (e instanceof StorageError && e.code === 'not_found') missing.value = true
    else loadErrorKey.value = errorMessageKey(e)
  }
}
onScopeDispose(() => latest++)

watch(id, () => {
  opened.value = null
  missing.value = false
  loadErrorKey.value = null
})
// Loaded once the list has answered (or failed: the device copy still opens offline), and again when the database's
// row of it changes: committed, or saved on another device.
const rowKey = computed(() =>
  loading.value || !state.current ? null : `${state.current.inventoryId}:${id.value}:${row.value?.status ?? ''}:${row.value?.draftRev ?? ''}`,
)
watch(rowKey, (key) => {
  if (key !== null) void open()
}, { immediate: true })

async function gone(): Promise<void> {
  await reload()
  await open()
}

const view = computed(() => {
  if (opened.value?.id === id.value && snapshot.value) return 'draft'
  if (!missing.value && !loadErrorKey.value) return 'loading'
  if (missing.value && intake.value?.status === 'committed' && snapshot.value) return 'record'
  if (failureKey.value) return 'failure'
  if (loadErrorKey.value) return 'error'
  return 'missing'
})

const editing = ref(false)
const crumbs = computed(() => [{ name: t('intakes.title'), to: '/intakes' }])
const title = computed(() => (view.value === 'record' && intake.value ? intakeTitle(intake.value.header) : t('intakes.title')))
</script>

<template>
  <IntakeDraftScreen
    v-if="view === 'draft' && opened && snapshot"
    :key="opened.id"
    :intake-id="opened.id"
    :draft="opened.draft"
    :snapshot="snapshot"
    :author="row?.createdBy ?? null"
    :shops="shops"
    @gone="gone"
  />
  <main v-else class="min-w-0">
    <ScreenHeader :title="title" :crumbs="crumbs" wrap-title>
      <template v-if="view === 'record'" #actions="{ compact }">
        <Button v-if="compact" variant="ghost" size="icon" class="size-11 disabled:opacity-35" :aria-label="$t('intakes.edit')" :disabled="!!state.readOnly" @click="editing = true">
          <Pencil class="size-5" aria-hidden="true" />
        </Button>
        <Button v-else variant="outline" class="h-9 rounded-field" :disabled="!!state.readOnly" @click="editing = true">
          <Pencil class="size-4" aria-hidden="true" />
          {{ $t('intakes.edit') }}
        </Button>
      </template>
    </ScreenHeader>
    <ScreenBody>
      <div v-if="view === 'loading' || (view === 'draft' && !snapshot)" class="grid grid-cols-1 gap-3.5" aria-hidden="true">
        <Skeleton class="h-40 rounded-card" />
      </div>
      <template v-else-if="view === 'record' && intake && snapshot">
        <IntakeRecord :intake="intake" :snapshot="snapshot" />
        <IntakeHeaderSheet v-model:open="editing" :intake-id="intake.id" :header="intake.header" :shops="shops" @saved="reload" />
      </template>
      <EmptyState v-else-if="view === 'failure' && failureKey" :text="$t(failureKey)">
        <Button variant="outline" class="h-11" @click="reload">{{ $t('status.retry') }}</Button>
      </EmptyState>
      <EmptyState v-else-if="view === 'error' && loadErrorKey" :text="$t(loadErrorKey)">
        <Button variant="outline" class="h-11" @click="open">{{ $t('status.retry') }}</Button>
      </EmptyState>
      <EmptyState v-else :text="$t('intakes.notFound')">
        <Button variant="outline" class="h-11" as-child>
          <NuxtLink to="/intakes">{{ $t('intakes.backToList') }}</NuxtLink>
        </Button>
      </EmptyState>
    </ScreenBody>
  </main>
</template>

<script setup lang="ts">
import { resolveIntake, type Id, type IntakeDraftContent, type IntakeHeader, type InventorySnapshot } from '@antresol/core'
import { useIntervalFn } from '@vueuse/core'
import { FolderPlus, Pencil, Plus, Trash2, TriangleAlert } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { errorMessageKey } from '~/lib/errors'
import type { LocalIntakeDraft } from '~/lib/intake-drafts'
import { commitLabel } from '~/lib/intake-line'
import { formatDay, intakeTitle } from '~/lib/intake-list'
import { isUnknownOutcome } from '~/lib/unconfirmed'

// A draft intake (spec 2026-11-13 intakes §5, variant A): the header in one line, the lines, "+ Add line" and
// "Commit". Edits go to this device at once and to the database after a pause (useIntakes().drafts); leaving the
// screen sends them at once.
const props = defineProps<{
  intakeId: Id
  /** The draft as loaded (drafts.load); loaded again when the database's row changes. */
  draft: LocalIntakeDraft
  snapshot: InventorySnapshot
  /** Who started it, for the header line; null: this device. */
  author: string | null
  shops: string[]
}>()
const emit = defineEmits<{
  /** The draft is gone from this device: committed, or discarded in favour of a commit made elsewhere. */
  gone: []
}>()

const { t } = useI18n()
const { state } = useWorkspace()
const intakes = useIntakes()
const sender = intakes.commitSender()

const local = shallowRef<LocalIntakeDraft>(props.draft)
/** Edits on their way to the device copy, and edits started so far: a copy read before an edit is stale. */
let pending = 0
let started = 0
watch(
  () => props.draft,
  (d) => {
    if (pending === 0) local.value = d
  },
)

const committedElsewhere = computed(() => local.value.changedElsewhere?.status === 'committed')
const changedElsewhere = computed(() => local.value.changedElsewhere?.status === 'draft')
// Offline the draft is still edited (on this device); a newer schema, a commit made elsewhere or a commit of this one
// on its way (or unconfirmed) stop that.
const readOnly = computed(
  () => state.readOnly === 'schema_newer' || committedElsewhere.value || sender.busy.value || sender.frozen.value,
)

/** Problems from the last commit attempt (resolved against a fresh copy), until the next edit. */
const commitProblems = shallowRef<Record<Id, string>>({})
const commitErrorKey = ref<string | null>(null)

async function edit(change: (c: IntakeDraftContent) => IntakeDraftContent): Promise<boolean> {
  if (readOnly.value) return false
  pending++
  started++
  try {
    local.value = await intakes.drafts.edit(props.intakeId, (d) => ({ ...d, content: change(d.content) }))
    commitProblems.value = {}
    commitErrorKey.value = null
    return true
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
    return false
  } finally {
    pending--
  }
}

/** The device copy again: saved meanwhile, or found changed elsewhere by its last write. */
async function refresh(): Promise<void> {
  const before = started
  const copy = await intakes.drafts.peek(props.intakeId)
  if (!copy || before !== started || pending > 0) return
  local.value = copy
}
useIntervalFn(() => void refresh(), 4000)

// Leaving the screen sends what the database does not have yet.
onBeforeRouteLeave(() => {
  void intakes.drafts.flush(props.intakeId)
})
onBeforeUnmount(() => {
  void intakes.drafts.flush(props.intakeId)
})

const content = computed(() => local.value.content)
const resolved = computed(() => resolveIntake(content.value, props.snapshot))
const resolutionOf = computed(() => new Map(resolved.value.lines.map((l) => [l.lineId, l.resolution] as const)))
/** What blocks the commit, in words: neutral when a folder, attribute or new item is among it, not only lines. */
const fixKey = computed(() => (resolved.value.entities.some((e) => e.problem !== null) ? 'intakes.screen.fixProblems' : 'intakes.screen.fixLines'))
const hasProblems = computed(() => !resolved.value.ok || Object.keys(commitProblems.value).length > 0)
const lineCount = computed(() => content.value.lines.length)
const label = computed(() => commitLabel(content.value, resolved.value))

const title = computed(() => intakeTitle(local.value.header))
const crumbs = computed(() => [{ name: t('intakes.title'), to: '/intakes' }])
const headerLine = computed(() =>
  [
    t('intakes.screen.purchased', { date: formatDay(local.value.header.purchasedOn) }),
    t('intakes.screen.by', { name: props.author || state.deviceName }),
    local.value.dirty ? t('intakes.screen.onDevice') : null,
  ]
    .filter(Boolean)
    .join(' · '),
)

// ---- Line sheet ----
const sheetOpen = ref(false)
const sheetLine = ref<Id | null>(null)
function openLine(id: Id | null): void {
  sheetLine.value = id
  sheetOpen.value = true
}

// ---- Draft folders ----
const folderOpen = ref(false)
const folderId = ref<Id | null>(null)
function openFolder(id: Id | null): void {
  folderId.value = id
  folderOpen.value = true
}

// ---- Header, delete ----
const editingHeader = ref(false)
async function saveHeader(header: IntakeHeader): Promise<void> {
  if (readOnly.value) return
  pending++
  started++
  try {
    local.value = await intakes.drafts.edit(props.intakeId, (d) => ({ ...d, header }))
  } finally {
    pending--
  }
}

const confirmingDelete = ref(false)
const deleting = ref(false)
async function deleteDraft(): Promise<void> {
  deleting.value = true
  try {
    // A new draft never edited lives only in memory: nothing to delete in the database.
    if (local.value.baseDraftRev === null && !local.value.dirty) await intakes.drafts.forget(props.intakeId)
    else await intakes.deleteDraft(props.intakeId)
    confirmingDelete.value = false
    toast.success(t('intakes.screen.deleted'))
    await navigateTo('/intakes')
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    deleting.value = false
  }
}
const menu = computed(() => [{ key: 'delete', label: t('intakes.screen.delete'), icon: Trash2, destructive: true, disabled: state.readOnly === 'schema_newer' }])

// ---- Changed elsewhere ----
const resolving = ref(false)
async function resolve(choice: 'keepMine' | 'takeTheirs'): Promise<void> {
  resolving.value = true
  try {
    await intakes.drafts.resolveConflict(props.intakeId, choice)
    if (committedElsewhere.value) {
      emit('gone')
      return
    }
    await refresh()
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    resolving.value = false
  }
}

// ---- Commit ----
const canCommit = computed(
  () => label.value !== null && !hasProblems.value && !readOnly.value && !state.readOnly && !changedElsewhere.value,
)
async function commit(): Promise<void> {
  if (sender.busy.value) return
  if (!sender.frozen.value && !canCommit.value) return
  commitErrorKey.value = null
  const result = sender.frozen.value ? await sender.retry() : await sender.send(props.intakeId)
  if (result?.ok) {
    toast.success(t('intakes.screen.committed'))
    emit('gone')
    return
  }
  if (result) {
    commitProblems.value = Object.fromEntries(result.problems.map((p) => [p.lineId, p.code]))
    commitErrorKey.value = fixKey.value
    return
  }
  // Refused: edits from another device are shown now (conflict), or the source could not be reached.
  await refresh()
  commitErrorKey.value = sender.frozen.value ? null : errorMessageKey(sender.error.value)
}
const retryErrorKey = computed(() =>
  sender.frozen.value && !isUnknownOutcome(sender.error.value) ? errorMessageKey(sender.error.value) : null,
)
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="title" :crumbs="crumbs" wrap-title>
      <template #actions="{ compact }">
        <Button v-if="compact" variant="ghost" size="icon" class="size-11 disabled:opacity-35" :aria-label="$t('intakes.screen.details')" :disabled="readOnly" @click="editingHeader = true">
          <Pencil class="size-5" aria-hidden="true" />
        </Button>
        <Button v-else variant="outline" class="h-9 rounded-field" :disabled="readOnly" @click="editingHeader = true">
          <Pencil class="size-4" aria-hidden="true" />
          {{ $t('intakes.screen.details') }}
        </Button>
        <Button v-if="compact" variant="ghost" size="icon" class="size-11 disabled:opacity-35" :aria-label="$t('intakes.screen.newFolder')" :disabled="readOnly" @click="openFolder(null)">
          <FolderPlus class="size-5" aria-hidden="true" />
        </Button>
        <Button v-else variant="outline" class="h-9 rounded-field" :disabled="readOnly" @click="openFolder(null)">
          <FolderPlus class="size-4" aria-hidden="true" />
          {{ $t('intakes.screen.newFolder') }}
        </Button>
        <RowMenu :class="compact ? 'size-11' : 'size-9'" :label="title" :button-label="$t('intakes.screen.more')" :actions="menu" @select="confirmingDelete = true" />
      </template>
    </ScreenHeader>
    <ScreenBody>
      <div v-if="committedElsewhere" class="grid gap-2 rounded-field border border-warning px-3 py-3 text-sm" role="alert">
        <p class="flex items-center gap-2 font-semibold"><TriangleAlert class="size-4 shrink-0 text-warning" aria-hidden="true" />{{ $t('intakes.screen.committedTitle') }}</p>
        <p class="text-muted-foreground">{{ $t('intakes.screen.committedText') }}</p>
        <div>
          <Button variant="outline" class="h-11" :disabled="resolving" @click="resolve('takeTheirs')">{{ $t('intakes.screen.discard') }}</Button>
        </div>
      </div>
      <div v-else-if="changedElsewhere" class="grid gap-2 rounded-field border border-warning px-3 py-3 text-sm" role="alert">
        <p class="flex items-center gap-2 font-semibold"><TriangleAlert class="size-4 shrink-0 text-warning" aria-hidden="true" />{{ $t('intakes.screen.changedTitle') }}</p>
        <p class="text-muted-foreground">{{ $t('intakes.screen.changedText') }}</p>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" class="h-11" :disabled="resolving || state.readOnly === 'schema_newer'" @click="resolve('keepMine')">{{ $t('intakes.screen.keepMine') }}</Button>
          <Button variant="outline" class="h-11" :disabled="resolving" @click="resolve('takeTheirs')">{{ $t('intakes.screen.takeTheirs') }}</Button>
        </div>
      </div>

      <button
        type="button"
        class="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-field px-3 text-left text-sm text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
        :disabled="readOnly"
        @click="editingHeader = true"
      >
        <span class="min-w-0 grow wrap-anywhere">
          {{ headerLine }}<template v-if="local.header.note"> · {{ local.header.note }}</template>
        </span>
        <Pencil class="size-4 shrink-0 text-icon" aria-hidden="true" />
      </button>

      <IntakeWillCreate :content="content" :snapshot="snapshot" :resolved="resolved" :read-only="readOnly" :edit="edit" @open-folder="openFolder" />

      <section class="grid min-w-0 grid-cols-1 gap-2">
        <h2 class="section-label px-1 text-xs">{{ $t('intakes.lines', lineCount) }}</h2>
        <EmptyState v-if="lineCount === 0" :text="$t('intakes.screen.noLines')" />
        <ul v-else class="surface-list">
          <li
            v-for="line in content.lines"
            :key="line.id"
            class="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
          >
            <IntakeLineRow
              :line="line"
              :resolution="resolutionOf.get(line.id)!"
              :problem="commitProblems[line.id] ?? null"
              :snapshot="snapshot"
              :content="content"
              @open="openLine(line.id)"
            />
          </li>
        </ul>
        <Button variant="outline" class="h-11" :disabled="readOnly" @click="openLine(null)">
          <Plus class="size-4" aria-hidden="true" />
          {{ $t('intakes.screen.addLine') }}
        </Button>
      </section>

      <div class="grid gap-2">
        <p role="alert" class="text-sm text-destructive">
          <template v-if="sender.frozen.value">
            {{ $t('unconfirmed.hint') }}<template v-if="retryErrorKey"> {{ $t(retryErrorKey) }}</template>
          </template>
          <template v-else-if="commitErrorKey">{{ $t(commitErrorKey) }}</template>
          <template v-else-if="label && hasProblems">{{ $t(fixKey) }}</template>
          <template v-else-if="label && state.readOnly === 'offline'">{{ $t('intakes.screen.offline') }}</template>
        </p>
        <Button v-if="sender.frozen.value" class="h-11 rounded-field" :disabled="sender.busy.value" @click="commit">
          {{ $t(sender.busy.value ? 'intakes.screen.committing' : 'unconfirmed.retry') }}
        </Button>
        <Button v-else class="h-11 rounded-field" :disabled="!canCommit || sender.busy.value" @click="commit">
          {{ sender.busy.value ? $t('intakes.screen.committing') : label ? $t(label.key, label.count) : $t('intakes.screen.commit') }}
        </Button>
      </div>

      <IntakeLineSheet v-model:open="sheetOpen" :line-id="sheetLine" :content="content" :snapshot="snapshot" :read-only="readOnly" :edit="edit" />
      <IntakeFolderSheet v-model:open="folderOpen" :folder-id="folderId" :content="content" :snapshot="snapshot" :read-only="readOnly" :edit="edit" />
      <IntakeHeaderSheet v-model:open="editingHeader" :intake-id="intakeId" :header="local.header" :shops="shops" :save-draft="saveHeader" />
      <ConfirmSheet
        v-model:open="confirmingDelete"
        :title="$t('intakes.screen.deleteTitle')"
        :description="$t('intakes.screen.deleteConfirm')"
        :summary="title"
        :confirm-label="$t('intakes.screen.delete')"
        :busy="deleting"
        destructive
        @confirm="deleteDraft"
      />
    </ScreenBody>
  </main>
</template>

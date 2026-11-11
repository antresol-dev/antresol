<script setup lang="ts">
import { StorageError, type RestoreMode } from '@graymatter/core'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  backupSummary,
  fingerprint,
  parseBackup,
  restoreChoice,
  restoreOutcome,
  withInventoryNames,
  type BackupFile,
  type BackupProblem,
} from '~/lib/backup'
import type { RestoreRun } from '~/lib/device-db'
import { errorMessageKey } from '~/lib/errors'
import { formatDateTime } from '~/lib/format'
import type { SourceConfig } from '~/lib/types'

// Settings → source → "Restore from backup…": a backup file, its summary, how to restore it, and the rows going in.
const props = defineProps<{ source: SourceConfig }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const router = useRouter()
const workspace = useWorkspace()
const { state } = workspace

const input = ref<HTMLInputElement | null>(null)
/** The file, and this device's last restore run of it (kept across reloads of the app). */
const picked = shallowRef<{ backup: BackupFile; sha: string; run: RestoreRun | null } | null>(null)
const problem = ref<{ key: BackupProblem; reason?: string } | null>(null)
const reading = ref(false)
const mode = ref<RestoreMode>('new-ids')
const busy = ref(false)
const progress = ref<{ done: number; total: number } | null>(null)
const errorKey = ref<string | null>(null)
/** Running the failed restore again finishes it (not after a refusal that wrote nothing). */
const canRetry = ref(false)

watch(open, (isOpen) => {
  if (!isOpen || busy.value) return
  picked.value = null
  problem.value = null
  progress.value = null
  errorKey.value = null
})

/** The source's inventories, archived ones included. */
const sourceInventories = computed(
  () => [...state.inventories, ...state.archivedInventories].filter((e) => e.ref.sourceId === props.source.id).length,
)
/** The same ids only into an empty source, or to go on with a restore of this file into it that did not finish: next to
 *  other data, the same ids could mix two states of one inventory. */
const choice = computed(() =>
  picked.value
    ? restoreChoice({ run: picked.value.run, sourceId: props.source.id, sourceInventories: sourceInventories.value })
    : null,
)
const sameIdsAllowed = computed(() => choice.value?.sameIdsAllowed ?? false)
const sameIdsHint = computed(() =>
  !sameIdsAllowed.value ? 'backup.sameIdsBlocked' : sourceInventories.value === 0 ? 'backup.sameIdsHint' : 'backup.sameIdsResume',
)

async function choose(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  reading.value = true
  picked.value = null
  problem.value = null
  errorKey.value = null
  progress.value = null
  try {
    const text = await file.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      problem.value = { key: 'format' }
      return
    }
    const parsed = parseBackup(json)
    if ('error' in parsed) {
      problem.value = { key: parsed.error, reason: parsed.reason }
      return
    }
    const sha = await fingerprint(text)
    picked.value = { backup: parsed, sha, run: await workspace.restoreRun(sha).catch(() => null) }
    // A run of this file into this source that did not finish goes on as it started; otherwise an empty source takes
    // the same ids, anything else new ones.
    mode.value = choice.value!.mode
  } catch {
    problem.value = { key: 'format' }
  } finally {
    reading.value = false
  }
}

const count = (key: string, n: number): string => t(key, { count: n.toLocaleString('en') }, n)
const summary = computed(() => {
  if (!picked.value) return null
  const s = backupSummary(picked.value.backup)
  return [count('backup.inventories', s.inventories), count('backup.items', s.items), count('backup.movements', s.movements)].join(' · ')
})

async function restore(): Promise<void> {
  const chosen = picked.value
  if (!chosen || busy.value) return
  if (mode.value === 'same-ids' && !sameIdsAllowed.value) return
  busy.value = true
  errorKey.value = null
  progress.value = null
  try {
    // New inventories are told apart from the ones they were copied from.
    const backup =
      mode.value === 'new-ids' ? withInventoryNames(chosen.backup, (name) => t('backup.restoredName', { name })) : chosen.backup
    const { added } = await workspace.restoreSource(props.source.id, backup, mode.value, chosen.sha, (done, total) => {
      progress.value = { done, total }
    })
    // What this run actually wrote: a run that goes on with an earlier one adds only what that one did not.
    const outcome = restoreOutcome(added)
    toast.success(count(outcome.key, outcome.count), {
      action: { label: t('backup.open'), onClick: () => void router.push('/') },
    })
    open.value = false
  } catch (e) {
    errorKey.value = errorMessageKey(e)
    canRetry.value = !(e instanceof StorageError && e.code === 'not_empty')
    // The run as the device now keeps it: unfinished (the same file chosen again goes on with it), or forgotten.
    const run = await workspace.restoreRun(chosen.sha).catch(() => chosen.run)
    if (picked.value === chosen) picked.value = { ...chosen, run }
    if (mode.value === 'same-ids' && !sameIdsAllowed.value) mode.value = 'new-ids'
  } finally {
    busy.value = false
  }
}

const percent = computed(() =>
  progress.value && progress.value.total > 0 ? Math.round((progress.value.done / progress.value.total) * 100) : 0,
)
</script>

<template>
  <AppSheet
    v-model:open="open"
    :locked="busy"
    :title="$t('backup.restoreTitle')"
    :description="$t('backup.restoreDescription', { name: source.name })"
  >
    <div class="mt-2 grid gap-3.5">
      <input ref="input" type="file" accept=".json,application/json" class="hidden" tabindex="-1" @change="choose" >
      <div v-if="picked" class="grid gap-0.5 rounded-field border border-border bg-background px-3 py-2.5">
        <p class="text-sm font-semibold break-words">{{ summary }}</p>
        <p class="text-sm text-subtle-foreground break-words">
          {{ $t('backup.exported', { date: formatDateTime(picked.backup.exportedAt), name: picked.backup.source.name }) }}
        </p>
      </div>
      <p v-if="choice?.unfinished && !errorKey" role="status" class="text-sm break-words">{{ $t('backup.unfinished') }}</p>
      <p v-if="problem" role="alert" class="text-sm text-destructive">
        {{ $t(`backup.problem.${problem.key}`) }}
        <span v-if="problem.reason" class="block text-subtle-foreground break-words">{{ problem.reason }}</span>
      </p>
      <Button
        type="button"
        variant="outline"
        class="h-11 justify-self-start rounded-field bg-surface"
        :disabled="busy || reading"
        @click="input?.click()"
      >
        {{ picked ? $t('backup.chooseOther') : $t('backup.chooseFile') }}
      </Button>

      <RadioGroup v-if="picked" v-model="mode" :aria-label="$t('backup.mode')" :disabled="busy" class="grid gap-1">
        <label
          :class="[
            'flex min-h-11 items-start gap-2.5 rounded-sm px-2 py-2 text-sm transition-colors duration-150',
            sameIdsAllowed && 'cursor-pointer hover:bg-hover',
          ]"
        >
          <RadioGroupItem value="same-ids" :disabled="!sameIdsAllowed" class="mt-0.5" />
          <span class="grid gap-0.5">
            <span class="font-semibold">{{ $t('backup.sameIds') }}</span>
            <span class="text-subtle-foreground">{{ $t(sameIdsHint) }}</span>
          </span>
        </label>
        <label class="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-sm px-2 py-2 text-sm transition-colors duration-150 hover:bg-hover">
          <RadioGroupItem value="new-ids" class="mt-0.5" />
          <span class="grid gap-0.5">
            <span class="font-semibold">{{ $t('backup.newIds') }}</span>
            <span class="text-subtle-foreground">{{ $t('backup.newIdsHint') }}</span>
          </span>
        </label>
      </RadioGroup>
      <p v-if="choice?.restoredBefore && mode === 'new-ids'" class="text-sm text-subtle-foreground break-words">
        {{ $t('backup.restoredBefore') }}
      </p>

      <div v-if="progress && busy" class="grid gap-1.5">
        <div class="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
          <div class="h-full bg-primary transition-[width] duration-150" :style="{ width: `${percent}%` }" />
        </div>
        <p class="text-sm text-subtle-foreground">
          {{ $t('backup.running', { done: progress.done.toLocaleString('en'), total: progress.total.toLocaleString('en') }) }}
        </p>
      </div>
      <p v-if="errorKey" role="alert" class="text-sm text-destructive">
        {{ $t(errorKey) }}<template v-if="canRetry"> {{ $t('backup.again') }}</template>
      </p>
    </div>
    <template #footer>
      <Button
        type="button"
        data-primary
        class="h-11 rounded-field"
        :disabled="!picked || busy || (mode === 'same-ids' && !sameIdsAllowed)"
        @click="restore"
      >
        {{ busy ? $t('backup.restoring') : $t('backup.start') }}
      </Button>
      <Button type="button" variant="outline" class="h-11 rounded-field bg-surface" :disabled="busy" @click="open = false">
        {{ $t('ui.cancel') }}
      </Button>
    </template>
  </AppSheet>
</template>

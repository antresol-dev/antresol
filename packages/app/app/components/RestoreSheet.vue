<script setup lang="ts">
import type { RestoreMode } from '@graymatter/core'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { backupSummary, fingerprint, parseBackup, withInventoryNames, type BackupFile, type BackupProblem } from '~/lib/backup'
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
const picked = shallowRef<{ backup: BackupFile; sha: string } | null>(null)
const problem = ref<BackupProblem | null>(null)
const reading = ref(false)
const mode = ref<RestoreMode>('new-ids')
const busy = ref(false)
const progress = ref<{ done: number; total: number } | null>(null)
const errorKey = ref<string | null>(null)
/** The last run that failed, while this sheet's settings screen is open. */
let lastRun: { sha: string; mode: RestoreMode } | null = null

watch(open, (isOpen) => {
  if (!isOpen || busy.value) return
  picked.value = null
  problem.value = null
  progress.value = null
  errorKey.value = null
})

/** The source's inventories, archived ones included. */
const sourceInventoryIds = computed(() =>
  [...state.inventories, ...state.archivedInventories].filter((e) => e.ref.sourceId === props.source.id).map((e) => e.inventory.id),
)
/** The same ids only into a source that holds nothing but this backup's inventories: empty, or a restore of this file
 *  that stopped midway. Next to other data, the same ids could mix two states of one inventory. */
const sameIdsAllowed = computed(() => {
  const ids = new Set(picked.value?.backup.inventories.map((e) => e.snapshot.inventory.id) ?? [])
  return sourceInventoryIds.value.every((id) => ids.has(id))
})

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
      problem.value = 'format'
      return
    }
    const parsed = parseBackup(json)
    if ('error' in parsed) {
      problem.value = parsed.error
      return
    }
    const sha = await fingerprint(text)
    picked.value = { backup: parsed, sha }
    // A run of this file that stopped goes on as it started; otherwise an empty source takes the same ids, anything
    // else new ones.
    if (lastRun?.sha === sha && (lastRun.mode === 'new-ids' || sameIdsAllowed.value)) mode.value = lastRun.mode
    else mode.value = sourceInventoryIds.value.length === 0 ? 'same-ids' : 'new-ids'
  } catch {
    problem.value = 'format'
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
    const { inventoryIds } = await workspace.restoreSource(props.source.id, backup, mode.value, chosen.sha, (done, total) => {
      progress.value = { done, total }
    })
    toast.success(t('backup.restored', inventoryIds.length), {
      action: { label: t('backup.open'), onClick: () => void router.push('/') },
    })
    lastRun = null
    open.value = false
  } catch (e) {
    // The same file chosen again goes on in the same way.
    lastRun = { sha: chosen.sha, mode: mode.value }
    errorKey.value = errorMessageKey(e)
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
      <p v-if="problem" role="alert" class="text-sm text-destructive">{{ $t(`backup.problem.${problem}`) }}</p>
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
            <span class="text-subtle-foreground">{{ $t(sameIdsAllowed ? 'backup.sameIdsHint' : 'backup.sameIdsBlocked') }}</span>
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

      <div v-if="progress && busy" class="grid gap-1.5">
        <div class="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
          <div class="h-full bg-primary transition-[width] duration-150" :style="{ width: `${percent}%` }" />
        </div>
        <p class="text-sm text-subtle-foreground">
          {{ $t('backup.running', { done: progress.done.toLocaleString('en'), total: progress.total.toLocaleString('en') }) }}
        </p>
      </div>
      <p v-if="errorKey" role="alert" class="text-sm text-destructive">
        {{ $t(errorKey) }} {{ $t('backup.again') }}
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

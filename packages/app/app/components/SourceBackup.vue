<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { lastBackupAgo, type LastBackup } from '~/lib/backup'
import type { SourceState } from '~/lib/workspace-types'

// Settings → a source's Backup block: when this device last saved a backup of it, export, and restore from a file.
const props = defineProps<{ source: SourceState }>()
const workspace = useWorkspace()
const { exporting, saved, exportBackup } = useBackupExport()

const last = ref<LastBackup | null>(null)
async function readLast(): Promise<void> {
  const info = await workspace.backupInfo(props.source.config.id)
  last.value = lastBackupAgo(info.lastBackupAt, new Date())
}
onMounted(readLast)
watch(saved, readLast)

const connected = computed(() => props.source.status === 'ready' || props.source.status === 'read_only')
const restoring = ref(false)

// Neutral hover; the text keeps its colour.
const action = 'h-11 text-accent-ink'
</script>

<template>
  <div class="grid gap-1 border-t border-divider pt-2">
    <h3 class="text-sm font-semibold">{{ $t('backup.title') }}</h3>
    <p v-if="last" class="text-sm text-subtle-foreground">
      {{ 'count' in last ? $t(last.key, last.count) : $t(last.key) }}
    </p>
    <div class="-mx-2 grid sm:flex sm:flex-wrap">
      <Button variant="ghost" :class="action" :disabled="exporting !== null || !connected" @click="exportBackup(source.config.id)">
        {{ exporting === source.config.id ? $t('settings.sources.exporting') : $t('settings.sources.exportBackup') }}
      </Button>
      <Button variant="ghost" :class="action" :disabled="source.status !== 'ready'" @click="restoring = true">
        {{ $t('backup.restore') }}
      </Button>
    </div>
    <p v-if="source.config.kind === 'neon'" class="text-sm text-subtle-foreground">{{ $t('settings.sources.exportHint') }}</p>
    <RestoreSheet v-model:open="restoring" :source="source.config" />
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { createBackupReminder, lastBackupAgo } from '~/lib/backup'

// One quiet toast per session when the current inventory's Neon source has gone more than 14 days, or more than 200
// writes from this device, without a backup (the demo source lives on the device and is not reminded about). Looked at
// when the app has connected and after writes, never by a timer.
const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace
const { exportBackup } = useBackupExport()
const reminder = createBackupReminder()

const target = computed(() => {
  const sourceId = state.current?.sourceId
  const source = state.sources.find((s) => s.config.id === sourceId)
  return source?.config.kind === 'neon' && source.status === 'ready' && !state.saving ? source.config : null
})

let shown = false
watch(target, async (config) => {
  if (!config || shown) return
  const info = await workspace.backupInfo(config.id)
  // Never backed up: counted from when the source was added on this device.
  if (!reminder.due({ lastBackupAt: info.lastBackupAt ?? config.createdAt, writesSince: info.writesSince, now: new Date() })) return
  shown = true
  const last = lastBackupAgo(info.lastBackupAt, new Date())
  toast(t('backup.remind', { name: config.name }), {
    description: 'count' in last ? t(last.key, last.count) : t(last.key),
    action: { label: t('backup.remindAction'), onClick: () => void exportBackup(config.id) },
  })
}, { immediate: true })
</script>

<template>
  <span hidden />
</template>

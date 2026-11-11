<script setup lang="ts">
import { toast } from 'vue-sonner'
import { lastBackupAgo, watchBackupReminder } from '~/lib/backup'

// One quiet toast per session when the current inventory's Neon source has gone more than 14 days, or more than 200
// writes from this device, without a backup. Looked at when the app has connected and after every write, stock writes
// included (watchBackupReminder); never by a timer. The watch ends with this component.
const { t } = useI18n()
const workspace = useWorkspace()
const { exportBackup } = useBackupExport()

watchBackupReminder(workspace, (config, info) => {
  const last = lastBackupAgo(info.lastBackupAt, new Date())
  toast(t('backup.remind', { name: config.name }), {
    description: 'count' in last ? t(last.key, last.count) : t(last.key),
    action: { label: t('backup.remindAction'), onClick: () => void exportBackup(config.id) },
  })
})
</script>

<template>
  <span hidden />
</template>

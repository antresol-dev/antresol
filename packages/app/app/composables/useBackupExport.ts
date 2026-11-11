import { toast } from 'vue-sonner'
import { shareOrDownload } from '~/lib/backup'
import { errorMessageKey } from '~/lib/errors'

/** The source being exported, app-wide: one export at a time (settings and the reminder's toast share it). */
const exporting = ref<string | null>(null)
/** Bumped after each saved backup: "Last backup" lines read their source's date again. */
const saved = ref(0)

/** Settings → source → "Export backup", and the reminder's "Back up": read the whole source, then the share sheet on a
 *  phone or a download; a backup saved or shared counts as the source's last one. */
export function useBackupExport() {
  const workspace = useWorkspace()
  const { t } = useI18n()

  async function exportBackup(sourceId: string): Promise<void> {
    if (exporting.value) return
    exporting.value = sourceId
    try {
      const backup = await workspace.exportSource(sourceId)
      if ((await shareOrDownload(backup, new Date())) === 'cancelled') return
      await workspace.noteBackup(sourceId)
      saved.value++
    } catch (e) {
      toast.error(t(errorMessageKey(e)))
    } finally {
      exporting.value = null
    }
  }

  return { exporting: readonly(exporting), saved: readonly(saved), exportBackup }
}

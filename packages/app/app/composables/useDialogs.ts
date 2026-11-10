import type { Id } from '@graymatter/core'
import type { Ref } from 'vue'

// One dialog of each kind for the whole app, rendered once in the layout: header buttons, row menus, the tree and
// (later) the palette all open the same sheets.

export type FolderDialog = { kind: 'create'; parentId: Id | null } | { kind: 'rename' | 'move' | 'archive'; folderId: Id }

export function useFolderDialog(): { dialog: Ref<FolderDialog | null>; open(d: FolderDialog): void; close(): void } {
  const dialog = useState<FolderDialog | null>('folder-dialog', () => null)
  return {
    dialog,
    open: (d) => {
      dialog.value = d
    },
    close: () => {
      dialog.value = null
    },
  }
}

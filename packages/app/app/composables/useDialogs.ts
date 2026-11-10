import type { Id } from '@graymatter/core'
import type { Ref } from 'vue'
import { treeCurrent } from '~/lib/shell'

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

export type ItemDialog = { kind: 'edit' | 'move' | 'archive'; itemId: Id }

export function useItemDialog(): { dialog: Ref<ItemDialog | null>; open(d: ItemDialog): void; close(): void } {
  const dialog = useState<ItemDialog | null>('item-dialog', () => null)
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

export interface QuickAddState {
  name: string
  folderId: Id | null
}

/** Opens the quick add sheet; the folder defaults to the screen's folder (treeCurrent; 'root' and null → the root). */
export function useQuickAdd(): {
  state: Ref<QuickAddState | null>
  open(prefill?: { name?: string; folderId?: Id | null }): void
  close(): void
} {
  const state = useState<QuickAddState | null>('quick-add', () => null)
  const workspace = useWorkspace()
  const route = useRoute()
  return {
    state,
    open: (prefill = {}) => {
      const current = treeCurrent(workspace.state.snapshot, typeof route.name === 'string' ? route.name : null, route.params)
      state.value = {
        name: prefill.name ?? '',
        folderId: prefill.folderId !== undefined ? prefill.folderId : current === 'root' || current === null ? null : current,
      }
    },
    close: () => {
      state.value = null
    },
  }
}

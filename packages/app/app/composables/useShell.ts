import type { Ref } from 'vue'

/** Shell state shared by the layout and the screens. */
export function useShell(): { drawerOpen: Ref<boolean> } {
  return { drawerOpen: useState('shell-drawer-open', () => false) }
}

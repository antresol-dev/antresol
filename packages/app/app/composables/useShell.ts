import type { Ref } from 'vue'

/** The ☰ button in the screen header; the drawer returns focus to it when it closes. */
export const MENU_BUTTON_ID = 'nav-menu-button'

/** Shell state shared by the layout and the screens. */
export function useShell(): { drawerOpen: Ref<boolean> } {
  return { drawerOpen: useState('shell-drawer-open', () => false) }
}

import type { Ref } from 'vue'

/** The ☰ button in the screen header; the drawer returns focus to it when it closes. */
export const MENU_BUTTON_ID = 'nav-menu-button'
/** The phone menu's dialog: menu swipes stay on while it is the only open layer. */
export const NAV_DRAWER_ID = 'nav-drawer'

/** Shell state shared by the layout and the screens. The palette's state stays out of the URL and history. */
export function useShell(): { drawerOpen: Ref<boolean>; paletteOpen: Ref<boolean> } {
  return {
    drawerOpen: useState('shell-drawer-open', () => false),
    paletteOpen: useState('shell-palette-open', () => false),
  }
}

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Content keeps clear space from the edge of any highlighted row (owner, 2026-11-12). The highlight fills the row
 * (only the variant list's current row insets it by curM), and rows pad their content by the largest radius any style
 * gives them: 12 px horizontally (10 on the 32 px panel tree rows). Measured in the browser for all nine styles.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../app/${path}`, import.meta.url)), 'utf8')

describe('highlight fills the row', () => {
  const css = read('assets/css/main.css')
  it('the selected row is not inset unless the row asks (.row-inset)', () => {
    expect(/\.row-selected::after \{([^}]*)\}/.exec(css)?.[1]).toMatch(/inset:\s*var\(--row-inset,\s*0\)/)
    expect(/\.row-inset \{([^}]*)\}/.exec(css)?.[1]).toMatch(/--row-inset:\s*var\(--st-cur-m\)/)
  })
  it('only the variant list insets its current row, and pads for the largest inset (8 px) plus 12', () => {
    const bucket = read('components/BucketList.vue')
    expect(bucket).toContain('row-selected row-inset')
    expect(bucket).toMatch(/pr-2\.5 pl-5/)
    for (const f of ['AppNav', 'FolderTreeNode', 'SearchPalette', 'FolderPickerList'])
      expect(read(`components/${f}.vue`)).not.toContain('row-inset')
  })
})

describe('rows pad their content', () => {
  const has = (file: string, re: RegExp) => expect(read(file)).toMatch(re)
  it('nav links and the logo row: 12 px', () => {
    has('components/AppNav.vue', /min-h-11 items-center gap-2\.5 px-3 text-sm/)
    has('components/AppNav.vue', /gap-2 px-3">/)
  })
  it('tree rows: 10 px on the panel, 12 px in the drawer', () => {
    has('components/FolderTreeNode.vue', /'h-8 pr-2\.5 pl-2\.5' : 'min-h-11 pr-3'/)
  })
  it('palette rows: 14 px, clear of a pill-shaped highlight\'s corners', () => {
    has('components/SearchPalette.vue', /rounded-field px-3\.5 select-none/)
  })
  it('menu, select and combobox items: 12 px', () => {
    for (const f of ['dropdown-menu/DropdownMenuItem', 'dropdown-menu/DropdownMenuSubTrigger', 'combobox/ComboboxItem'])
      has(`components/ui/${f}.vue`, /px-3 py-1\.5/)
    for (const f of ['dropdown-menu/DropdownMenuCheckboxItem', 'dropdown-menu/DropdownMenuRadioItem'])
      has(`components/ui/${f}.vue`, /pr-3 pl-9/)
    has('components/ui/select/SelectItem.vue', /pr-9 pl-3/)
  })
  it('the inventory switcher: trigger 16 px (capsule corners), menu rows 12 px', () => {
    has('components/InventorySwitcher.vue', /gap-2\.5 px-4 py-2 text-left/)
    has('components/InventorySwitcher.vue', /gap-2 px-3 py-1\.5 text-left/)
  })
})

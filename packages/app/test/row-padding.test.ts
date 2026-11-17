import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Content keeps clear space from the edge of any highlighted row (owner, 2026-11-12). The highlight fills the row
 * (only the variant list's current row insets it by curM), and rows pad their content by the largest radius any style
 * gives them: 12 px horizontally (the 32 px panel tree rows too). Measured in the browser for all nine styles.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../app/${path}`, import.meta.url)), 'utf8')

describe('highlight fills the row', () => {
  const css = read('assets/css/main.css')
  it('the selected row is not inset unless the row asks (.row-inset)', () => {
    expect(/\.row-selected::after \{([^}]*)\}/.exec(css)?.[1]).toMatch(/inset:\s*var\(--row-inset,\s*0\)/)
    expect(/\.row-inset \{([^}]*)\}/.exec(css)?.[1]).toMatch(/--row-inset:\s*var\(--st-cur-m\)/)
  })
  // Right: 12 px, where the dividers end (right-3), so the "⋯" button's hover clears the list's rounded corner.
  it('only the variant list insets its current row, and pads for the largest inset (8 px) plus 12 (20 on the left)', () => {
    const bucket = read('components/BucketList.vue')
    expect(bucket).toContain('row-selected row-inset')
    expect(bucket).toMatch(/pr-3 pl-5/)
    for (const f of ['AppNav', 'FolderTreeNode', 'SearchPalette', 'FolderPickerList'])
      expect(read(`components/${f}.vue`)).not.toContain('row-inset')
  })
})

describe('rows pad their content', () => {
  const has = (file: string, re: RegExp) => expect(read(file)).toMatch(re)
  it('nav links and the logo row: 12 px', () => {
    has('components/AppNav.vue', /min-h-11 items-center gap-3 px-3 text-sm/)
    has('components/AppNav.vue', /gap-2 px-3">/)
  })
  it('tree rows: 12 px on the panel and in the drawer', () => {
    has('components/FolderTreeNode.vue', /'h-8 px-3' : 'min-h-11 pr-3'/)
  })
  it('palette rows: 12 px, clear of a pill-shaped highlight\'s corners', () => {
    has('components/SearchPalette.vue', /rounded-row px-3 select-none/)
  })
  it('list rows (folders, items): 56 px high, 12 px of padding, dividers from the text (12 + 36 + 12) to 12 px of the edge', () => {
    for (const f of ['FolderList', 'ItemList']) {
      const src = read(`components/${f}.vue`)
      expect(src).toMatch(/h-14 min-w-0 flex-1 items-center gap-3 rounded-row px-3 /)
      expect(src).toMatch(/before:right-3 not-first:before:left-15/)
      expect(src).toMatch(/size-8"/)
    }
  })
  it('menu, select and combobox items: 12 px', () => {
    for (const f of ['dropdown-menu/DropdownMenuItem', 'dropdown-menu/DropdownMenuSubTrigger', 'combobox/ComboboxItem'])
      has(`components/ui/${f}.vue`, /px-3 py-1\.5/)
    for (const f of ['dropdown-menu/DropdownMenuCheckboxItem', 'dropdown-menu/DropdownMenuRadioItem'])
      has(`components/ui/${f}.vue`, /pr-3 pl-9/)
    has('components/ui/select/SelectItem.vue', /pr-9 pl-3/)
  })
  it('the inventory switcher: trigger 16 px (capsule corners), menu rows 12 px', () => {
    has('components/InventorySwitcher.vue', /gap-3 px-4 py-2 text-left/)
    has('components/InventorySwitcher.vue', /gap-2 px-3 py-1\.5 text-left/)
  })
})

/*
 * A row that lights up inside a list, palette, picker or sheet takes the selected row's radius (--radius-row, the
 * style's curR), not a button's or a chip's: in Liquid, Y2K and Retro those are pills, and a pill-shaped highlight stuck
 * out past its container's rounder-than-it corners (owner, 2026-11-17). Fields (bordered, bg-field) keep the field radius.
 */
describe('highlighted rows fit their container', () => {
  it('every hover row outside the ui primitives is rounded-row', () => {
    const dir = fileURLToPath(new URL('../app/components', import.meta.url))
    const problems: string[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.vue')) continue
      for (const m of read(`components/${name}`).matchAll(/class="([^"]*hover:bg-hover[^"]*)"|'([^']*hover:bg-hover[^']*)'/g)) {
        const cls = m[1] ?? m[2] ?? ''
        if (/\bbg-field\b/.test(cls)) continue
        if (/\brounded-(field|chip)\b/.test(cls)) problems.push(`${name}: ${cls.slice(0, 60)}`)
      }
    }
    expect(problems).toEqual([])
  })
})


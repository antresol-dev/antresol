<script setup lang="ts">
import { createSearch } from '@graymatter/core'
import { useMediaQuery } from '@vueuse/core'
import { Archive, ArrowLeftRight, Cpu, Folder, FolderPlus, Plus, Search, SlidersHorizontal, Tags, X } from '@lucide/vue'
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { Component } from 'vue'
import { toast } from 'vue-sonner'
import { DialogOverlay } from '@/components/ui/dialog'
import { errorMessageKey } from '~/lib/errors'
import { bottomUp, paletteResults, stepSelection, type PaletteAction, type PaletteRow } from '~/lib/palette'
import { currentInventoryName, NAV_SECTIONS, treeCurrent } from '~/lib/shell'
import { pathOf, snapshotIndex } from '~/lib/views'

type GoSection = Extract<PaletteAction, { kind: 'go' }>['section']
const SECTION_ICONS: Record<GoSection, Component> = { archive: Archive, dictionaries: Tags, settings: SlidersHorizontal }
// The app panel's sections besides Items, then Settings.
const SECTIONS: GoSection[] = [...NAV_SECTIONS.flatMap((s) => (s.key === 'items' ? [] : [s.key])), 'settings']

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const workspace = useWorkspace()
const { state } = workspace
const { paletteOpen } = useShell()
const folderDialog = useFolderDialog()
const quickAdd = useQuickAdd()
// From 1024 px a window near the top; below, the whole screen with the field at the bottom, above the keyboard.
const desktop = useMediaQuery('(min-width: 1024px)')

// The Android back gesture closes the palette without leaving the screen; the palette never touches the URL or history.
useCloseWatcher(paletteOpen)

const contentId = useId()
const listId = useId()
const input = ref<HTMLInputElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const query = ref('')
const text = computed(() => query.value.trim())
const inventoryName = computed(() => currentInventoryName(state))

// Built once per snapshot object (snapshots are replaced whole), on the first search.
const search = computed(() => (state.snapshot ? createSearch(state.snapshot) : null))

// The folder the screen shows (the item's folder on an item card): where "New folder in …" creates one.
const screenFolder = computed(() => {
  const s = state.snapshot
  const current = treeCurrent(s, typeof route.name === 'string' ? route.name : null, route.params)
  if (!s || current === null) return null
  if (current === 'root') return { id: null, name: s.inventory.name }
  const folder = pathOf(snapshotIndex(s), current).at(-1)
  return folder ? { id: folder.id, name: folder.name } : null
})

function labelOf(a: PaletteAction): string {
  if (a.kind === 'addItem') return t('search.addItem', { name: a.name })
  if (a.kind === 'newFolder') return t('folderMenu.newIn', { name: a.parentName })
  if (a.kind === 'switchInventory') return t('search.switchTo', { name: a.name })
  return t(`nav.${a.section}`)
}
const actionIcon = (a: PaletteAction): Component =>
  a.kind === 'go'
    ? SECTION_ICONS[a.section]
    : a.kind === 'addItem'
      ? Plus
      : a.kind === 'newFolder'
        ? FolderPlus
        : ArrowLeftRight
const groupLabels = computed(() => ({
  items: t('search.group.items'),
  folders: t('search.group.folders'),
  actions: t('search.group.actions'),
}))

const groups = computed(() =>
  paletteResults(
    state.snapshot,
    search.value,
    {
      query: text.value,
      folder: screenFolder.value,
      inventories: state.inventories,
      current: state.current,
      sections: SECTIONS,
      canWrite: !state.readOnly,
    },
    labelOf,
  ),
)
// Below 1024 px results grow upwards from the field, the best one nearest the finger.
const shown = computed(() => (desktop.value ? groups.value : bottomUp(groups.value)))
const shownRows = computed(() => shown.value.flatMap((g) => g.rows))

// The best result is selected until the arrows or the mouse pick another.
const selectedKey = ref<string | null>(null)
const selected = computed(
  () => shownRows.value.find((r) => r.key === selectedKey.value) ?? groups.value[0]?.rows[0] ?? null,
)
const optionId = (row: PaletteRow): string => `${listId}-${row.key}`

watch(
  text,
  () => {
    selectedKey.value = null
    // Back to the best result: the top of the list, or its bottom in the reversed phone list (scrollTop 0 either way).
    if (scroller.value) scroller.value.scrollTop = 0
  },
  { flush: 'post' },
)

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const next = stepSelection(shownRows.value, selected.value?.key ?? null, event.key === 'ArrowDown' ? 1 : -1)
    if (!next) return
    selectedKey.value = next.key
    void nextTick(() => document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (selected.value) void run(selected.value)
  }
}

// Moving the mouse selects; touch scrolling the list doesn't.
function hover(row: PaletteRow, event: PointerEvent): void {
  if (event.pointerType !== 'touch') selectedKey.value = row.key
}

function clear(): void {
  query.value = ''
  input.value?.focus()
}

// What had focus when the palette opened gets it back when it closes.
let opener: HTMLElement | null = null
watch(paletteOpen, (open) => {
  if (!open) return
  // A fresh field every time. Cleared on opening, not on closing, so the window doesn't flash other results as it fades out.
  query.value = ''
  selectedKey.value = null
  const active = document.activeElement
  opener = active instanceof HTMLElement && active !== document.body ? active : null
})

function handBackFocus(): void {
  const active = document.activeElement
  // Focus already moved on, into a sheet that opened in the palette's place: leave it there.
  if (active && active !== document.body && !document.getElementById(contentId)?.contains(active)) return
  const back = opener
  opener = null
  if (back?.isConnected) back.focus()
  // The opener is gone with its screen: the new screen's heading.
  else if (back) document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
}

function onOpenAutoFocus(event: Event): void {
  event.preventDefault()
  input.value?.focus()
}

function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  handBackFocus()
}

async function run(row: PaletteRow): Promise<void> {
  paletteOpen.value = false
  // Focus goes back before anything opens next, so a sheet returns it to the same place when it closes.
  await nextTick()
  handBackFocus()
  if (row.kind === 'item') {
    const { itemId, variantId } = row.hit
    void router.push({ path: `/item/${itemId}`, query: variantId ? { variant: variantId } : {} })
  } else if (row.kind === 'folder') {
    void router.push(`/folder/${row.hit.id}`)
  } else {
    await act(row.action)
  }
}

async function act(action: PaletteAction): Promise<void> {
  if (action.kind === 'addItem') {
    quickAdd.open({ name: action.name })
  } else if (action.kind === 'newFolder') {
    folderDialog.open({ kind: 'create', parentId: action.parentId })
  } else if (action.kind === 'go') {
    void router.push(NAV_SECTIONS.find((s) => s.key === action.section)?.to ?? '/settings')
  } else {
    // As in the inventory switcher: selectInventory sets the current inventory before its first await, so the history
    // entry pushed next is stamped with it; force: a new entry even when the root is already open.
    const selecting = workspace.selectInventory(action.ref)
    void router.push({ path: '/', force: true })
    try {
      await selecting
    } catch (e) {
      toast.error(t(errorMessageKey(e)))
    }
  }
}

const markClass = 'rounded-sm bg-chip text-foreground'
const kbdClass =
  'rounded-md border border-b-2 border-border bg-surface px-1.5 text-[11px] font-semibold text-subtle-foreground'
</script>

<template>
  <DialogRoot v-model:open="paletteOpen">
    <DialogPortal>
      <!-- On the phone the palette covers the screen: the overlay only locks the page's scroll. -->
      <DialogOverlay :class="desktop ? undefined : 'bg-transparent'" />
      <DialogContent
        :id="contentId"
        :aria-describedby="undefined"
        :class="
          desktop
            ? 'fixed top-[72px] left-1/2 z-50 flex max-h-[calc(100dvh-144px)] w-[580px] max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-card border border-border bg-surface shadow-2xl outline-none motion-safe:data-[state=open]:animate-pop-in motion-safe:data-[state=closed]:animate-pop-out motion-reduce:data-[state=open]:animate-fade-in motion-reduce:data-[state=closed]:animate-fade-out'
            : 'fixed inset-0 z-50 flex flex-col-reverse bg-surface outline-none data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out'
        "
        @open-auto-focus="onOpenAutoFocus"
        @close-auto-focus="onCloseAutoFocus"
      >
        <DialogTitle class="sr-only">{{ $t('search.label') }}</DialogTitle>

        <!-- The field: first in the DOM for focus and reading order; below 1024 px it sits at the bottom (flex-col-reverse). -->
        <div
          :class="
            desktop
              ? 'flex shrink-0 items-center border-b border-divider px-4 py-1.5'
              : 'flex shrink-0 items-center gap-1.5 pt-1 pr-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pl-2.5'
          "
        >
          <div
            :class="[
              'flex min-w-0 flex-1 items-center gap-2.5',
              desktop ? 'min-h-11' : 'h-[50px] rounded-card border-2 border-primary pr-0.5 pl-3.5',
            ]"
          >
            <Search class="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref="input"
              v-model="query"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              :aria-label="$t('search.field', { name: inventoryName })"
              :aria-expanded="shownRows.length > 0"
              :aria-controls="shownRows.length > 0 ? listId : undefined"
              :aria-activedescendant="selected ? optionId(selected) : undefined"
              :placeholder="desktop ? $t('search.label') : $t('search.field', { name: inventoryName })"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              enterkeyhint="go"
              class="h-11 min-w-0 flex-1 border-none bg-transparent text-base font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground"
              @keydown="onKeydown"
            >
            <button
              v-if="query"
              type="button"
              class="grid size-11 shrink-0 place-items-center rounded-icon text-muted-foreground outline-none transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:size-8"
              :aria-label="$t('search.clear')"
              @click="clear"
            >
              <X class="size-4" aria-hidden="true" />
            </button>
            <span
              v-if="desktop && inventoryName"
              class="max-w-44 shrink-0 truncate rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent-soft-foreground"
            >
              {{ inventoryName }}
            </span>
          </div>
          <button
            v-if="!desktop"
            type="button"
            class="h-11 shrink-0 rounded-icon px-2 font-bold text-primary outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
            @click="paletteOpen = false"
          >
            {{ $t('ui.cancel') }}
          </button>
        </div>

        <!-- One child: on the phone a column-reverse scroller keeps it pinned to the bottom and scrolls upwards. -->
        <div
          ref="scroller"
          :class="
            desktop
              ? 'min-h-0 max-h-[380px] overflow-y-auto overscroll-contain p-1.5'
              : 'flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain p-2'
          "
        >
          <div v-if="shownRows.length > 0" :id="listId" role="listbox" :aria-label="$t('search.results')" class="grid gap-0.5">
            <div
              v-for="group in shown"
              :key="group.key"
              role="group"
              :aria-labelledby="`${listId}-${group.key}`"
              class="grid gap-0.5"
            >
              <div
                :id="`${listId}-${group.key}`"
                class="px-2.5 pt-2 pb-1 text-[11px] font-extrabold tracking-[0.05em] text-muted-foreground uppercase"
              >
                {{ groupLabels[group.key] }}
              </div>
              <div
                v-for="row in group.rows"
                :id="optionId(row)"
                :key="row.key"
                role="option"
                :aria-selected="row.key === selected?.key"
                :class="[
                  'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-icon px-2.5 transition-colors duration-150 select-none',
                  desktop ? 'py-1.5' : 'py-2',
                  row.key === selected?.key ? 'bg-accent-soft' : '',
                ]"
                @mousedown.prevent
                @pointermove="hover(row, $event)"
                @click="run(row)"
              >
                <template v-if="row.kind === 'item'">
                  <span class="grid size-8 shrink-0 place-items-center rounded-icon bg-thumb text-thumb-foreground">
                    <Cpu class="size-4" stroke-width="1.75" aria-hidden="true" />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-sm font-bold" :class="row.hit.outOfStock && 'text-dimmed-foreground'">
                      <template v-for="(p, i) in row.name" :key="i"><mark v-if="p.match" :class="markClass">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
                      <span v-if="row.variant" class="font-semibold text-muted-foreground">
                        · <template v-for="(p, i) in row.variant" :key="i"><mark v-if="p.match" :class="markClass">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
                      </span>
                    </span>
                    <span v-if="row.hit.path" class="truncate text-xs font-semibold text-muted-foreground">{{ row.hit.path }}</span>
                  </span>
                  <span class="shrink-0 text-sm font-extrabold tabular-nums" :class="row.hit.outOfStock && 'text-muted-foreground'">
                    {{ row.hit.number }}
                    <span class="text-xs font-semibold text-muted-foreground">{{ row.hit.unit }}</span>
                  </span>
                </template>
                <template v-else-if="row.kind === 'folder'">
                  <span
                    :class="[
                      'grid size-8 shrink-0 place-items-center rounded-icon text-accent-soft-foreground',
                      row.key === selected?.key ? 'bg-surface' : 'bg-accent-soft',
                    ]"
                  >
                    <Folder class="size-4" aria-hidden="true" />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-sm font-bold">
                      <template v-for="(p, i) in row.name" :key="i"><mark v-if="p.match" :class="markClass">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
                    </span>
                    <span v-if="row.hit.path" class="truncate text-xs font-semibold text-muted-foreground">{{ row.hit.path }}</span>
                  </span>
                </template>
                <template v-else>
                  <span class="grid size-8 shrink-0 place-items-center rounded-icon bg-chip text-icon">
                    <component :is="actionIcon(row.action)" class="size-4" aria-hidden="true" />
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm font-bold">{{ row.label }}</span>
                </template>
              </div>
            </div>
          </div>
          <p v-else class="px-3 py-6 text-center text-sm font-semibold text-muted-foreground">
            {{ $t('search.nothing', { q: text }) }}
          </p>
        </div>

        <div
          v-if="desktop"
          aria-hidden="true"
          class="flex shrink-0 gap-3.5 border-t border-divider px-3.5 py-2 text-xs font-semibold text-muted-foreground"
        >
          <span><kbd :class="kbdClass">{{ $t('search.key.move') }}</kbd> {{ $t('search.hint.move') }}</span>
          <span><kbd :class="kbdClass">{{ $t('search.key.open') }}</kbd> {{ $t('search.hint.open') }}</span>
          <span><kbd :class="kbdClass">{{ $t('search.key.close') }}</kbd> {{ $t('search.hint.close') }}</span>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

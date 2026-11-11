<script setup lang="ts">
import { createReusableTemplate, useMediaQuery } from '@vueuse/core'
import { Archive, Check, ChevronsUpDown, Pencil, Plus, RefreshCw } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessageKey } from '~/lib/errors'
import { checkedAgo } from '~/lib/format'
import { currentInventoryName } from '~/lib/shell'
import type { InventoryEntry } from '~/lib/workspace'

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace
const router = useRouter()

const desktop = useMediaQuery('(min-width: 768px)')
const [DefineContent, ReuseContent] = createReusableTemplate()
const [DefineTrigger, ReuseTrigger] = createReusableTemplate()

const menuOpen = ref(false)
const dialog = ref<'create' | 'rename' | 'archive' | null>(null)
const archiving = ref(false)
const formBusy = ref(false)
const syncing = ref(false)

// "Checked … ago" is measured against the time the menu was opened, so it is not stale when it is read.
const now = ref(new Date())
watch(menuOpen, (open) => {
  if (open) now.value = new Date()
})
const checked = computed(() => checkedAgo(state.lastRefreshAt, now.value))

async function sync(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  try {
    toast(t((await workspace.sync()) === 'updated' ? 'sync.updated' : 'sync.upToDate'))
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    syncing.value = false
  }
}

// The Android back gesture closes the dropdown; below 768 px the menu is an AppSheet, which watches by itself.
const dropdownOpen = computed({
  get: () => desktop.value && menuOpen.value,
  set: (open: boolean) => {
    menuOpen.value = open
  },
})
useCloseWatcher(dropdownOpen)

const isCurrent = (e: InventoryEntry): boolean =>
  e.ref.sourceId === state.current?.sourceId && e.ref.inventoryId === state.current?.inventoryId

const name = computed(() => currentInventoryName(state))
const hasCurrent = computed(() => !!state.current && !!state.snapshot)
const locked = computed(() => !!state.readOnly || archiving.value)

const groups = computed(() => {
  const grouped = state.sources.length > 1
  const map = new Map<string, InventoryEntry[]>()
  for (const entry of state.inventories) {
    const key = grouped ? entry.sourceName : ''
    map.set(key, [...(map.get(key) ?? []), entry])
  }
  return [...map].map(([label, entries]) => ({ label, entries }))
})

const formOpen = computed({
  get: () => dialog.value === 'create' || dialog.value === 'rename',
  set: (open) => {
    if (!open) dialog.value = null
  },
})
const archiveOpen = computed({
  get: () => dialog.value === 'archive',
  set: (open) => {
    if (!open) dialog.value = null
  },
})

async function choose(entry: InventoryEntry): Promise<void> {
  menuOpen.value = false
  if (isCurrent(entry)) return
  // selectInventory sets the current inventory before its first await, so the history entry pushed next is stamped
  // with the new inventory. force: a new entry even when the root is already open, so Back returns to the old one.
  const selecting = workspace.selectInventory(entry.ref)
  void router.push({ path: '/', force: true })
  try {
    await selecting
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}

// One archive id per opening: a retried Confirm after a timeout sends the same command.
const { ids, renew } = useCommandIds(['archiveId'])
function openDialog(kind: 'create' | 'rename' | 'archive'): void {
  renew()
  menuOpen.value = false
  dialog.value = kind
}

async function archive(): Promise<void> {
  const current = state.current
  if (!current) return
  archiving.value = true
  try {
    await workspace.apply({ type: 'archive', target: 'inventory', id: current.inventoryId, archiveId: ids.archiveId })
    dialog.value = null
    // force: a new history entry stamped with the inventory that is now current.
    await router.push({ path: '/', force: true })
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    archiving.value = false
  }
}

// Menu items show focus with their highlight (radius 10 inside the menu's 20 and 6 px padding); the sheet's rows are
// flat pressable tiles with the base focus outline.
const itemClass = computed(() => [
  'flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-50',
  desktop.value ? 'rounded-chip' : 'pressable',
])
</script>

<template>
  <!-- Attributes on ReuseTrigger (the menu trigger's aria and handlers, @click) fall through to this button. -->
  <DefineTrigger>
    <button
      type="button"
      class="raised pressable flex min-h-11 w-full min-w-0 items-center gap-2.5 px-2.5 py-2 text-left"
    >
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="text-[11px] font-semibold text-subtle-foreground">{{ $t('inventory.label') }}</span>
        <span class="min-h-5 truncate text-sm font-bold">{{ name || (state.current ? '' : $t('inventory.none')) }}</span>
      </span>
      <ChevronsUpDown class="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
    </button>
  </DefineTrigger>
  <DefineContent>
    <div class="grid gap-0.5">
      <template v-for="group in groups" :key="group.label">
        <component
          :is="desktop ? DropdownMenuLabel : 'p'"
          v-if="group.label"
          class="px-2 pt-1 text-xs font-semibold text-subtle-foreground"
        >
          {{ group.label }}
        </component>
        <component
          :is="desktop ? DropdownMenuItem : 'button'"
          v-for="entry in group.entries"
          :key="`${entry.ref.sourceId}/${entry.ref.inventoryId}`"
          :type="desktop ? undefined : 'button'"
          :aria-current="isCurrent(entry) ? 'true' : undefined"
          :class="[itemClass, isCurrent(entry) ? 'font-semibold' : '']"
          @click="choose(entry)"
        >
          <span class="min-w-0 flex-1 truncate">{{ entry.inventory.name }}</span>
          <Check v-if="isCurrent(entry)" class="size-4 shrink-0 text-accent-ink" aria-hidden="true" />
        </component>
      </template>
      <component :is="desktop ? DropdownMenuSeparator : 'hr'" class="my-1 border-divider" />
      <component
        :is="desktop ? DropdownMenuItem : 'button'"
        v-if="state.sources.length"
        :type="desktop ? undefined : 'button'"
        :disabled="syncing"
        :aria-busy="syncing"
        :class="itemClass"
        @click="sync"
      >
        <RefreshCw :class="['size-4 shrink-0', syncing ? 'motion-safe:animate-spin' : '']" aria-hidden="true" />
        <span class="flex min-w-0 flex-col">
          <span>{{ $t('sync.action') }}</span>
          <span class="text-xs text-subtle-foreground">{{ $t(checked.key, { n: checked.n }) }}</span>
        </span>
      </component>
      <component
        :is="desktop ? DropdownMenuItem : 'button'"
        :type="desktop ? undefined : 'button'"
        :disabled="locked"
        :class="itemClass"
        @click="openDialog('create')"
      >
        <Plus class="size-4 shrink-0" aria-hidden="true" />
        {{ $t('inventory.new') }}
      </component>
      <template v-if="hasCurrent">
        <component
          :is="desktop ? DropdownMenuItem : 'button'"
          :type="desktop ? undefined : 'button'"
          :disabled="locked"
          :class="itemClass"
          @click="openDialog('rename')"
        >
          <Pencil class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ $t('inventory.rename', { name }) }}</span>
        </component>
        <component
          :is="desktop ? DropdownMenuItem : 'button'"
          :type="desktop ? undefined : 'button'"
          :disabled="locked"
          :class="[itemClass, 'text-destructive focus:text-destructive']"
          @click="openDialog('archive')"
        >
          <Archive class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ $t('inventory.archive', { name }) }}</span>
        </component>
      </template>
    </div>
  </DefineContent>

  <DropdownMenu v-if="desktop" v-model:open="menuOpen">
    <DropdownMenuTrigger as-child>
      <ReuseTrigger />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      class="w-72 motion-safe:data-[state=open]:animate-pop-in motion-safe:data-[state=closed]:animate-pop-out"
    >
      <ReuseContent />
    </DropdownMenuContent>
  </DropdownMenu>
  <template v-else>
    <ReuseTrigger @click="menuOpen = true" />
    <AppSheet v-model:open="menuOpen" :title="$t('inventory.switchTitle')">
      <ReuseContent />
    </AppSheet>
  </template>

  <AppSheet
    v-model:open="formOpen"
    :title="$t(dialog === 'rename' ? 'inventory.renameTitle' : 'inventory.new')"
    :locked="formBusy"
    initial-focus="#inventory-name"
  >
    <InventoryForm v-if="dialog === 'create' || dialog === 'rename'" v-model:busy="formBusy" :mode="dialog" @done="dialog = null" />
  </AppSheet>
  <ConfirmSheet
    v-model:open="archiveOpen"
    :title="$t('inventory.archiveTitle')"
    :description="$t('inventory.archiveConfirm', { name })"
    :confirm-label="$t(archiving ? 'status.saving' : 'inventory.archiveAction')"
    :busy="archiving"
    destructive
    @confirm="archive"
  />
</template>

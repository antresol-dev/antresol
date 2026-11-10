<script setup lang="ts">
import { newId } from '@graymatter/core'
import { createReusableTemplate, useMediaQuery } from '@vueuse/core'
import { Archive, Check, ChevronDown, Pencil, Plus } from '@lucide/vue'
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
import type { InventoryEntry } from '~/lib/workspace'

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace
const router = useRouter()

const desktop = useMediaQuery('(min-width: 768px)')
const [DefineContent, ReuseContent] = createReusableTemplate()

const menuOpen = ref(false)
const dialog = ref<'create' | 'rename' | 'archive' | null>(null)
const archiving = ref(false)

const name = computed(() => state.snapshot?.inventory.name ?? '')
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

const isCurrent = (e: InventoryEntry): boolean =>
  e.ref.sourceId === state.current?.sourceId && e.ref.inventoryId === state.current?.inventoryId

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

function choose(entry: InventoryEntry): void {
  menuOpen.value = false
  if (isCurrent(entry)) return
  void router.push('/')
  workspace.selectInventory(entry.ref).catch((e: unknown) => toast.error(t(errorMessageKey(e))))
}

function openDialog(kind: 'create' | 'rename' | 'archive'): void {
  menuOpen.value = false
  dialog.value = kind
}

async function archive(): Promise<void> {
  const current = state.current
  if (!current) return
  archiving.value = true
  try {
    await workspace.apply({ type: 'archive', target: 'inventory', id: current.inventoryId, archiveId: newId() })
    dialog.value = null
    await router.push('/')
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    archiving.value = false
  }
}

const itemClass = 'flex min-h-11 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-50'
</script>

<template>
  <DefineContent>
    <div class="grid gap-1">
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
          <Check v-if="isCurrent(entry)" class="size-4 shrink-0 text-primary" aria-hidden="true" />
        </component>
      </template>
      <component :is="desktop ? DropdownMenuSeparator : 'hr'" class="my-1 border-divider" />
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
          :class="[itemClass, 'text-destructive focus:bg-background focus:text-destructive']"
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
      <button type="button" class="flex min-h-11 min-w-0 items-center gap-1.5 p-0 text-2xl font-bold tracking-[-0.02em]">
        <span class="truncate">{{ name || $t('app.name') }}</span>
        <ChevronDown class="size-[18px] shrink-0 text-subtle-foreground" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-72 bg-surface p-1.5">
      <ReuseContent />
    </DropdownMenuContent>
  </DropdownMenu>
  <template v-else>
    <button
      type="button"
      class="flex min-h-11 min-w-0 items-center gap-1.5 p-0 text-2xl font-bold tracking-[-0.02em]"
      @click="menuOpen = true"
    >
      <span class="truncate">{{ name || $t('app.name') }}</span>
      <ChevronDown class="size-[18px] shrink-0 text-subtle-foreground" aria-hidden="true" />
    </button>
    <AppSheet v-model:open="menuOpen" :title="$t('inventory.switchTitle')">
      <ReuseContent />
    </AppSheet>
  </template>

  <AppSheet v-model:open="formOpen" :title="$t(dialog === 'rename' ? 'inventory.renameTitle' : 'inventory.new')">
    <InventoryForm v-if="dialog === 'create' || dialog === 'rename'" :mode="dialog" @done="dialog = null" />
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

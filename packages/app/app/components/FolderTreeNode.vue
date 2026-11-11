<script setup lang="ts">
import { Archive, Boxes, ChevronRight, Folder, FolderInput, FolderPlus, Pencil, Plus } from '@lucide/vue'
import { treeAriaCurrent } from '~/lib/shell'
import { rowClickAction, type TreeRow } from '~/lib/tree-state'
import { piecesLabel } from '~/lib/views'
import type RowMenu from './RowMenu.vue'

const props = defineProps<{
  row: TreeRow
  variant: 'panel' | 'drawer'
  /** The inventory root: Boxes icon, links to `/`, never has a chevron or row actions. */
  root?: boolean
  /** How many folders are above this row. Past MAX_INDENT levels the indent and the guide line stop growing. */
  level?: number
}>()
const MAX_INDENT = 6
const emit = defineEmits<{ toggle: [id: string] }>()

const { t } = useI18n()
const { state } = useWorkspace()
const { open } = useFolderDialog()
const route = useRoute()

// 'page' on the folder's own screen; on an item card its folder is current but not the page.
const ariaCurrent = computed(() =>
  treeAriaCurrent(props.root ? 'root' : props.row.id, props.row.current, typeof route.name === 'string' ? route.name : null, route.params),
)

// The second click on the folder whose screen is open opens or closes it; the first one only goes there.
function click(e: MouseEvent): void {
  if (props.root || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  if (rowClickAction(ariaCurrent.value === 'page') !== 'toggle') return
  e.preventDefault()
  if (props.row.hasChildren) emit('toggle', props.row.id)
}

const indents = computed(() => (props.level ?? 0) < MAX_INDENT)
const panel = computed(() => props.variant === 'panel')
const to = computed(() => (props.root ? '/' : `/folder/${props.row.id}`))
// Drawer rows are touch targets: 44 px tall with a 44 px chevron; the guide line runs under the parent's chevron.
const chevronSize = computed(() => (panel.value ? 'size-[18px]' : 'size-11'))
const actionSize = computed(() => (panel.value ? 'size-[22px] rounded-md' : 'size-8 rounded-lg'))

const locked = computed(() => !!state.readOnly || state.saving)
const actions = computed(() => [
  { key: 'create', label: t('folderMenu.new'), icon: FolderPlus, disabled: locked.value },
  { key: 'rename', label: t('folderMenu.rename'), icon: Pencil, disabled: locked.value },
  { key: 'move', label: t('folderMenu.move'), icon: FolderInput, disabled: locked.value },
  { key: 'archive', label: t('folderMenu.archive'), icon: Archive, destructive: true, disabled: locked.value },
])

function select(key: string): void {
  const folderId = props.row.id
  if (key === 'create') open({ kind: 'create', parentId: folderId })
  else if (key === 'rename' || key === 'move' || key === 'archive') open({ kind: key, folderId })
}

// A long press on a folder row (in the drawer, or the panel on a touch screen) opens the row menu as a sheet.
const menu = useTemplateRef<InstanceType<typeof RowMenu>>('rowMenu')
const press = useLongPress(() => menu.value?.openSheet())
// Object syntax on a component: `clickCapture` becomes onClickCapture, a capture-phase click listener on the <a>.
const pressHandlers = computed(() =>
  props.root
    ? {}
    : {
        pointerdown: press.onPointerdown,
        pointermove: press.onPointermove,
        pointerup: press.onPointerup,
        pointercancel: press.onPointercancel,
        contextmenu: press.onContextmenu,
        clickCapture: press.onClickCapture,
      },
)
</script>

<template>
  <li class="flex flex-col gap-0.5">
    <!-- `group`: the row reveals its "+" and "⋯" (.row-action) on hover and focus. The count keeps its colour. -->
    <div
      :class="[
        'group relative flex items-center gap-1.5 rounded-icon pr-2 text-sm font-semibold transition-colors duration-150',
        panel ? 'h-8 pl-1' : 'min-h-11',
        row.current ? 'bg-accent-soft text-accent-soft-foreground' : 'text-icon hover:bg-hover hover:text-foreground',
      ]"
    >
      <button
        v-if="row.hasChildren"
        type="button"
        :class="[
          chevronSize,
          'relative z-10 grid shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-chip hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        ]"
        :aria-expanded="row.open"
        :aria-label="$t(row.open ? 'tree.collapse' : 'tree.expand', { name: row.name })"
        @click="emit('toggle', row.id)"
      >
        <ChevronRight
          :class="['size-3.5 motion-safe:transition-transform motion-safe:duration-150', row.open ? 'rotate-90' : '']"
          aria-hidden="true"
        />
      </button>
      <span v-else :class="[chevronSize, 'shrink-0']" aria-hidden="true" />
      <!-- The link stretches over the whole row (after:inset-0); the chevron and the actions sit above it. -->
      <NuxtLink
        :to="to"
        :aria-current="ariaCurrent"
        :class="[
          'flex min-w-0 flex-1 items-center gap-1.5 self-stretch outline-none after:absolute after:inset-0 after:rounded-icon focus-visible:after:ring-2 focus-visible:after:ring-ring',
          root ? '' : 'select-none [-webkit-touch-callout:none]',
        ]"
        v-on="pressHandlers"
        @click="click"
      >
        <Boxes v-if="root" class="size-4 shrink-0" aria-hidden="true" />
        <Folder v-else :class="['size-4 shrink-0', row.current ? '' : 'text-primary']" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
      </NuxtLink>
      <template v-if="!root">
        <span class="row-action relative z-10 -mr-1 flex shrink-0 items-center gap-px">
          <button
            type="button"
            :class="[
              actionSize,
              'grid place-items-center text-icon outline-none transition-colors duration-150 hover:bg-chip hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
            ]"
            :aria-label="$t('folderMenu.newIn', { name: row.name })"
            :disabled="locked"
            @click="open({ kind: 'create', parentId: row.id })"
          >
            <Plus class="size-3.5" aria-hidden="true" />
          </button>
          <RowMenu ref="rowMenu" :class="actionSize" :label="row.name" :actions="actions" @select="select" />
        </span>
      </template>
      <span
        v-if="row.pieces !== null"
        :class="['shrink-0 text-xs font-bold tabular-nums', row.current ? 'text-accent-soft-foreground' : 'text-subtle-foreground']"
      >
        {{ piecesLabel(row.pieces) }}
      </span>
    </div>
    <ul
      v-if="row.open"
      :class="[
        'flex flex-col gap-0.5',
        indents ? ['border-l border-tree-line pl-1', panel ? 'ml-3' : 'ml-[21px]'] : '',
      ]"
    >
      <FolderTreeNode
        v-for="child in row.children"
        :key="child.id"
        :row="child"
        :variant="variant"
        :level="(level ?? 0) + 1"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
</template>

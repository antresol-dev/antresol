<script setup lang="ts">
import type { Id } from '@antresol/core'
import { Archive, FolderInput, Pencil } from '@lucide/vue'
import type { ComponentPublicInstance } from 'vue'
import type { ItemRow } from '~/lib/views'
import type RowMenu from './RowMenu.vue'

const props = defineProps<{ items: ItemRow[] }>()
const { t } = useI18n()
const { state } = useWorkspace()
const { open } = useItemDialog()

const locked = computed(() => !!state.readOnly || state.saving)
const actions = computed(() => [
  { key: 'edit', label: t('itemMenu.edit'), icon: Pencil, disabled: locked.value },
  { key: 'move', label: t('itemMenu.move'), icon: FolderInput, disabled: locked.value },
  { key: 'archive', label: t('itemMenu.archive'), icon: Archive, destructive: true, disabled: locked.value },
])

function select(itemId: Id, key: string): void {
  if (key === 'edit' || key === 'move' || key === 'archive') open({ kind: key, itemId })
}

// One finger presses one row at a time: a single long-press tracker for the list, aimed at the row it went down on.
const menus = new Map<Id, InstanceType<typeof RowMenu>>()
function setMenu(id: Id, el: Element | ComponentPublicInstance | null): void {
  if (el) menus.set(id, el as InstanceType<typeof RowMenu>)
  else menus.delete(id)
}
let pressed: Id | null = null
const press = useLongPress(() => {
  if (pressed !== null) menus.get(pressed)?.openSheet()
})
function pointerdown(id: Id, e: PointerEvent): void {
  pressed = id
  press.onPointerdown(e)
}

// The line under the name: the buckets of an item with variants ("1 kΩ 3 · 10 kΩ 100 · 100 kΩ — · +2"), else its description.
const rows = computed(() =>
  props.items.map((item) => ({
    ...item,
    sub: item.buckets.length > 0 ? null : item.description,
    // Many pieces carry a bare prefix that sticks to the number ("1.5k"); a unit symbol stands apart ("3 m").
    unitGap: !/^[kM]$/.test(item.unit),
  })),
)
</script>

<template>
  <section class="grid min-w-0 grid-cols-1 gap-2">
    <h2 class="section-label px-3 text-xs">{{ $t('folder.items', { count: items.length }) }}</h2>
    <!-- A flat list on the page: rows divided by lines, a row tile tinted under the pointer. -->
    <ul class="surface-list">
      <li
        v-for="item in rows"
        :key="item.id"
        class="group relative flex items-center rounded-row transition-colors duration-(--dur-fast) hover:bg-hover not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-15 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <NuxtLink
          :to="`/item/${item.id}`"
          class="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-row px-3 select-none [-webkit-touch-callout:none]"
          @pointerdown="pointerdown(item.id, $event)"
          @pointermove="press.onPointermove"
          @pointerup="press.onPointerup"
          @pointercancel="press.onPointercancel"
          @contextmenu="press.onContextmenu"
          @click.capture="press.onClickCapture"
        >
          <ItemThumb :id="item.id" :folder-name="item.folderName" :icon="item.icon" :folder-icon="item.folderIcon" :cover="item.cover" :color="item.color" class="size-9 rounded-thumb text-sm" />
          <span class="flex min-w-0 grow flex-col gap-0.5">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="min-w-[min(7.5rem,100%)] truncate text-base font-semibold" :class="item.outOfStock && 'text-dimmed-foreground'">{{ item.name }}</span>
              <span
                v-for="(value, i) in item.pinned"
                :key="i"
                class="max-w-32 min-w-0 shrink truncate rounded-chip bg-chip px-1.5 py-px text-xs font-semibold text-subtle-foreground"
              >{{ value }}</span>
            </span>
            <span v-if="item.buckets.length > 0" class="truncate text-sm text-muted-foreground">
              <template v-for="(b, i) in item.buckets" :key="i"><template v-if="i > 0"> · </template>{{ b.label ?? $t('item.noVariant') }}
                <span class="font-semibold tabular-nums" :class="b.empty ? '' : 'text-foreground'">{{ b.empty ? '—' : b.number }}</span></template>
              <template v-if="item.moreBuckets > 0"> · {{ $t('list.more', { count: item.moreBuckets }) }}</template>
            </span>
            <span v-else-if="item.sub" class="truncate text-sm text-muted-foreground">{{ item.sub }}</span>
          </span>
          <span class="min-w-18 shrink-0 text-right">
            <StockStatus v-if="item.outOfStock" />
            <span v-else class="amount text-base tabular-nums">
              {{ item.number }}<span v-if="item.unit" class="text-xs font-semibold text-muted-foreground" :class="item.unitGap && 'ml-0.5'">{{ item.unit }}</span>
            </span>
          </span>
        </NuxtLink>
        <!-- Always in the layout where it can show (hidden only on touch below 1024 px), so the number never moves. -->
        <RowMenu
          :ref="(el) => setMenu(item.id, el)"
          class="row-action -ml-1 mr-3 size-8"
          :label="item.name"
          :actions="actions"
          @select="select(item.id, $event)"
        />
      </li>
    </ul>
  </section>
</template>

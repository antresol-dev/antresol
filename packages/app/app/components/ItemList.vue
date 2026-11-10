<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { Archive, Cpu, FolderInput, Pencil } from '@lucide/vue'
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

const rows = computed(() =>
  props.items.map((item) => ({
    ...item,
    sub: [
      item.outOfStock ? t('item.outOfStock') : null,
      item.description,
      item.variantCount > 0 ? t('item.variants', item.variantCount) : null,
    ]
      .filter((x): x is string => !!x)
      .join(' · '),
  })),
)
</script>

<template>
  <section class="grid gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-subtle-foreground">{{ $t('folder.items', { count: items.length }) }}</h2>
    <ul class="overflow-hidden rounded-card border border-border bg-surface py-1">
      <li
        v-for="item in rows"
        :key="item.id"
        class="group relative flex items-center transition-colors duration-150 hover:bg-hover not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-[68px] not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <NuxtLink
          :to="`/item/${item.id}`"
          class="flex h-[62px] min-w-0 flex-1 items-center gap-3 px-3.5 outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          @pointerdown="pointerdown(item.id, $event)"
          @pointermove="press.onPointermove"
          @pointerup="press.onPointerup"
          @pointercancel="press.onPointercancel"
          @contextmenu="press.onContextmenu"
          @click.capture="press.onClickCapture"
        >
          <span class="flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-thumb bg-thumb text-thumb-foreground">
            <img v-if="item.coverUrl" :src="item.coverUrl" alt="" loading="lazy" class="size-full object-cover" >
            <Cpu v-else class="size-5" stroke-width="1.75" aria-hidden="true" />
          </span>
          <span class="flex min-w-0 grow flex-col gap-0.5">
            <span class="truncate text-[15px] font-bold" :class="item.outOfStock && 'text-dimmed-foreground'">{{ item.name }}</span>
            <span v-if="item.sub" class="truncate text-[13px] text-muted-foreground">{{ item.sub }}</span>
          </span>
          <span
            class="shrink-0 text-base font-bold tabular-nums"
            :class="item.outOfStock && 'text-muted-foreground'"
          >
            {{ item.number }}
            <span class="text-xs font-semibold text-muted-foreground">{{ item.unit }}</span>
          </span>
        </NuxtLink>
        <!-- Always in the layout where it can show (hidden only on touch below 1024 px), so the number never moves. -->
        <RowMenu
          :ref="(el) => setMenu(item.id, el)"
          class="row-action -ml-1 mr-2.5 size-[30px]"
          :label="item.name"
          :actions="actions"
          @select="select(item.id, $event)"
        />
      </li>
    </ul>
  </section>
</template>

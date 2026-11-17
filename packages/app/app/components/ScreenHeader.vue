<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { ChevronLeft, ChevronRight, Loader2, Menu } from '@lucide/vue'
import { MENU_BUTTON_ID } from '~/composables/useShell'
import { collapseCrumbs } from '~/lib/views'

const props = defineProps<{
  title: string
  subtitle?: string | null
  /** Links above the title, root first; the screen itself goes in `current`. */
  crumbs?: { name: string; to: string }[]
  /** The screen's own place at the end of the path; shown from 1024 px only. */
  current?: string | null
  /** A long title wraps (item names) instead of ending in an ellipsis (folder names). */
  wrapTitle?: boolean
}>()
defineSlots<{
  /** compact = below 1024 px: icon-only buttons in the top bar. */
  actions?: (props: { compact: boolean }) => unknown
  /** Inline before the title's text (an item's coloured icon), wrapping with it. */
  'before-title'?: () => unknown
  /** One line of chips right under the title (an item's list values); the caller keeps it to one clipped row. */
  'below-title'?: () => unknown
}>()

const { state } = useWorkspace()
const { drawerOpen } = useShell()
const desktop = useMediaQuery('(min-width: 1024px)')

const crumbs = computed(() => props.crumbs ?? [])
// On the phone the parent is the "‹ Parent" button, so the path under it stops at the grandparent.
const shortCrumbs = computed(() => collapseCrumbs(crumbs.value.slice(0, -1)))
// The phone's way back (design system F9): up the hierarchy to the parent, not back in history; the system back gesture
// covers history. None on the inventory root.
const parent = computed(() => crumbs.value.at(-1) ?? null)

// ☰ is a flat icon button like the screen's actions in the phone's top bar: raised ones sit too close to the screen's
// top edge (the owner, 2026-11-12), and a margin would take room the screen needs.
const iconButton = 'pressable grid size-11 shrink-0 place-items-center'
// tabindex -1: where focus lands when a sheet closes and the control that opened it is gone (AppSheet).
const heading = 'screen-title rounded-chip text-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring'
// Path links are flat: the accent tint and ink under the pointer.
const crumbLink = 'pressable min-w-0 truncate rounded-chip'
</script>

<template>
  <header class="surface-header sticky top-0 z-20 border-b">
    <div
      :class="[
        'mx-auto grid w-full max-w-[720px] min-w-0 grid-cols-1 px-4 lg:max-w-[760px] lg:px-8',
        desktop ? 'gap-3 pt-4 pb-2' : 'gap-0.5 pt-1 pb-2',
      ]"
    >
      <template v-if="desktop">
        <div class="-ml-3 flex min-w-0 items-center">
          <NavArrows />
          <nav
            v-if="crumbs.length > 0 || current"
            :aria-label="$t('folder.path')"
            class="ml-2 flex min-w-0 items-center gap-1 text-sm font-semibold text-muted-foreground"
          >
            <template v-for="(c, i) in crumbs" :key="c.to">
              <ChevronRight v-if="i > 0" class="size-4 shrink-0" aria-hidden="true" />
              <NuxtLink :to="c.to" :class="[crumbLink, 'px-1.5 py-0.5']">{{ c.name }}</NuxtLink>
            </template>
            <template v-if="current">
              <ChevronRight v-if="crumbs.length > 0" class="size-4 shrink-0" aria-hidden="true" />
              <span aria-current="page" class="min-w-0 truncate px-1.5 text-foreground">{{ current }}</span>
            </template>
          </nav>
          <span v-if="state.saving" role="status" class="ml-auto flex size-11 shrink-0 items-center justify-center text-subtle-foreground">
            <Loader2 class="size-4 animate-spin" aria-hidden="true" />
            <span class="sr-only">{{ $t('status.saving') }}</span>
          </span>
        </div>
        <div class="flex min-w-0 items-end justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h1 tabindex="-1" :class="[heading, wrapTitle ? 'wrap-anywhere' : 'truncate']"><slot name="before-title" />{{ title }}</h1>
            <slot name="below-title" />
            <p v-if="subtitle" class="mt-0.5 truncate text-sm font-semibold text-muted-foreground">{{ subtitle }}</p>
          </div>
          <div v-if="$slots.actions" class="flex shrink-0 items-center gap-3">
            <slot name="actions" :compact="false" />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="-mx-2 flex min-w-0 items-center gap-1">
          <button
            :id="MENU_BUTTON_ID"
            type="button"
            :class="iconButton"
            :aria-label="$t('nav.menu')"
            aria-haspopup="dialog"
            :aria-expanded="drawerOpen"
            @click="drawerOpen = true"
          >
            <Menu class="size-5" aria-hidden="true" />
          </button>
          <!-- "‹ Parent" takes the free space and truncates; the saving indicator sits at its end. -->
          <span class="flex min-w-0 flex-1 items-center">
            <NuxtLink
              v-if="parent"
              :to="parent.to"
              class="pressable flex h-11 min-w-0 items-center gap-1 rounded-chip pr-2 text-sm font-semibold text-muted-foreground hover:text-accent-ink"
              :aria-label="$t('nav.up', { name: parent.name })"
            >
              <ChevronLeft class="size-5 shrink-0" aria-hidden="true" />
              <span class="truncate">{{ parent.name }}</span>
            </NuxtLink>
            <span v-if="state.saving" role="status" class="ml-auto flex h-11 shrink-0 items-center pl-2 text-subtle-foreground">
              <Loader2 class="size-4 animate-spin" aria-hidden="true" />
              <span class="sr-only">{{ $t('status.saving') }}</span>
            </span>
          </span>
          <!-- Right: one frequent action and "⋯" (ItemActions, FolderActions). -->
          <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
            <slot name="actions" :compact="true" />
          </div>
        </div>
        <nav
          v-if="crumbs.length > 1"
          :aria-label="$t('folder.path')"
          class="-ml-1 flex min-w-0 items-center gap-0.5 text-xs font-semibold text-muted-foreground"
        >
          <template v-for="(c, i) in shortCrumbs" :key="c === 'ellipsis' ? 'ellipsis' : c.to">
            <ChevronRight v-if="i > 0" class="size-4 shrink-0" aria-hidden="true" />
            <span v-if="c === 'ellipsis'" aria-hidden="true" class="shrink-0 px-0.5">{{ $t('folder.ellipsis') }}</span>
            <NuxtLink v-else :to="c.to" :class="[crumbLink, 'flex min-h-11 items-center px-1']">
              <span class="truncate">{{ c.name }}</span>
            </NuxtLink>
          </template>
        </nav>
        <h1 tabindex="-1" :class="[heading, wrapTitle ? 'wrap-anywhere' : 'truncate']"><slot name="before-title" />{{ title }}</h1>
        <slot name="below-title" />
      </template>

      <AppStatus />
    </div>
  </header>
</template>

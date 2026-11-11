<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { ChevronRight, Loader2, Menu } from '@lucide/vue'
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
}>()

const { state } = useWorkspace()
const { drawerOpen } = useShell()
const desktop = useMediaQuery('(min-width: 1024px)')

const crumbs = computed(() => props.crumbs ?? [])
const shortCrumbs = computed(() => collapseCrumbs(crumbs.value))

// ☰ is a raised icon button like the screen's actions (R(3,7), radius 14).
const iconButton = 'raised-sm pressable grid size-11 shrink-0 place-items-center'
// tabindex -1: where focus lands when a sheet closes and the control that opened it is gone (AppSheet).
const heading = 'rounded-chip text-2xl font-bold tracking-[-0.02em] outline-none focus-visible:ring-2 focus-visible:ring-ring'
// Path links are flat: the accent tint and ink under the pointer.
const crumbLink = 'pressable min-w-0 truncate rounded-chip'
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-border bg-background">
    <div
      :class="[
        'mx-auto grid w-full max-w-[720px] min-w-0 grid-cols-1 px-4 lg:max-w-[760px] lg:px-7',
        desktop ? 'gap-3 py-3.5' : 'gap-0.5 pt-1 pb-2.5',
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
              <ChevronRight v-if="i > 0" class="size-3.5 shrink-0" aria-hidden="true" />
              <NuxtLink :to="c.to" :class="[crumbLink, 'px-1.5 py-0.5']">{{ c.name }}</NuxtLink>
            </template>
            <template v-if="current">
              <ChevronRight v-if="crumbs.length > 0" class="size-3.5 shrink-0" aria-hidden="true" />
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
            <h1 tabindex="-1" :class="[heading, wrapTitle ? 'wrap-anywhere' : 'truncate']">{{ title }}</h1>
            <p v-if="subtitle" class="mt-0.5 truncate text-[13px] font-semibold text-muted-foreground">{{ subtitle }}</p>
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
          <NavArrows />
          <!-- The free space; the saving indicator sits in it instead of taking a slot of its own. -->
          <span class="flex min-w-0 flex-1 items-center justify-end">
            <span v-if="state.saving" role="status" class="flex h-11 shrink-0 items-center text-subtle-foreground">
              <Loader2 class="size-4 animate-spin" aria-hidden="true" />
              <span class="sr-only">{{ $t('status.saving') }}</span>
            </span>
          </span>
          <!-- At 360 px the row is 344 px, 8 px from the screen's edges so the shadows have room: ☰ 44, the two 32 px
               arrows, four raised 44 px actions 10 px apart (wider than their shadows reach, 7.7 px) and 4 px gaps take
               326 px; the saving indicator takes 16 of the 18 left. -->
          <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2.5">
            <slot name="actions" :compact="true" />
          </div>
        </div>
        <nav
          v-if="crumbs.length > 0"
          :aria-label="$t('folder.path')"
          class="-ml-1 flex min-w-0 items-center gap-0.5 text-[13px] font-semibold text-muted-foreground"
        >
          <template v-for="(c, i) in shortCrumbs" :key="c === 'ellipsis' ? 'ellipsis' : c.to">
            <ChevronRight v-if="i > 0" class="size-3 shrink-0" aria-hidden="true" />
            <span v-if="c === 'ellipsis'" aria-hidden="true" class="shrink-0 px-0.5">{{ $t('folder.ellipsis') }}</span>
            <NuxtLink v-else :to="c.to" :class="[crumbLink, 'flex min-h-11 items-center px-1']">
              <span class="truncate">{{ c.name }}</span>
            </NuxtLink>
          </template>
        </nav>
        <h1 tabindex="-1" :class="[heading, wrapTitle ? 'wrap-anywhere' : 'truncate']">{{ title }}</h1>
      </template>

      <AppStatus />
    </div>
  </header>
</template>

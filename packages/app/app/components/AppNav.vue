<script setup lang="ts">
import { Archive, Boxes, SlidersHorizontal } from '@lucide/vue'
import type { Component } from 'vue'
import { NAV_SECTIONS, sectionOf, type Section } from '~/lib/shell'

const props = defineProps<{ variant: 'rail' | 'drawer' }>()

const route = useRoute()
const { state } = useWorkspace()

const section = computed(() => sectionOf(typeof route.name === 'string' ? route.name : null))
// "page" only on the section's own page; on a page inside it (a folder, a source) the highlight is "true".
const current = (key: Section, to: string): 'page' | 'true' | undefined =>
  section.value !== key ? undefined : route.path === to ? 'page' : 'true'
const icons: Partial<Record<Exclude<Section, 'settings'>, Component>> = { items: Boxes, archive: Archive }

// The rail grows and its column scrolls; in the drawer the tree card takes the free height and scrolls itself.
// Rows hover with a foreground tint: bg-hover is almost the rail's own colour.
const link =
  'flex min-h-11 items-center gap-2.5 rounded-icon px-2.5 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring'
const linkState = (key: Section): string =>
  section.value === key ? 'bg-surface text-primary' : 'text-icon hover:bg-foreground/5 hover:text-foreground'
</script>

<template>
  <div :class="['flex flex-col gap-3.5 px-2.5 py-3.5', props.variant === 'drawer' ? 'h-full min-h-0' : 'min-h-full']">
    <NuxtLink
      to="/"
      class="flex min-h-11 shrink-0 items-center gap-2 self-start rounded-icon px-1.5 text-base font-bold tracking-[-0.02em] outline-none transition-colors duration-150 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img src="/favicon.svg" alt="" class="size-6.5 rounded-icon" >
      {{ $t('app.name') }}
    </NuxtLink>

    <div class="shrink-0">
      <InventorySwitcher />
    </div>

    <nav :aria-label="$t('nav.sections')" class="shrink-0">
      <ul class="grid gap-0.5">
        <li v-for="s in NAV_SECTIONS" :key="s.key">
          <NuxtLink :to="s.to" :class="[link, linkState(s.key)]" :aria-current="current(s.key, s.to)">
            <component :is="icons[s.key] ?? Boxes" class="size-[18px] shrink-0" aria-hidden="true" />
            {{ $t(`nav.${s.key}`) }}
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <div v-if="props.variant === 'drawer' && state.snapshot" class="min-h-0 flex-1 overflow-y-auto rounded-field bg-surface p-1.5">
      <FolderTree variant="drawer" />
    </div>

    <div class="mt-auto shrink-0">
      <NuxtLink to="/settings" :class="[link, linkState('settings')]" :aria-current="current('settings', '/settings')">
        <SlidersHorizontal class="size-[18px] shrink-0" aria-hidden="true" />
        {{ $t('nav.settings') }}
      </NuxtLink>
    </div>
  </div>
</template>

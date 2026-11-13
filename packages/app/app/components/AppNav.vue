<script setup lang="ts">
import { Archive, Boxes, PackageOpen, SlidersHorizontal, Tags } from '@lucide/vue'
import type { Component } from 'vue'
import { NAV_SECTIONS, sectionOf, type Section } from '~/lib/shell'

const props = defineProps<{ variant: 'rail' | 'drawer' }>()

const route = useRoute()
const { state } = useWorkspace()

const section = computed(() => sectionOf(typeof route.name === 'string' ? route.name : null))
// "page" only on the section's own page; on a page inside it (a folder, a source) the highlight is "true".
const current = (key: Section, to: string): 'page' | 'true' | undefined =>
  section.value !== key ? undefined : route.path === to ? 'page' : 'true'
const icons: Record<Exclude<Section, 'settings'>, Component> = { items: Boxes, intakes: PackageOpen, dictionaries: Tags, archive: Archive }

// The rail grows and its column scrolls; in the drawer the tree takes the free height and scrolls itself.
// Rows are flat (pressable: the accent tint under the pointer); the current section is a selected row.
const link = 'pressable flex min-h-11 items-center gap-2.5 px-3 text-sm font-semibold'
const linkState = (key: Section): string => (section.value === key ? 'row-selected' : '')
</script>

<template>
  <div :class="['flex flex-col gap-3.5 px-2.5 py-3.5', props.variant === 'drawer' ? 'h-full min-h-0' : 'min-h-full']">
    <!-- A row like the nav rows below (width, height, radius, states): the whole row is the link home. -->
    <NuxtLink to="/" class="pressable flex min-h-11 shrink-0 items-center gap-2 px-3">
      <AppLogo class="size-[26px] shrink-0" />
      <span class="antresol-wordmark text-[17px]">{{ $t('app.name') }}</span>
    </NuxtLink>

    <div class="shrink-0">
      <InventorySwitcher />
    </div>

    <nav :aria-label="$t('nav.sections')" class="shrink-0">
      <ul class="grid gap-0.5">
        <li v-for="s in NAV_SECTIONS" :key="s.key">
          <NuxtLink :to="s.to" :class="[link, linkState(s.key)]" :aria-current="current(s.key, s.to)">
            <component :is="icons[s.key]" class="size-[18px] shrink-0" aria-hidden="true" />
            {{ $t(`nav.${s.key}`) }}
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <div v-if="props.variant === 'drawer' && state.snapshot" class="min-h-0 flex-1 overflow-y-auto p-1.5">
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

<script setup lang="ts">
import { ChevronDown, Loader2, SlidersHorizontal } from '@lucide/vue'

const { state } = useWorkspace()
</script>

<template>
  <header class="flex items-center justify-between gap-2">
    <button
      type="button"
      class="flex min-h-11 min-w-0 items-center gap-1.5 p-0 text-2xl font-bold tracking-[-0.02em]"
    >
      <span class="truncate">{{ state.snapshot?.inventory.name ?? $t('app.name') }}</span>
      <ChevronDown class="size-[18px] shrink-0 text-subtle-foreground" aria-hidden="true" />
    </button>
    <div class="flex shrink-0 items-center gap-1">
      <span v-if="state.saving" role="status" class="flex size-11 items-center justify-center text-subtle-foreground">
        <Loader2 class="size-4 animate-spin" aria-hidden="true" />
        <span class="sr-only">{{ $t('status.saving') }}</span>
      </span>
      <NuxtLink
        to="/settings"
        class="flex size-11 items-center justify-center rounded-full border border-border bg-surface text-icon"
        :aria-label="$t('nav.settings')"
      >
        <SlidersHorizontal class="size-5" stroke-width="1.75" aria-hidden="true" />
      </NuxtLink>
    </div>
  </header>
</template>

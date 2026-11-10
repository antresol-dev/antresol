<script setup lang="ts">
import { Loader2, SlidersHorizontal } from '@lucide/vue'

const { state } = useWorkspace()
</script>

<template>
  <header class="flex items-center justify-between gap-2">
    <InventorySwitcher />
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

<script setup lang="ts">
import { Loader2, Settings } from '@lucide/vue'

const route = useRoute()
const { state } = useWorkspace()
</script>

<template>
  <div class="min-h-dvh bg-background text-foreground">
    <header v-if="route.path !== '/welcome'" class="flex items-center justify-between gap-2 px-4 pt-2.5">
      <NuxtLink to="/" class="flex min-h-11 items-center gap-2 text-base font-bold tracking-[-0.02em]">
        <img src="/favicon.svg" alt="" class="size-6 rounded-icon" >
        {{ $t('app.name') }}
      </NuxtLink>
      <div class="flex items-center gap-1">
        <span v-if="state.saving" role="status" class="flex size-11 items-center justify-center text-subtle-foreground">
          <Loader2 class="size-4 animate-spin" aria-hidden="true" />
          <span class="sr-only">{{ $t('status.saving') }}</span>
        </span>
        <NuxtLink
          to="/settings"
          class="flex size-11 items-center justify-center rounded-field text-icon hover:bg-chip"
          :aria-label="$t('nav.settings')"
        >
          <Settings class="size-5" aria-hidden="true" />
        </NuxtLink>
      </div>
    </header>
    <slot />
  </div>
</template>

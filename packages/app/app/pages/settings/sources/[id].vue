<script setup lang="ts">
import { ChevronLeft } from '@lucide/vue'

const route = useRoute()
const { state } = useWorkspace()
const source = computed(() => state.sources.find((s) => s.config.id === route.params.id)?.config)

if (!source.value) await navigateTo('/settings', { replace: true })
</script>

<template>
  <main v-if="source" class="mx-auto grid max-w-xl gap-3.5 px-4 py-2.5">
    <NuxtLink to="/settings" class="flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">
      <ChevronLeft class="size-4" aria-hidden="true" />
      {{ $t('settings.title') }}
    </NuxtLink>
    <h1 class="text-2xl font-bold tracking-[-0.02em]">{{ $t('sourceForm.editTitle') }}</h1>
    <SourceForm :key="source.id" :source="source" />
  </main>
</template>

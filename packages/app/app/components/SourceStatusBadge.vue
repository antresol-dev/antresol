<script setup lang="ts">
import type { SourceStatus } from '~/lib/workspace'

const props = defineProps<{ status: SourceStatus }>()

const tone = computed(() =>
  props.status === 'ready'
    ? 'bg-accent-soft text-accent-soft-foreground'
    : props.status === 'error'
      ? 'bg-chip text-destructive'
      : props.status === 'connecting'
        ? 'bg-chip text-subtle-foreground'
        : 'bg-chip text-warning',
)
</script>

<template>
  <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" :class="tone">
    {{ $t(`settings.sources.status.${status}`) }}
  </span>
</template>

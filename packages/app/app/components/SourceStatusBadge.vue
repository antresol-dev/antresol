<script setup lang="ts">
import type { SourceStatus } from '~/lib/workspace'

const props = defineProps<{ status: SourceStatus }>()

const tone = computed(() =>
  props.status === 'ready'
    ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
    : props.status === 'error'
      ? 'bg-surface text-destructive'
      : 'bg-surface text-subtle-foreground',
)
</script>

<template>
  <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold" :class="tone">
    {{ $t(`settings.sources.status.${status}`) }}
  </span>
</template>

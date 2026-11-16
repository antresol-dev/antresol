<script setup lang="ts">
// The out-of-stock mark of a list row: a dot and the word. In stock is the number itself; the app has no "low" threshold.
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
    <span class="size-2 shrink-0 rounded-full bg-status-out" aria-hidden="true" />{{ $t('list.out') }}
  </span>
</template>

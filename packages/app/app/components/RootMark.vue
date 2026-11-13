<script setup lang="ts">
import { House } from '@lucide/vue'

// Marks the inventory root among folders (folder pickers, the path in a folder field): a small grey house, read as
// "Root folder" by screen readers and shown as a tooltip under the pointer.
</script>

<template>
  <span class="inline-flex shrink-0 items-center text-subtle-foreground" :title="$t('folder.root')">
    <House class="size-3.5" aria-hidden="true" />
    <span class="sr-only">{{ $t('folder.root') }}</span>
  </span>
</template>

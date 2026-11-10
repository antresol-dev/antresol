<script setup lang="ts">
definePageMeta({ layout: 'inventory' })
</script>

<template>
  <main class="grid min-w-0 grid-cols-1 gap-3.5">
    <FolderScreen :folder-id="null" />
  </main>
</template>

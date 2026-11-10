<script setup lang="ts">
definePageMeta({ layout: 'inventory' })

const route = useRoute('folder-id')
const folderId = computed(() => String(route.params.id))
</script>

<template>
  <main class="grid min-w-0 grid-cols-1 gap-3.5">
    <FolderScreen :folder-id="folderId" />
  </main>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' })

const route = useRoute('folder-id')
const folderId = computed(() => String(route.params.id))
</script>

<template>
  <main class="min-w-0">
    <FolderScreen :folder-id="folderId" />
  </main>
</template>

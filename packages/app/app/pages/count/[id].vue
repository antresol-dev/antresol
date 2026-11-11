<script setup lang="ts">
definePageMeta({ layout: 'default' })

const route = useRoute('count-id')
const folderId = computed(() => String(route.params.id))
</script>

<template>
  <main class="min-w-0">
    <CountFolderScreen :folder-id="folderId" />
  </main>
</template>

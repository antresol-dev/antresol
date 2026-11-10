<script setup lang="ts">
const route = useRoute()
const { state } = useWorkspace()
const source = computed(() => state.sources.find((s) => s.config.id === route.params.id)?.config)

if (!source.value) await navigateTo('/settings', { replace: true })
</script>

<template>
  <main v-if="source" class="min-w-0">
    <ScreenHeader :title="source.name" :subtitle="$t('sourceForm.editTitle')" />
    <ScreenBody>
      <SourceForm :key="source.id" :source="source" />
    </ScreenBody>
  </main>
</template>

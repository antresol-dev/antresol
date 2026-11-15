<script setup lang="ts">
// The source's schema needs a newer app to write (min_app_schema above this app's). The workspace has already asked the
// service worker for a new version; when one is found, UpdatePrompt offers the reload.
const { state } = useWorkspace()
</script>

<template>
  <div v-if="state.readOnly === 'schema_newer'" role="status" class="mt-1 rounded-field bg-chip px-3 py-2">
    <p class="text-sm font-semibold text-foreground">{{ $t('updateBanner.title') }}</p>
    <p class="text-sm text-muted-foreground">{{ $t('updateBanner.text') }}</p>
  </div>
</template>

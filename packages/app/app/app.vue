<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'

// A manual theme choice overrides the system one for the browser chrome: a meta without `media`, listed first, wins.
// On "system" it is absent and the two media metas from nuxt.config apply.
const colorMode = useColorMode()
useHead({
  meta: computed(() =>
    colorMode.preference === 'system'
      ? []
      : [{ name: 'theme-color', content: colorMode.value === 'dark' ? '#0E0E10' : '#F7F7F8', tagPriority: 'critical' as const }],
  ),
})
</script>

<template>
  <NuxtPwaAssets />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <UpdatePrompt />
  <!-- Bottom centre of the viewport; assets/css/main.css lifts it above the phone dock. -->
  <Toaster position="bottom-center" />
</template>

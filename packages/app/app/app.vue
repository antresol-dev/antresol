<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'
import { themeColorMeta } from '~/lib/shell'

// Browser chrome colour: both media-scoped tags on "system", a single plain tag once a theme is picked.
const colorMode = useColorMode()
useHead({ meta: computed(() => themeColorMeta(colorMode.preference, colorMode.value)) })
// <NuxtPwaAssets> adds its own plain theme-color (the manifest's, always light), which would win over ours for the dark
// theme. Ours are the ones with a key.
injectHead()?.hooks?.hook('tags:resolve', (ctx) => {
  ctx.tags = ctx.tags.filter((t) => !(t.tag === 'meta' && t.props.name === 'theme-color' && !t.key))
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

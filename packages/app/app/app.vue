<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'
import { faviconHref, logoColor } from '~/lib/brand'
import { themeColorMeta } from '~/lib/shell'

// Browser chrome colour (the current style's header): both media-scoped tags on "system", a single plain tag once a
// theme is picked.
const colorMode = useColorMode()
const appearance = useAppearance()
useHead({
  meta: computed(() =>
    themeColorMeta(colorMode.preference, colorMode.value, appearance.style.value, appearance.effectiveAccent.value),
  ),
  // The browser-tab icon follows the accent (the installed icons are static). Replaces the module's static icon links below.
  link: computed(() => [
    { key: 'accent-icon', rel: 'icon', type: 'image/svg+xml', href: faviconHref(logoColor(appearance.effectiveAccent.value)) },
  ]),
})
// <NuxtPwaAssets> adds its own plain theme-color (the manifest's, always light), which would win over ours for the dark
// theme. Ours are the ones with a key.
injectHead()?.hooks?.hook('tags:resolve', (ctx) => {
  ctx.tags = ctx.tags.filter(
    (t) => !(t.tag === 'meta' && t.props.name === 'theme-color' && !t.key) && !(t.tag === 'link' && t.props.rel === 'icon' && !t.key),
  )
})
</script>

<template>
  <NuxtPwaAssets />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <UpdatePrompt />
  <BackupReminder />
  <!-- Bottom centre of the viewport; assets/css/main.css lifts it above the phone dock. -->
  <Toaster position="bottom-center" />
</template>

<script setup lang="ts">
import { Image as ImageIcon } from '@lucide/vue'
import { resolveDeviceUrl } from '~/lib/device-files'
import { photoCrossorigin } from '~/lib/photo-cache'
import { displayablePhotoUrl, isDeviceUrl, type PhotoSize } from '~/lib/photo-url'

const props = defineProps<{ url: string; size: PhotoSize; alt: string }>()

const src = ref<string | null>(null)
const failed = ref(false)

watch(
  () => [props.url, props.size] as const,
  ([url, size]) => {
    failed.value = false
    const shown = displayablePhotoUrl(url, size)
    if (shown === null) {
      // Not Uploadcare and not on the device: never loaded.
      src.value = null
      failed.value = true
      return
    }
    if (!isDeviceUrl(url)) {
      src.value = shown
      return
    }
    src.value = null
    void resolveDeviceUrl(url).then((resolved) => {
      // Ignore an answer for a url the component has moved on from.
      if (props.url !== url) return
      if (resolved === null) failed.value = true
      else src.value = resolved
    })
  },
  { immediate: true },
)
</script>

<template>
  <img v-if="src && !failed" :src="src" :alt="alt" :crossorigin="photoCrossorigin(src)" loading="lazy" decoding="async" draggable="false" @error="failed = true" >
  <div
    v-else
    class="grid place-items-center bg-thumb text-thumb-foreground"
    :role="alt === '' ? undefined : 'img'"
    :aria-hidden="alt === '' ? 'true' : undefined"
    :aria-label="alt === '' ? undefined : failed ? $t('photos.unavailable') : alt"
  >
    <ImageIcon class="size-1/3 max-h-8 min-h-4" aria-hidden="true" />
  </div>
</template>

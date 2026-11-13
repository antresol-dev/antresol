<script setup lang="ts">
import { Image as ImageIcon } from '@lucide/vue'
import { photoCrossorigin } from '~/lib/photo-cache'
import type { PhotoRef, PhotoSize } from '~/lib/photo-url'

const props = defineProps<{ photo: PhotoRef; size: PhotoSize; alt: string }>()

const { src, failed } = usePhotoSrc(props)
</script>

<template>
  <img
    v-if="src && !failed"
    :crossorigin="photoCrossorigin(src)"
    loading="lazy"
    decoding="async"
    :src="src"
    :alt="alt"
    draggable="false"
    @error="failed = true"
  >
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

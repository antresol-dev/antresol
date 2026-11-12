<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { Camera, Images, ImagePlus } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{ multiple?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ pick: [files: File[]] }>()

// A touch device gets the camera and the gallery as two buttons; a desktop gets one button (and drop and paste in the gallery).
const phone = useMediaQuery('(pointer: coarse)')
const camera = useTemplateRef<HTMLInputElement>('camera')
const gallery = useTemplateRef<HTMLInputElement>('gallery')

function picked(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? []).filter((f) => f.type === '' || f.type.startsWith('image/'))
  // Picking the same file again must fire change again.
  input.value = ''
  if (files.length > 0) emit('pick', props.multiple ? files : files.slice(0, 1))
}
// Flat, with a border (the owner, 2026-11-12): a raised pair here competed with the form's own buttons.
const buttonClass = 'h-11 border border-input px-4 btn-label'
</script>

<template>
  <div class="flex flex-wrap justify-center gap-2">
    <template v-if="phone">
      <Button type="button" variant="ghost" :class="buttonClass" :disabled="disabled" @click="camera?.click()">
        <Camera class="size-5" aria-hidden="true" />
        {{ $t('photos.camera') }}
      </Button>
      <Button type="button" variant="ghost" :class="buttonClass" :disabled="disabled" @click="gallery?.click()">
        <Images class="size-5" aria-hidden="true" />
        {{ $t('photos.gallery') }}
      </Button>
      <input ref="camera" type="file" accept="image/*" capture="environment" class="hidden" tabindex="-1" @change="picked" >
    </template>
    <Button v-else type="button" variant="ghost" :class="buttonClass" :disabled="disabled" @click="gallery?.click()">
      <ImagePlus class="size-5" aria-hidden="true" />
      {{ $t('photos.add') }}
    </Button>
    <input ref="gallery" type="file" accept="image/*" :multiple="multiple" class="hidden" tabindex="-1" @change="picked" >
  </div>
</template>

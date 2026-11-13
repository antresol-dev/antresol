<script setup lang="ts">
import { Package } from '@lucide/vue'
import { monogram } from '~/lib/monogram'
import type { PhotoRef } from '~/lib/photo-url'
import { thumbTone } from '~/lib/thumb-tone'

const TONES = [
  { background: 'var(--st-thumb-tone-0)', color: 'var(--st-thumb-tone-fg-0)' },
  { background: 'var(--st-thumb-tone-1)', color: 'var(--st-thumb-tone-fg-1)' },
  { background: 'var(--st-thumb-tone-2)', color: 'var(--st-thumb-tone-fg-2)' },
  { background: 'var(--st-thumb-tone-3)', color: 'var(--st-thumb-tone-fg-3)' },
  { background: 'var(--st-thumb-tone-4)', color: 'var(--st-thumb-tone-fg-4)' },
  { background: 'var(--st-thumb-tone-5)', color: 'var(--st-thumb-tone-fg-5)' },
]

// The picture of an item in a list: its photo, else the letters of its folder ("IC"), else a general item icon (in the
// inventory root, or a folder name without letters). The tone comes from the item's id, so it survives renames. Size,
// radius and the letters' font size come from the parent's class.
const props = defineProps<{ id: string; folderName: string | null; cover: PhotoRef | null }>()
const letters = computed(() => (props.folderName === null ? '' : monogram(props.folderName)))
const tone = computed(() => TONES[thumbTone(props.id, TONES.length)]!)
</script>

<template>
  <span
    class="grid shrink-0 place-items-center overflow-hidden leading-none font-semibold tracking-[-0.02em] select-none"
    :style="tone"
    aria-hidden="true"
  >
    <PhotoImg v-if="cover" :photo="cover" size="thumb" alt="" class="size-full object-cover" />
    <template v-else-if="letters">{{ letters }}</template>
    <Package v-else class="size-[45%]" stroke-width="1.75" />
  </span>
</template>

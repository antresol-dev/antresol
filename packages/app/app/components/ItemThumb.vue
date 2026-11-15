<script setup lang="ts">
import { Package } from '@lucide/vue'
import { iconFrom } from '~/lib/item-icons'
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

// The picture of an item in a list: its photo, else its own icon, else its folder's icon, else the letters of its folder ("IC"), else a general item icon (in the
// inventory root, or a folder name without letters). The tone comes from the item's id, so it survives renames. Size,
// radius and the letters' font size come from the parent's class.
const props = defineProps<{
  id: string
  folderName: string | null
  cover: PhotoRef | null
  /** The item's own icon name, and its folder's; unknown names (or a set not loaded yet) fall to the next step. */
  icon?: string | null
  folderIcon?: string | null
}>()
const iconSet = useItemIconSet()
const own = computed(() => iconFrom(iconSet.value, props.icon))
const inherited = computed(() => iconFrom(iconSet.value, props.folderIcon))
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
    <component :is="own" v-else-if="own" class="size-[55%]" stroke-width="1.75" />
    <component :is="inherited" v-else-if="inherited" class="size-[55%]" stroke-width="1.75" />
    <template v-else-if="letters">{{ letters }}</template>
    <Package v-else class="size-[45%]" stroke-width="1.75" />
  </span>
</template>

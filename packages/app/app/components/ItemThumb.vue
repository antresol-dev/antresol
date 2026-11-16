<script setup lang="ts">
import { Package } from '@lucide/vue'
import { iconFrom } from '~/lib/item-icons'
import { monogram } from '~/lib/monogram'
import type { PhotoRef } from '~/lib/photo-url'
import { colorVars, itemColor } from '~/lib/item-colors'

// The picture of an item in a list: its photo, else its own icon, else its folder's icon, else the letters of its folder ("IC"), else a general item icon (in the
// inventory root, or a folder name without letters). The colour is the item's own, else one from its id (so it survives renames); it tints the backing and frames the picture. Size,
// radius and the letters' font size come from the parent's class.
const props = defineProps<{
  id: string
  folderName: string | null
  cover: PhotoRef | null
  /** The item's own icon name, and its folder's; unknown names (or a set not loaded yet) fall to the next step. */
  icon?: string | null
  folderIcon?: string | null
  /** The item's colour (#RRGGBB); null takes the colour from the id. */
  color: string | null
}>()
const iconSet = useItemIconSet()
const own = computed(() => iconFrom(iconSet.value, props.icon))
const inherited = computed(() => iconFrom(iconSet.value, props.folderIcon))
const letters = computed(() => (props.folderName === null ? '' : monogram(props.folderName)))
const vars = computed(() => colorVars(itemColor({ id: props.id, color: props.color })))
</script>

<template>
  <span
    class="colored thumb-colored grid shrink-0 place-items-center overflow-hidden leading-none font-semibold tracking-[-0.02em] select-none"
    :style="vars"
    aria-hidden="true"
  >
    <PhotoImg v-if="cover" :photo="cover" size="thumb" alt="" class="size-full object-cover" />
    <component :is="own" v-else-if="own" class="size-[55%]" stroke-width="1.75" />
    <component :is="inherited" v-else-if="inherited" class="size-[55%]" stroke-width="1.75" />
    <template v-else-if="letters">{{ letters }}</template>
    <Package v-else class="size-[45%]" stroke-width="1.75" />
  </span>
</template>

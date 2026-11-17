<script setup lang="ts">
import { Package } from '@lucide/vue'
import { iconFrom } from '~/lib/item-icons'
import { colorVars, itemColor } from '~/lib/item-colors'

// The item's icon before its name in the header, in the item's colour, like a file type icon before a file name in an
// editor: so the colour and the icon show even when a photo covers the thumbnail. Its own icon, else its folder's, else
// the general item icon (no letters here: they would read as part of the name).
const props = defineProps<{ id: string; icon: string | null; folderIcon: string | null; color: string | null }>()
const iconSet = useItemIconSet()
const shown = computed(() => iconFrom(iconSet.value, props.icon) ?? iconFrom(iconSet.value, props.folderIcon) ?? Package)
const vars = computed(() => colorVars(itemColor({ id: props.id, color: props.color })))
</script>

<template>
  <component :is="shown" class="colored mr-2 inline-block size-6 shrink-0 align-[-0.15em] text-(--c)" :style="vars" stroke-width="2" aria-hidden="true" />
</template>

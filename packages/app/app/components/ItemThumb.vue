<script setup lang="ts">
import { Cpu } from '@lucide/vue'
import { monogram } from '~/lib/monogram'

// The picture of an item in a list: its photo, else its monogram ("TL"), else a chip icon. Size, radius and the
// monogram's font size come from the parent's class.
const props = defineProps<{ name: string; coverUrl: string | null }>()
const letters = computed(() => monogram(props.name))
</script>

<template>
  <span
    class="grid shrink-0 place-items-center overflow-hidden bg-thumb leading-none font-extrabold tracking-[-0.02em] text-dimmed-foreground select-none"
    aria-hidden="true"
  >
    <PhotoImg v-if="coverUrl" :url="coverUrl" size="thumb" alt="" class="size-full object-cover" />
    <template v-else-if="letters">{{ letters }}</template>
    <Cpu v-else class="size-[45%]" stroke-width="1.75" />
  </span>
</template>

<script setup lang="ts">
import { colorVars } from '~/lib/item-colors'

// The item's description and tags, under the photos or, without photos, beside the 64 px photo tile (ItemGallery).
defineProps<{ description: string | null; tags: { id: string; name: string; color: string | null }[] }>()
</script>

<template>
  <div class="grid min-w-0 gap-2">
    <p v-if="description" class="text-base whitespace-pre-line text-muted-foreground wrap-anywhere">
      {{ description }}
    </p>
    <ul v-if="tags.length > 0" class="flex min-w-0 flex-wrap gap-1.5" :aria-label="$t('item.tags')">
      <li
        v-for="tag in tags"
        :key="tag.id"
        class="tag-chip max-w-full truncate px-3 py-1 text-xs font-semibold"
        :class="tag.color ? 'colored bg-[color-mix(in_srgb,var(--c)_15%,transparent)]! text-(--c)!' : undefined"
        :style="tag.color ? colorVars(tag.color) : undefined"
      >
        {{ tag.name }}
      </li>
    </ul>
  </div>
</template>

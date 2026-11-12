<script setup lang="ts">
definePageMeta({ layout: 'default' })

const route = useRoute('item-id')
const itemId = computed(() => String(route.params.id))
// ?variant=<id> marks the variant a search result pointed at.
const variantId = computed(() => (typeof route.query.variant === 'string' && route.query.variant !== '' ? route.query.variant : null))
</script>

<template>
  <main class="min-w-0">
    <ItemScreen :item-id="itemId" :variant-id="variantId" />
  </main>
</template>

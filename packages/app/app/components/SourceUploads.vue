<script setup lang="ts">
import { uploadsThisMonth } from '~/lib/uploads'

// Photos this device uploaded for the source this month (the photo store's own count is in its console).
const props = defineProps<{ sourceId: string }>()
const count = ref<number | null>(null)
onMounted(async () => {
  count.value = await uploadsThisMonth(props.sourceId)
})
</script>

<template>
  <p v-if="count !== null" class="text-sm text-subtle-foreground">{{ $t('diagnostics.uploads', count) }}</p>
</template>

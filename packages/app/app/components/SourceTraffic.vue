<script setup lang="ts">
import { formatBytes, MONTHLY_LIMIT_BYTES, trafficMeter } from '~/lib/traffic'

// An estimate of this month's Neon responses on this device (the source's own count is only in the Neon console).
const props = defineProps<{ sourceId: string }>()
const bytes = ref<number | null>(null)
onMounted(async () => {
  bytes.value = (await trafficMeter.monthly(props.sourceId)).bytes
})
</script>

<template>
  <p v-if="bytes !== null" class="text-sm text-subtle-foreground">
    {{ $t('diagnostics.traffic', { used: formatBytes(bytes), limit: formatBytes(MONTHLY_LIMIT_BYTES) }) }}
  </p>
</template>

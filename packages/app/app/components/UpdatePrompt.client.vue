<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { toast } from 'vue-sonner'

const { t } = useI18n()
const HOUR = 60 * 60 * 1000
let timer: ReturnType<typeof setInterval> | undefined

// Never reloads by itself: a new version waits behind the toast, so nothing typed is lost.
const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_url, registration) {
    if (registration) timer = setInterval(() => void registration.update().catch(() => {}), HOUR)
  },
})

watch(needRefresh, (value) => {
  if (!value) return
  toast(t('update.available'), {
    duration: Infinity,
    action: { label: t('update.reload'), onClick: () => void updateServiceWorker(true) },
  })
})
watch(offlineReady, (value) => {
  if (!value) return
  toast(t('update.offlineReady'))
  offlineReady.value = false
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <span hidden />
</template>

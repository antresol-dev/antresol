<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { clearPhotoCache, photoCacheSize } from '~/lib/photo-cache'
import { formatBytes } from '~/lib/traffic'

// Settings → Photo cache: what the service worker keeps of the photos on this device, to look at and clear.
const { t } = useI18n()
const size = ref<number | null>(null)
const clearing = ref(false)

async function load(): Promise<void> {
  size.value = await photoCacheSize()
}
onMounted(load)

async function clear(): Promise<void> {
  clearing.value = true
  try {
    await clearPhotoCache()
    toast.success(t('photoCache.cleared'))
  } catch {
    toast.error(t('photoCache.failed'))
  } finally {
    clearing.value = false
    await load()
  }
}
</script>

<template>
  <section class="grid gap-2" aria-labelledby="settings-photo-cache">
    <h2 id="settings-photo-cache" class="section-label text-sm">{{ $t('photoCache.title') }}</h2>
    <div class="raised-card grid gap-2 p-4.5">
      <p class="text-sm text-subtle-foreground">{{ $t('photoCache.hint') }}</p>
      <p v-if="size !== null" class="text-sm">{{ $t('photoCache.size', { size: formatBytes(size) }) }}</p>
      <div class="-mx-2 flex flex-wrap">
        <Button variant="ghost" class="h-11 text-accent-ink" :disabled="clearing || !size" @click="clear">
          {{ $t('photoCache.clear') }}
        </Button>
      </div>
    </div>
  </section>
</template>

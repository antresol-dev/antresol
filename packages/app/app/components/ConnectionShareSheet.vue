<script setup lang="ts">
import { QrCode } from '@lucide/vue'
import { renderSVG } from 'uqr'
import { Button } from '@/components/ui/button'
import { connectionLink } from '~/lib/connection-share'
import type { SourceConfig } from '~/lib/types'

// Settings → a source → "Share": a QR code with the source's settings for another device. The phone scans it in the
// app (Settings → Scan QR code) or with its camera app, which opens the new-source page filled in. The code holds the
// password, so it shows only after a tap.
const props = defineProps<{ source: SourceConfig | null }>()
const open = defineModel<boolean>('open', { required: true })

const revealed = ref(false)
watch(open, (o) => {
  if (o) revealed.value = false
})
// The last source stays while the sheet animates out.
const shown = shallowRef<SourceConfig | null>(props.source)
watch(
  () => props.source,
  (s) => {
    if (s) shown.value = s
  },
)

const svg = computed(() => {
  if (!shown.value || !revealed.value) return ''
  const base = `${location.origin}${useRuntimeConfig().app.baseURL}`
  // Dark on white whatever the theme: phone cameras read that best.
  return renderSVG(connectionLink(base, shown.value), { ecc: 'L', border: 2, pixelSize: 8 })
})
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('connectionShare.title')" :summary="shown?.name">
    <div class="grid gap-3.5 pt-2">
      <p class="text-sm text-subtle-foreground">{{ $t('connectionShare.hint') }}</p>
      <!-- eslint-disable-next-line vue/no-v-html -- an SVG made here from our own data, no script -->
      <div v-if="svg" class="qr mx-auto w-full max-w-72 overflow-hidden rounded-field bg-white p-2" role="img" :aria-label="$t('connectionShare.qrLabel')" v-html="svg" />
      <Button v-else type="button" variant="ghost" class="h-11 w-full border border-input px-4 btn-label" @click="revealed = true">
        <QrCode class="size-5" aria-hidden="true" />
        {{ $t('connectionShare.show') }}
      </Button>
      <p class="text-sm text-subtle-foreground">{{ $t('connectionShare.warning') }}</p>
    </div>
  </AppSheet>
</template>

<style scoped>
.qr :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
</style>

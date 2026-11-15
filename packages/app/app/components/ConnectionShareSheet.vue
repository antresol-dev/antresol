<script setup lang="ts">
import { renderSVG } from 'uqr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { canPair, connectionLink, normalizePairingCode } from '~/lib/connection-share'
import type { SourceConfig } from '~/lib/types'

// Settings → a source → "Share": the code shown by the receiving device (Receive a source) seals the source's
// settings into a QR code (lib/connection-share.ts). Without that code the QR code is useless, and the receiving
// device accepts only what was sealed with the code it made.
const props = defineProps<{ source: SourceConfig | null }>()
const open = defineModel<boolean>('open', { required: true })

const code = ref('')
const svg = ref('')
const sealing = ref(false)
const badCode = ref(false)
const supported = canPair()

watch(open, (o) => {
  if (o) {
    code.value = ''
    svg.value = ''
    badCode.value = false
  }
})
watch(code, () => {
  badCode.value = false
})
// The last source stays while the sheet animates out.
const shown = shallowRef<SourceConfig | null>(props.source)
watch(
  () => props.source,
  (s) => {
    if (s) shown.value = s
  },
)

async function makeQr(): Promise<void> {
  const normalized = normalizePairingCode(code.value)
  if (!normalized) {
    badCode.value = true
    return
  }
  if (!shown.value) return
  sealing.value = true
  try {
    const base = `${location.origin}${useRuntimeConfig().app.baseURL}`
    // Dark on white whatever the theme: phone cameras read that best.
    svg.value = renderSVG(await connectionLink(base, shown.value, normalized), { ecc: 'L', border: 2, pixelSize: 8 })
  } finally {
    sealing.value = false
  }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('pairing.shareTitle')" :summary="shown?.name" initial-focus="#pairing-code">
    <div class="grid gap-4 pt-2">
      <p v-if="!supported" role="alert" class="text-sm text-destructive">{{ $t('pairing.insecure') }}</p>
      <template v-else-if="!svg">
        <p class="text-sm text-subtle-foreground">{{ $t('pairing.shareStep1') }}</p>
        <form class="grid gap-4" novalidate @submit.prevent="makeQr">
          <div class="grid gap-2">
            <Label for="pairing-code">{{ $t('pairing.codeField') }}</Label>
            <Input
              id="pairing-code"
              v-model="code"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              placeholder="XXXX-XXXX"
              :aria-invalid="badCode ? true : undefined"
              aria-describedby="pairing-code-problem"
              class="h-11 font-mono text-lg tracking-[0.12em] uppercase"
            />
            <p id="pairing-code-problem" role="alert" class="text-sm text-destructive">
              <template v-if="badCode">{{ $t('pairing.badCode') }}</template>
            </p>
          </div>
          <Button type="submit" class="h-11 rounded-field" data-primary :disabled="sealing">
            {{ $t(sealing ? 'pairing.sealing' : 'pairing.makeQr') }}
          </Button>
        </form>
      </template>
      <template v-else>
        <p class="text-sm text-subtle-foreground">{{ $t('pairing.shareStep2') }}</p>
        <!-- eslint-disable-next-line vue/no-v-html -- an SVG made here from our own data, no script -->
        <div class="qr mx-auto w-full max-w-72 overflow-hidden rounded-field bg-white p-2" role="img" :aria-label="$t('pairing.qrLabel')" v-html="svg" />
        <Button type="button" variant="outline" class="h-11" @click="svg = ''">{{ $t('pairing.otherCode') }}</Button>
      </template>
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

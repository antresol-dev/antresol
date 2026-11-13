<script setup lang="ts">
import { CONNECT_PARAM, encodeConnection, readConnection } from '~/lib/connection-share'

// "Scan QR code": the camera reads a source's QR code shown by another device (ConnectionShareSheet) and opens the
// new-source form filled in, to check and save there. Reading uses the browser's BarcodeDetector (Chrome on Android);
// where it is missing, the scan button is not shown (canScanConnection) and the phone's camera app opens the link.
const open = defineModel<boolean>('open', { required: true })
const router = useRouter()

const video = ref<HTMLVideoElement | null>(null)
const problem = ref<'denied' | 'camera' | 'foreign' | null>(null)
let stream: MediaStream | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let run = 0

function stop(): void {
  run++
  if (timer) clearTimeout(timer)
  timer = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

async function start(): Promise<void> {
  const mine = ++run
  problem.value = null
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    if (mine !== run) return s.getTracks().forEach((t) => t.stop())
    stream = s
    await nextTick()
    if (!video.value) return
    video.value.srcObject = s
    await video.value.play()
  } catch (e) {
    if (mine === run) problem.value = e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'camera'
    return
  }
  const detector = new BarcodeDetector({ formats: ['qr_code'] })
  const tick = async (): Promise<void> => {
    if (mine !== run || !video.value) return
    try {
      const codes = await detector.detect(video.value)
      for (const code of codes) {
        const found = readConnection(code.rawValue)
        if (found) {
          open.value = false
          void router.push({ path: '/settings/sources/new', hash: `#${CONNECT_PARAM}=${encodeConnection(found)}` })
          return
        }
        problem.value = 'foreign'
      }
    } catch {
      // A frame that could not be read: try the next one.
    }
    if (mine === run) timer = setTimeout(tick, 250)
  }
  void tick()
}

watch(
  open,
  (o) => {
    if (o) void start()
    else stop()
  },
  { immediate: true },
)
onBeforeUnmount(stop)
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('connectionScan.title')">
    <div class="grid gap-3.5 pt-2">
      <p class="text-sm text-subtle-foreground">{{ $t('connectionScan.hint') }}</p>
      <div class="relative mx-auto aspect-square w-full max-w-80 overflow-hidden rounded-field bg-black">
        <video ref="video" class="size-full object-cover" playsinline muted />
        <div class="pointer-events-none absolute inset-[15%] rounded-field border-2 border-white/80" aria-hidden="true" />
      </div>
      <p v-if="problem" role="alert" class="text-sm text-destructive">{{ $t(`connectionScan.problem.${problem}`) }}</p>
    </div>
  </AppSheet>
</template>

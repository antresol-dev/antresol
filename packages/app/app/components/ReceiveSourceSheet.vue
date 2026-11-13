<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  canScanConnection,
  endPairing,
  formatPairingCode,
  openConnection,
  pairToken,
  pendingPairing,
  startPairing,
  type PendingPairing,
} from '~/lib/connection-share'

// "Receive a source" on the device that gets it (the phone): a one-time code to type on the other device, then the
// camera reads the QR code that device shows, sealed with that code (lib/connection-share.ts). Without an in-app
// camera (no BarcodeDetector) the phone's camera app opens the QR code's link, and the new-source page opens it with
// the code waiting here.
const open = defineModel<boolean>('open', { required: true })
const router = useRouter()
const received = useReceivedSource()
const canScan = canScanConnection()

const storage = (): Storage | null => {
  try {
    return localStorage
  } catch {
    return null
  }
}
const pairing = shallowRef<PendingPairing | null>(null)
const minutesLeft = ref(0)
const shownCode = computed(() => (pairing.value ? formatPairingCode(pairing.value.code) : ''))
let clock: ReturnType<typeof setInterval> | null = null
function tickClock(): void {
  const p = pairing.value
  if (!p) return
  const left = p.expiresAt - Date.now()
  // Expired while shown: a fresh code, so the one on screen always works.
  if (left <= 0) pairing.value = startPairing(storage(), Date.now())
  minutesLeft.value = Math.max(1, Math.ceil((pairing.value!.expiresAt - Date.now()) / 60_000))
}
function newCode(): void {
  pairing.value = startPairing(storage(), Date.now())
  problem.value = null
  lastToken = ''
  tickClock()
}

const video = ref<HTMLVideoElement | null>(null)
const problem = ref<'denied' | 'camera' | 'foreign' | 'mismatch' | null>(null)
const opening = ref(false)
let stream: MediaStream | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let run = 0
/** The last token tried: a frame read again and again is decrypted once. */
let lastToken = ''

function stop(): void {
  run++
  if (timer) clearTimeout(timer)
  timer = null
  if (clock) clearInterval(clock)
  clock = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

async function tryToken(token: string): Promise<boolean> {
  const p = pairing.value
  if (!p || token === lastToken) return false
  lastToken = token
  opening.value = true
  try {
    const found = await openConnection(token, p.code)
    if (!found) {
      problem.value = 'mismatch'
      return false
    }
    endPairing(storage())
    received.value = found
    open.value = false
    void router.push('/settings/sources/new')
    return true
  } finally {
    opening.value = false
  }
}

async function startCamera(mine: number): Promise<void> {
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
      for (const code of await detector.detect(video.value)) {
        const token = pairToken(code.rawValue)
        if (!token) problem.value = 'foreign'
        else if (await tryToken(token)) return
      }
    } catch {
      // A frame that could not be read: try the next one.
    }
    if (mine === run) timer = setTimeout(tick, 250)
  }
  void tick()
}

function begin(): void {
  const mine = ++run
  problem.value = null
  lastToken = ''
  pairing.value = pendingPairing(storage(), Date.now()) ?? startPairing(storage(), Date.now())
  tickClock()
  clock = setInterval(tickClock, 5_000)
  if (canScan) void startCamera(mine)
}

watch(
  open,
  (o) => {
    if (o) begin()
    else stop()
  },
  { immediate: true },
)
onBeforeUnmount(stop)
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('pairing.receiveTitle')">
    <div class="grid gap-4 pt-2">
      <p class="text-sm text-subtle-foreground">{{ $t('pairing.receiveStep1') }}</p>
      <div class="flex items-center justify-center gap-2">
        <output
          class="rounded-field bg-chip px-4 py-2 font-mono text-2xl font-semibold tracking-[0.12em] tabular-nums select-all"
          :aria-label="$t('pairing.codeLabel', { code: pairing ? [...pairing.code].join(' ') : '' })"
        >{{ shownCode }}</output>
        <Button type="button" variant="ghost" size="icon" class="size-11" :aria-label="$t('pairing.newCode')" @click="newCode">
          <RefreshCw class="size-5" aria-hidden="true" />
        </Button>
      </div>
      <p class="text-center text-xs text-subtle-foreground">{{ $t('pairing.expires', { minutes: minutesLeft }) }}</p>
      <p class="text-sm text-subtle-foreground">{{ $t(canScan ? 'pairing.receiveStep2Scan' : 'pairing.receiveStep2Camera') }}</p>
      <div v-if="canScan" class="relative mx-auto aspect-square w-full max-w-72 overflow-hidden rounded-field bg-black">
        <video ref="video" class="size-full object-cover" playsinline muted />
        <div class="pointer-events-none absolute inset-[15%] rounded-field border-2 border-white/80" aria-hidden="true" />
      </div>
      <p v-if="opening" role="status" class="text-sm">{{ $t('pairing.opening') }}</p>
      <p v-else-if="problem" role="alert" class="text-sm text-destructive">{{ $t(`pairing.problem.${problem}`) }}</p>
    </div>
  </AppSheet>
</template>

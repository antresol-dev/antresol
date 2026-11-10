<script setup lang="ts">
import type { Photo } from '@graymatter/core'
import { ChevronLeft, ChevronRight, ImageUp, Trash2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { errorMessageKey } from '~/lib/errors'
import { SWIPE } from '~/lib/swipe'

const props = defineProps<{ itemId: string; photos: Photo[] }>()
const open = defineModel<boolean>('open', { required: true })
const index = defineModel<number>('index', { required: true })

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const busy = ref(false)
const confirmOpen = ref(false)
const locked = computed(() => !!state.readOnly || state.saving || busy.value)

useCloseWatcher(open, () => busy.value)

const photo = computed(() => props.photos[index.value] ?? null)
const total = computed(() => props.photos.length)

// Photos come and go with the snapshot: keep the index inside the list, close when nothing is left.
watch(
  () => props.photos.length,
  (n) => {
    if (n === 0) open.value = false
    else if (index.value > n - 1) index.value = n - 1
  },
)

function go(step: number): void {
  if (total.value < 2) return
  index.value = (index.value + step + total.value) % total.value
}
function onKey(event: KeyboardEvent): void {
  if (confirmOpen.value) return
  if (event.key === 'ArrowLeft') go(-1)
  else if (event.key === 'ArrowRight') go(1)
  else return
  event.preventDefault()
}

// Swipe: same thresholds as the menu swipe; a rightward swipe from the screen edge is Android's back gesture.
let start: { x: number; y: number } | null = null
function onTouchStart(event: TouchEvent): void {
  const touch = event.touches.length === 1 ? event.touches[0] : undefined
  start = touch ? { x: touch.clientX, y: touch.clientY } : null
}
function onTouchEnd(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  const from = start
  start = null
  if (!from || !touch) return
  const dx = touch.clientX - from.x
  const dy = touch.clientY - from.y
  if (Math.abs(dx) < SWIPE.minDistance || Math.abs(dx) < SWIPE.dominance * Math.abs(dy)) return
  if (dx > 0) {
    if (from.x >= SWIPE.edgeGuard) go(-1)
  } else go(1)
}

async function run(action: () => Promise<void>): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    await action()
    return true
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
    return false
  } finally {
    busy.value = false
  }
}
async function makeCover(): Promise<void> {
  const p = photo.value
  if (!p) return
  if (await run(() => workspace.makeCover(props.itemId, p.id))) index.value = 0
}
async function remove(): Promise<void> {
  const p = photo.value
  if (!p) return
  if (await run(() => workspace.removePhoto(p.id))) confirmOpen.value = false
}

const iconButton = 'size-11 shrink-0 rounded-field'
const arrow =
  'absolute top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-surface/80 text-foreground outline-none transition-colors duration-150 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring'
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close-button="false"
      class="inset-0 top-0 left-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 shadow-none sm:max-w-none motion-reduce:animate-none"
      @keydown="onKey"
      @escape-key-down="(e) => busy && e.preventDefault()"
      @pointer-down-outside="(e) => e.preventDefault()"
    >
      <DialogTitle class="sr-only">{{ $t('photos.viewer') }}</DialogTitle>
      <DialogDescription class="sr-only">{{ $t('photos.viewer') }}</DialogDescription>
      <header class="flex min-h-14 shrink-0 items-center justify-between gap-2 px-2">
        <Button variant="ghost" size="icon" :class="iconButton" :aria-label="$t('ui.close')" :disabled="busy" @click="open = false">
          <X class="size-5" aria-hidden="true" />
        </Button>
        <span class="text-sm font-semibold text-muted-foreground tabular-nums">{{ $t('photos.counter', { n: index + 1, total }) }}</span>
        <span class="size-11" aria-hidden="true" />
      </header>
      <div
        class="relative min-h-0 grow touch-pan-y select-none"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <PhotoImg
          v-if="photo"
          :key="photo.id"
          :url="photo.url"
          size="full"
          :alt="$t('photos.alt', { n: index + 1, total })"
          class="size-full object-contain"
        />
        <button v-if="total > 1" type="button" :class="[arrow, 'left-2']" :aria-label="$t('photos.previous')" @click="go(-1)">
          <ChevronLeft class="size-6" aria-hidden="true" />
        </button>
        <button v-if="total > 1" type="button" :class="[arrow, 'right-2']" :aria-label="$t('photos.next')" @click="go(1)">
          <ChevronRight class="size-6" aria-hidden="true" />
        </button>
      </div>
      <footer class="flex shrink-0 flex-wrap items-center justify-center gap-2 p-3">
        <Button
          type="button"
          variant="outline"
          class="h-11 rounded-field bg-surface px-4 font-bold"
          :disabled="locked || index === 0"
          @click="makeCover"
        >
          <ImageUp class="size-5" aria-hidden="true" />
          {{ $t(index === 0 ? 'photos.cover' : 'photos.makeCover') }}
        </Button>
        <Button
          type="button"
          variant="outline"
          class="h-11 rounded-field bg-surface px-4 font-bold"
          :disabled="locked"
          @click="confirmOpen = true"
        >
          <Trash2 class="size-5" aria-hidden="true" />
          {{ $t('photos.delete') }}
        </Button>
      </footer>
    </DialogContent>
  </Dialog>
  <ConfirmSheet
    v-model:open="confirmOpen"
    :title="$t('photos.deleteTitle')"
    :description="$t('photos.deleteConfirm')"
    :confirm-label="$t(busy ? 'status.saving' : 'photos.delete')"
    :busy="busy"
    destructive
    @confirm="remove"
  />
</template>

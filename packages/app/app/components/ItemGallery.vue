<script setup lang="ts">
import type { Photo } from '@antresol/core'
import { FileError } from '@antresol/core'
import { Ban, ImagePlus, Plus, Shapes } from '@lucide/vue'
import { iconFrom } from '~/lib/item-icons'
import { toast } from 'vue-sonner'
import { errorMessageKey } from '~/lib/errors'

const props = defineProps<{ itemId: string; photos: Photo[]; icon?: string | null; folderIcon?: string | null; color?: string | null }>()
defineSlots<{
  /** Without photos: what stands beside the 64 px photo tile (the item's description and tags). */
  beside?: () => unknown
}>()

const { t } = useI18n()
const router = useRouter()
const workspace = useWorkspace()
const { state } = workspace

const sourceId = computed(() => state.current?.sourceId ?? null)
const hasStore = computed(() => sourceId.value !== null && workspace.fileStoreFor(sourceId.value) !== null)
const readOnly = computed(() => !!state.readOnly)

// Uploads run outside the write queue (state.saving stays false), so the gallery counts its own progress.
const progress = ref<{ total: number; done: number } | null>(null)
const busy = computed(() => progress.value !== null || state.saving)
const canAdd = computed(() => !readOnly.value && hasStore.value && !busy.value)
const skeletons = computed(() => {
  const p = progress.value
  return p ? Array.from({ length: p.total - p.done }, (_, i) => p.done + i + 1) : []
})

function retry(files: File[]): void {
  if (!canAdd.value) {
    // Never fail silently: say why nothing happens (a write is running, or the source went read-only).
    toast.error(t(readOnly.value ? 'errors.storage.read_only' : 'photos.busy'))
    return
  }
  void upload(files)
}

async function upload(files: File[]): Promise<void> {
  if (files.length === 0 || !canAdd.value) return
  progress.value = { total: files.length, done: 0 }
  try {
    await workspace.addPhotos(props.itemId, files, (done) => {
      if (progress.value) progress.value.done = done
    })
  } catch (e) {
    const done = progress.value?.done ?? 0
    // A photo the app can't use fails again however often it is tried: retry what comes after it.
    const hopeless = e instanceof FileError && (e.code === 'unsupported' || e.code === 'too_large' || e.code === 'too_large_to_decode')
    const rest = files.slice(done + (hopeless ? 1 : 0))
    // A refused photo or a missing store is fixed in this source's settings, not by retrying.
    const needsSettings = e instanceof FileError && (e.code === 'rejected' || e.code === 'no_store')
    const settingsTo = sourceId.value ? `/settings/sources/${sourceId.value}` : '/settings'
    toast.error(
      t(errorMessageKey(e)),
      needsSettings
        ? { action: { label: t('nav.settings'), onClick: () => void router.push(settingsTo) } }
        : rest.length > 0
          ? { action: { label: t('status.retry'), onClick: () => retry(rest) } }
          : {},
    )
  } finally {
    progress.value = null
  }
}

const addOpen = ref(false)

// Without photos the 64 px tile shows the item's icon (own, else its folder's) on the item's tone; a tap offers a photo or an icon.
const iconSet = useItemIconSet()
const shownIcon = computed(() => iconFrom(iconSet.value, props.icon) ?? iconFrom(iconSet.value, props.folderIcon))
const tileOpen = ref(false)
const iconOpen = ref(false)
function tilePhoto(): void {
  tileOpen.value = false
  addOpen.value = true
}
function tileIcon(): void {
  tileOpen.value = false
  iconOpen.value = true
}
async function saveIcon(icon: string | null): Promise<void> {
  if (readOnly.value || state.saving) {
    toast.error(t(readOnly.value ? 'errors.storage.read_only' : 'photos.busy'))
    return
  }
  try {
    await workspace.apply({ type: 'item.update', id: props.itemId, icon })
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}
function pickedFromSheet(files: File[]): void {
  addOpen.value = false
  void upload(files)
}

// Viewer.
const viewerOpen = ref(false)
const viewerIndex = ref(0)
function show(index: number): void {
  viewerIndex.value = index
  viewerOpen.value = true
}

// Drop and paste work only while the gallery is on screen.
const isImage = (f: File): boolean => f.type.startsWith('image/')
const dragging = ref(false)
function onDrop(event: DragEvent): void {
  dragging.value = false
  // Dropped while the gallery can't add: nothing happens (the browser still doesn't open the file).
  if (!canAdd.value) return
  void upload(Array.from(event.dataTransfer?.files ?? []).filter(isImage))
}
function onDragOver(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes('Files')) return
  // Always claim a file drag, so the browser never navigates to the dropped file.
  event.preventDefault()
  dragging.value = canAdd.value
}
function onDragLeave(event: DragEvent): void {
  // Moving over a child fires dragleave on the section: only leaving it for outside counts.
  const next = event.relatedTarget
  if (next instanceof Node && (event.currentTarget as Node).contains(next)) return
  dragging.value = false
}
function onPaste(event: ClipboardEvent): void {
  if (!canAdd.value || viewerOpen.value || addOpen.value) return
  // Any other open sheet or dialog (variant photo, stock, rename…) owns the screen: paste goes nowhere.
  if (document.querySelector('[role=dialog][data-state=open]')) return
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea'))) return
  const files = Array.from(event.clipboardData?.files ?? []).filter(isImage)
  if (files.length === 0) return
  event.preventDefault()
  void upload(files)
}
onMounted(() => document.addEventListener('paste', onPaste))
onBeforeUnmount(() => document.removeEventListener('paste', onPaste))

const cover = computed(() => props.photos[0] ?? null)
const alt = (i: number): string => t('photos.alt', { n: i + 1, total: props.photos.length })
// The mock-up's photo block: the cover and its thumbnails lie flat on the photo backing; "Add photos" is a raised tile.
// Tiles take the style's thumbnail radius; 6 px apart, so the raised one has room for its shadow.
const tile = 'relative size-16 shrink-0 overflow-hidden'
const pending = 'grid place-items-center bg-thumb text-xs font-semibold text-thumb-foreground motion-safe:animate-pulse'
</script>

<template>
  <section
    v-if="photos.length > 0 || progress || !readOnly || $slots.beside"
    :aria-label="photos.length > 0 || progress || !readOnly ? $t('photos.viewer') : undefined"
    :class="['grid min-w-0 gap-1.5 rounded-card', dragging && 'ring-2 ring-ring']"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <template v-if="cover">
      <button
        type="button"
        class="photo-cover aspect-[4/3] max-h-96 w-full overflow-hidden"
        :aria-label="alt(0)"
        @click="show(0)"
      >
        <PhotoImg :photo="cover" size="full" :alt="alt(0)" class="size-full object-cover" />
      </button>
      <div v-if="photos.length > 1 || progress || canAdd" class="flex flex-wrap gap-1.5">
        <button v-for="(p, i) in photos" :key="p.id" type="button" :class="[tile, 'photo-thumb']" :aria-label="alt(i)" @click="show(i)">
          <PhotoImg :photo="p" size="thumb" :alt="alt(i)" class="size-full object-cover" />
        </button>
        <div
          v-for="n in skeletons"
          :key="`up${n}`"
          role="status"
          :aria-label="$t('photos.uploading', { n, total: progress?.total ?? 0 })"
          :class="[tile, 'photo-thumb', pending]"
        >
          {{ $t('photos.progress', { n, total: progress?.total ?? 0 }) }}
        </div>
        <button
          v-if="canAdd"
          type="button"
          :class="[tile, 'add-tile pressable grid place-items-center']"
          :aria-label="$t('photos.add')"
          @click="addOpen = true"
        >
          <Plus class="size-5" aria-hidden="true" />
        </button>
      </div>
    </template>
    <!-- No photos (design system F1): a 64 px tile instead of the cover-sized block, so the stock and variants stay on
         the first screen; beside it the description and tags, or one line on what the tile is for. -->
    <div v-else class="flex min-w-0 items-start gap-3">
      <div
        v-if="progress"
        role="status"
        :aria-label="$t('photos.uploading', { n: progress.done + 1, total: progress.total })"
        :class="[tile, 'photo-thumb', pending]"
      >
        {{ $t('photos.progress', { n: progress.done + 1, total: progress.total }) }}
      </div>
      <ItemThumb
        v-else-if="readOnly && shownIcon"
        :id="itemId"
        :folder-name="null"
        :icon="icon"
        :folder-icon="folderIcon"
        :cover="null"
        :color="color ?? null"
        :class="[tile, 'photo-thumb']"
      />
      <button
        v-else-if="!readOnly"
        type="button"
        :class="[tile, 'pressable', shownIcon ? 'photo-thumb' : 'add-tile grid place-items-center text-icon']"
        :aria-label="$t(shownIcon ? 'iconPicker.tileTitle' : 'photos.add')"
        :disabled="busy"
        @click="shownIcon ? (tileOpen = true) : (addOpen = true)"
      >
        <ItemThumb v-if="shownIcon" :id="itemId" :folder-name="null" :icon="icon" :folder-icon="folderIcon" :cover="null" :color="color ?? null" class="size-full" style="border-radius: inherit" />
        <ImagePlus v-else class="size-6" aria-hidden="true" />
      </button>
      <div class="min-w-0 flex-1 self-center">
        <slot name="beside">
          <p v-if="!readOnly" class="text-sm text-muted-foreground">{{ $t(hasStore ? 'photos.emptyHint' : 'photos.noStore') }}</p>
        </slot>
      </div>
    </div>
    <p v-if="!hasStore && photos.length > 0 && !readOnly" class="pt-2 text-sm text-muted-foreground">
      {{ $t('photos.noStore') }}
    </p>
    <NuxtLink
      v-if="!hasStore && sourceId && !readOnly && photos.length > 0"
      :to="`/settings/sources/${sourceId}`"
      class="min-h-11 content-center rounded-chip text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
    >
      {{ $t('photos.noStoreLink') }}
    </NuxtLink>
    <AppSheet v-model:open="addOpen" :title="$t('photos.addTitle')">
      <PhotoPicker v-if="hasStore" multiple :disabled="!canAdd" class="py-2" @pick="pickedFromSheet" />
      <div v-else class="grid gap-2 py-2">
        <p class="text-sm text-muted-foreground">{{ $t('photos.noStore') }}</p>
        <NuxtLink
          v-if="sourceId"
          :to="`/settings/sources/${sourceId}`"
          class="min-h-11 content-center rounded-chip text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
          @click="addOpen = false"
        >
          {{ $t('photos.noStoreLink') }}
        </NuxtLink>
      </div>
    </AppSheet>
    <AppSheet v-model:open="tileOpen" :title="$t('iconPicker.tileTitle')">
      <div class="grid gap-2 py-2">
        <button type="button" class="pressable flex min-h-11 items-center gap-2 rounded-field bg-field px-3 text-left text-sm" @click="tilePhoto">
          <ImagePlus class="size-5 text-icon" aria-hidden="true" />
          {{ $t('iconPicker.photo') }}
        </button>
        <button type="button" class="pressable flex min-h-11 items-center gap-2 rounded-field bg-field px-3 text-left text-sm" @click="tileIcon">
          <Shapes class="size-5 text-icon" aria-hidden="true" />
          {{ $t('iconPicker.icon') }}
        </button>
        <button v-if="icon" type="button" class="pressable flex min-h-11 items-center gap-2 rounded-field bg-field px-3 text-left text-sm" @click="tileOpen = false; void saveIcon(null)">
          <Ban class="size-5 text-icon" aria-hidden="true" />
          {{ $t('iconPicker.remove') }}
        </button>
      </div>
    </AppSheet>
    <IconPicker v-model:open="iconOpen" :current="icon ?? null" @pick="saveIcon" />
    <PhotoViewer v-model:open="viewerOpen" v-model:index="viewerIndex" :item-id="itemId" :photos="photos" :locked="progress !== null" />
  </section>
</template>

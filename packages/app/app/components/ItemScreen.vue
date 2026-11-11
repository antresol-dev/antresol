<script setup lang="ts">
import { newId, variantLabel, type Id } from '@graymatter/core'
import { Plus } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { toast } from 'vue-sonner'
import type { StockTarget } from '~/components/StockSheet.vue'
import type { LooseOffer, VariantsAdded } from '~/components/VariantsForm.vue'
import { errorMessageKey } from '~/lib/errors'
import { itemView } from '~/lib/item-view'
import { archiveNow } from '~/lib/undo'
import { quickStep, type StockMode } from '~/lib/stock-forms'

const props = defineProps<{ itemId: string; variantId: string | null }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const snapshot = computed(() => state.snapshot)
const view = computed(() => (snapshot.value ? itemView(snapshot.value, props.itemId) : null))

// Header: the item's name, wrapping when long; the path is the inventory root and every folder of the item, links only.
const title = computed(() => view.value?.item.name ?? snapshot.value?.inventory.name ?? t('app.name'))
const crumbs = computed(() => {
  const s = snapshot.value
  const v = view.value
  if (!s || !v) return []
  return [{ name: s.inventory.name, to: '/' }, ...v.crumbs.map((c) => ({ name: c.name, to: `/folder/${c.id}` }))]
})

// No snapshot and nothing loading: say why instead of showing a skeleton forever (as the folder screen does).
const blocker = computed(() => {
  if (snapshot.value || state.refreshing) return null
  const current = state.current ? state.sources.find((s) => s.config.id === state.current?.sourceId) : null
  const source = current ?? state.sources.find((s) => s.status === 'unreachable' || s.status === 'error')
  if (source?.status === 'unreachable') return { kind: 'offline' as const, source }
  if (source?.status === 'error') return { kind: 'error' as const, source }
  // Sources answered but there is no inventory to show the item in.
  if (!state.current && state.sources.every((s) => s.status === 'ready' || s.status === 'read_only')) return { kind: 'gone' as const }
  return null
})
const fixTo = computed(() => {
  const b = blocker.value
  return b && b.kind === 'error' && b.source.config.kind === 'neon' ? `/settings/sources/${b.source.config.id}` : '/settings'
})

function retry(): void {
  void workspace.refresh().catch(() => {})
}

// Stock movements: "−" and "+" write at once, the other actions open the sheet.
const stockTarget = ref<StockTarget | null>(null)
const openStock = (mode: StockMode, variantId: string | null): void => {
  stockTarget.value = { mode, variantId }
}
async function step(kind: 'plus' | 'minus', variantId: string | null): Promise<void> {
  try {
    await workspace.apply(quickStep(kind, { itemId: props.itemId, variantId }, newId()))
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}

// Variants: add in bulk (and offer the loose stock to the first of them), rename, archive.
const locked = computed(() => !!state.readOnly || state.saving)
const addOpen = ref(false)
const addBusy = ref(false)
const renameBusy = ref(false)
const looseOffer = ref<{ offer: LooseOffer; variants: { id: Id; name: string }[] } | null>(null)
function added(a: VariantsAdded): void {
  addOpen.value = false
  const created = a.created.map((c) => ({ id: c.id, name: c.label }))
  if (a.offer) looseOffer.value = { offer: a.offer, variants: created }
}
const renameId = ref<Id | null>(null)
const variantOf = (id: Id) => snapshot.value?.variants.find((v) => v.id === id) ?? null
const renaming = computed(() => (renameId.value ? variantOf(renameId.value) : null))
const renameOpen = computed({
  get: () => renaming.value !== null,
  set: (open: boolean) => {
    if (!open) renameId.value = null
  },
})
function askArchive(id: Id): void {
  const v = variantOf(id)
  if (!v || locked.value) return
  // No question: the toast offers Undo.
  void archiveNow('variant', id, variantLabel(snapshot.value!, v)).catch((e) => toast.error(t(errorMessageKey(e))))
}

// Variant photo: one per variant, uploaded and swapped in by setVariantPhoto.
const photoId = ref<Id | null>(null)
const photoBusy = ref(false)
const photoVariant = shallowRef<{ id: Id; name: string } | null>(null)
const hasStore = computed(() => !!state.current && workspace.fileStoreFor(state.current.sourceId) !== null)
const photoOpen = computed({
  get: () => photoId.value !== null,
  set: (open: boolean) => {
    if (!open && !photoBusy.value) photoId.value = null
  },
})
function askPhoto(id: Id): void {
  const v = variantOf(id)
  if (!v) return
  photoVariant.value = { id, name: variantLabel(snapshot.value!, v) }
  photoId.value = id
}
async function pickVariantPhoto(files: File[]): Promise<void> {
  const id = photoId.value
  const file = files[0]
  if (!id || !file || photoBusy.value) return
  photoBusy.value = true
  try {
    await workspace.setVariantPhoto(props.itemId, id, file)
    photoId.value = null
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    photoBusy.value = false
  }
}

// Attributes: add one or edit its value in a sheet, remove after a confirmation (the variants' values go too); a
// variant's own values in another sheet.
const attributeOpen = ref(false)
const attributeId = ref<Id | null>(null)
const valuesId = ref<Id | null>(null)
function openAttribute(id: Id | null): void {
  attributeId.value = id
  attributeOpen.value = true
}
// An attribute turned into a variant axis: the item may get its first variant, and the stock it had without one is offered to it.
const { add: addAxis, loss: axisLoss } = useAddAxis()
// A shared value that would be dropped (the item has another axis and no variants) is confirmed first.
const axisLossAsk = ref<{ id: Id; name: string; value: string } | null>(null)
const axisLossShown = shallowRef<{ id: Id; name: string; value: string } | null>(null)
const axisBusy = ref(false)
const axisLossOpen = computed({
  get: () => axisLossAsk.value !== null,
  set: (open: boolean) => {
    if (!open && !axisBusy.value) axisLossAsk.value = null
  },
})
async function applyAxis(id: Id): Promise<void> {
  if (axisBusy.value) return
  axisBusy.value = true
  try {
    const added = await addAxis(props.itemId, id)
    if (added) looseOffer.value = added
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    axisLossAsk.value = null
    axisBusy.value = false
  }
}
async function makeAxis(id: Id): Promise<void> {
  const loss = axisLoss(props.itemId, id)
  if (!loss) return applyAxis(id)
  axisLossShown.value = axisLossAsk.value = { id, ...loss }
}
const removeId = ref<Id | null>(null)
const removeBusy = ref(false)
// The attribute's name as it was when the sheet opened: it stays while the sheet animates out.
const removeName = ref('')
const removeOpen = computed({
  get: () => removeId.value !== null,
  set: (open: boolean) => {
    if (!open && !removeBusy.value) removeId.value = null
  },
})
function askRemoveAttribute(id: Id): void {
  const row = view.value?.attributes.find((a) => a.attributeId === id)
  if (!row) return
  removeName.value = row.name
  removeId.value = id
}
async function removeAttribute(): Promise<void> {
  const id = removeId.value
  if (!id || removeBusy.value) return
  removeBusy.value = true
  try {
    await workspace.apply({ type: 'item.removeAttribute', itemId: props.itemId, attributeId: id })
    removeId.value = null
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    removeBusy.value = false
  }
}

const highlight = computed(() => (view.value?.hasVariants ? props.variantId : null))
const linkClass =
  'min-h-11 content-center rounded-md text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'
</script>

<template>
  <ScreenHeader :title="title" :crumbs="crumbs" wrap-title>
    <template v-if="view" #actions="{ compact }">
      <ItemActions :item-id="itemId" :compact="compact" />
    </template>
  </ScreenHeader>
  <ScreenBody>
    <template v-if="view && snapshot">
      <StockSheet :view="view" :target="stockTarget" @close="stockTarget = null" />
      <ItemGallery :item-id="itemId" :photos="view.photos" />
      <div v-if="view.item.description || view.tags.length > 0" class="grid min-w-0 gap-2.5">
        <p v-if="view.item.description" class="text-[15px] whitespace-pre-line text-muted-foreground wrap-anywhere">
          {{ view.item.description }}
        </p>
        <ul v-if="view.tags.length > 0" class="flex min-w-0 flex-wrap gap-1.5" :aria-label="$t('item.tags')">
          <li
            v-for="tag in view.tags"
            :key="tag.id"
            class="max-w-full truncate rounded-full bg-chip px-2.5 py-1 text-[13px] font-semibold"
          >
            {{ tag.name }}
          </li>
        </ul>
      </div>
      <StockCard
        :total="view.total"
        :unit-symbol="view.unit.symbol"
        :currency="view.currency"
        :controls="!view.hasVariants"
        @step="(kind) => step(kind, null)"
        @open="(mode) => openStock(mode, null)"
      />
      <div v-if="view.hasVariants || view.axes.length > 0" class="grid min-w-0 grid-cols-1">
      <ItemAxes :view="view" />
      <BucketList
        v-if="view.hasVariants"
        :buckets="view.buckets"
        :highlight="highlight"
        @step="step"
        @open="openStock"
        @rename="(id) => (renameId = id)"
        @attributes="(id) => (valuesId = id)"
        @photo="askPhoto"
        @archive="askArchive"
      />
      </div>
      <Button variant="outline" class="h-11 justify-self-start rounded-field bg-surface px-4 font-bold" :disabled="locked" @click="addOpen = true">
        <Plus class="size-5" aria-hidden="true" />
        {{ $t('variantsForm.open') }}
      </Button>
      <AppSheet v-model:open="addOpen" :title="$t('variantsForm.title')" :locked="addBusy" initial-focus="#variants-names">
        <VariantsForm v-if="addOpen" v-model:busy="addBusy" :item-id="itemId" @done="added" />
      </AppSheet>
      <LooseTransferSheet
        :item-id="itemId"
        :offer="looseOffer?.offer ?? null"
        :variants="looseOffer?.variants ?? []"
        @close="looseOffer = null"
      />
      <AppSheet v-model:open="renameOpen" :title="$t('item.editVariant')" :locked="renameBusy" initial-focus="#variant-name">
        <VariantForm v-if="renaming" :key="renaming.id" v-model:busy="renameBusy" :variant="renaming" @done="renameId = null" />
      </AppSheet>
      <AppSheet
        v-model:open="photoOpen"
        :title="$t('photos.variantTitle', { name: photoVariant?.name ?? '' })"
        :description="$t('photos.variantHint')"
        :locked="photoBusy"
      >
        <div v-if="!hasStore" class="grid py-2">
          <p class="text-sm text-muted-foreground">{{ $t('photos.noStore') }}</p>
          <NuxtLink
            v-if="state.current"
            :to="`/settings/sources/${state.current.sourceId}`"
            :class="linkClass"
          >
            {{ $t('photos.noStoreLink') }}
          </NuxtLink>
        </div>
        <PhotoPicker v-else class="py-3" :disabled="photoBusy || locked" @pick="pickVariantPhoto" />
      </AppSheet>
      <ItemAttributes
        :attributes="view.attributes"
        @add="openAttribute(null)"
        @edit="openAttribute"
        @axis="makeAxis"
        @remove="askRemoveAttribute"
      />
      <ConfirmSheet
        v-model:open="axisLossOpen"
        :title="$t('axes.dropTitle', { name: axisLossShown?.name ?? '' })"
        :description="$t('axes.dropBody', { name: axisLossShown?.name ?? '', value: axisLossShown?.value ?? '' })"
        :confirm-label="$t(axisBusy ? 'status.saving' : 'axes.dropConfirm')"
        :busy="axisBusy"
        destructive
        @confirm="axisLossShown && applyAxis(axisLossShown.id)"
      />
      <ConfirmSheet
        v-model:open="removeOpen"
        :title="$t('item.removeAttributeTitle')"
        :description="$t('item.removeAttributeConfirm', { name: removeName })"
        :confirm-label="$t(removeBusy ? 'status.saving' : 'item.removeAttribute')"
        :busy="removeBusy"
        destructive
        @confirm="removeAttribute"
      />
      <AttributeValueSheet :view="view" :open="attributeOpen" :attribute-id="attributeId" @close="attributeOpen = false" />
      <VariantValuesSheet :view="view" :variant-id="valuesId" @close="valuesId = null" />
      <JournalList :item-id="itemId" />
    </template>
    <EmptyState v-else-if="snapshot || blocker?.kind === 'gone'" :text="$t('empty.itemGone')">
      <NuxtLink to="/" :class="linkClass">
        {{ $t('empty.backTo', { name: snapshot?.inventory.name ?? $t('app.name') }) }}
      </NuxtLink>
    </EmptyState>
    <EmptyState v-else-if="blocker?.kind === 'offline'" :text="$t('empty.offlineNoCopy')">
      <Button variant="outline" class="h-11 rounded-field bg-surface" @click="retry">{{ $t('status.retry') }}</Button>
    </EmptyState>
    <EmptyState
      v-else-if="blocker?.kind === 'error'"
      :text="$t('empty.sourceFailed', { source: blocker.source.config.name, reason: $t(`errors.probe.${blocker.source.reason ?? 'failed'}`) })"
    >
      <NuxtLink :to="fixTo" :class="linkClass">{{ $t('status.fix') }}</NuxtLink>
    </EmptyState>
    <div v-else class="grid grid-cols-1 gap-3.5" aria-hidden="true">
      <Skeleton class="h-[104px] rounded-card" />
      <Skeleton class="h-40 rounded-card" />
    </div>
  </ScreenBody>
</template>

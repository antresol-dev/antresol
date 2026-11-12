<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { StockTarget } from '~/components/StockSheet.vue'
import { itemView, type ItemView } from '~/lib/item-view'

// Receiving into an item from anywhere in the app (useReceive): "Receive here" in quick add, "Receive…" in the share
// sheet. The item card has its own stock sheet.
const { t } = useI18n()
const router = useRouter()
const { state } = useWorkspace()
const { request, close } = useReceive()

const view = computed(() => (request.value && state.snapshot ? itemView(state.snapshot, request.value.itemId) : null))
// The last item stays while the sheet animates out.
const shownView = shallowRef<ItemView | null>(null)
watch(
  view,
  (v) => {
    if (v) shownView.value = v
  },
  { immediate: true },
)
// Set once per request: a new snapshot (a sync, this very write) must not reset the form.
const target = shallowRef<StockTarget | null>(null)
watch(
  request,
  (r) => {
    target.value = r
      ? { mode: 'receive', variantId: r.variantId, prefill: { amount: r.amount ?? '', price: r.price ?? '', url: r.url ?? '' } }
      : null
  },
  { immediate: true },
)
// The item went away (archived elsewhere) before the sheet could show it.
watch(view, (v) => {
  if (!v && request.value && state.snapshot) close()
})

function received(): void {
  const v = shownView.value
  if (!v) return
  const id = v.item.id
  toast.success(t('quickAdd.received', { name: v.item.name }), {
    action: { label: t('quickAdd.open'), onClick: () => void router.push(`/item/${id}`) },
  })
}
</script>

<template>
  <StockSheet v-if="shownView" :view="shownView" :target="target" @close="close" @done="received" />
</template>

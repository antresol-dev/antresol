<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { toast } from 'vue-sonner'
import { takeDraft, type QuickAddDraft } from '~/lib/quick-add-draft'
import type { QuickAddState } from '~/composables/useDialogs'

// The quick add sheet for the whole app: the "+" button, the header button and the palette open it through useQuickAdd().
const { t } = useI18n()
const router = useRouter()
const workspace = useWorkspace()
const { state, close } = useQuickAdd()
const receive = useReceive()

// What the form starts from: the values as they were when the sheet opened. They stay while it animates out, and a
// counter gives every opening a fresh form.
const shown = shallowRef<QuickAddState>({ name: '', folderId: null, url: '' })
const draft = shallowRef<QuickAddDraft | null>(null)
const openings = ref(0)
const busy = ref(false)
// The inventory changed underneath (desktop Back, Alt+←): the item would go to the old one. A write in flight finishes first.
useCloseOnSwitch(() => workspace.state.current, close, () => busy.value)
watch(
  state,
  (s) => {
    if (!s) return
    // Back from "Open" on a match: the form as it was left, unless this opening brings its own name or link.
    const inventoryId = workspace.state.snapshot?.inventory.id
    draft.value = inventoryId ? takeDraft(inventoryId, s) : null
    shown.value = draft.value ? { name: draft.value.name, folderId: draft.value.folderId, url: draft.value.url } : s
    openings.value++
    // A sleeping database answers slowly: wake it while the person types.
    void workspace.warmUp()
  },
  { immediate: true },
)

const open = computed({
  get: () => state.value !== null,
  set: (value: boolean) => {
    if (!value) close()
  },
})

// "Receive here": the sheet turns into receiving into that item, with the amount, price and link typed here.
function receiveInto(into: { itemId: Id; variantId: Id | null; amount: string; price: string; url: string; photoDropped: boolean }): void {
  const { photoDropped, ...target } = into
  close()
  receive.open(target)
  // The photo picked here is not carried over to the receipt.
  if (photoDropped) toast.info(t('quickAdd.photoDropped'))
}

function openItem(itemId: Id): void {
  close()
  void router.push(`/item/${itemId}`)
}

function added({ id, name, photoFailed }: { id: Id; name: string; photoFailed: boolean }): void {
  close()
  const action = { label: t('quickAdd.open'), onClick: () => void router.push(`/item/${id}`) }
  if (photoFailed) toast.warning(t('quickAdd.photoFailed'), { action })
  else toast.success(t('quickAdd.added', { name }), { action })
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('quickAdd.title')" initial-focus="#quick-add-name" :locked="busy">
    <QuickAddForm
      :key="openings"
      v-model:busy="busy"
      :name="shown.name"
      :folder-id="shown.folderId"
      :url="shown.url"
      :draft="draft"
      @done="added"
      @receive="receiveInto"
      @open="openItem"
      @close="close"
    />
  </AppSheet>
</template>

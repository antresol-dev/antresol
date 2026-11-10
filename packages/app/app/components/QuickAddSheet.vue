<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { toast } from 'vue-sonner'
import type { QuickAddState } from '~/composables/useDialogs'

// The quick add sheet for the whole app: the "+" button, the header button and the palette open it through useQuickAdd().
const { t } = useI18n()
const router = useRouter()
const { state, close } = useQuickAdd()

// What the form starts from: the values as they were when the sheet opened. They stay while it animates out, and a
// counter gives every opening a fresh form.
const shown = shallowRef<QuickAddState>({ name: '', folderId: null })
const openings = ref(0)
watch(
  state,
  (s) => {
    if (!s) return
    shown.value = s
    openings.value++
  },
  { immediate: true },
)

const open = computed({
  get: () => state.value !== null,
  set: (value: boolean) => {
    if (!value) close()
  },
})

function added({ id, name }: { id: Id; name: string }): void {
  close()
  toast.success(t('quickAdd.added', { name }), {
    action: { label: t('quickAdd.open'), onClick: () => void router.push(`/item/${id}`) },
  })
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('quickAdd.title')" initial-focus="#quick-add-name">
    <QuickAddForm :key="openings" :name="shown.name" :folder-id="shown.folderId" @done="added" />
  </AppSheet>
</template>

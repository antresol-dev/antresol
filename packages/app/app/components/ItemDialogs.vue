<script setup lang="ts">
import type { Id, Item } from '@graymatter/core'
import { toast } from 'vue-sonner'
import type { ItemDialog } from '~/composables/useDialogs'
import { errorMessageKey } from '~/lib/errors'
import { folderChoices } from '~/lib/views'

// The item sheets for the whole app: the card's header buttons and the rows' menus open them through useItemDialog().
const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace
const route = useRoute()
const router = useRouter()
const { dialog, close } = useItemDialog()
// One archive id per opening: a retried Confirm after a timeout sends the same command.
const { ids, renew } = useCommandIds(['archiveId'])

// The last dialog and its item as they were when it opened: they stay while the sheet animates out and after an archive.
const shown = shallowRef<ItemDialog | null>(null)
const item = shallowRef<Item | null>(null)
watch(
  dialog,
  (d) => {
    if (!d) return
    shown.value = d
    renew()
    item.value = state.snapshot?.items.find((i) => i.id === d.itemId) ?? null
    // Gone meanwhile (archived on another device): nothing to act on.
    if (!item.value) close()
  },
  { immediate: true },
)

const openWhen = (kind: ItemDialog['kind']) =>
  computed({
    get: () => dialog.value?.kind === kind,
    set: (open: boolean) => {
      if (!open) close()
    },
  })
const editOpen = openWhen('edit')
const moveOpen = openWhen('move')
const archiveOpen = openWhen('archive')

const busy = ref(false)
const editBusy = ref(false)
// The inventory changed underneath (desktop Back, Alt+←): the sheet would act on the old one. A write in flight finishes first.
useCloseOnSwitch(() => state.current, close, () => busy.value || editBusy.value)
const choices = computed(() => (state.snapshot && item.value ? folderChoices(state.snapshot, item.value.folderId) : []))

async function move(folderId: Id | null): Promise<void> {
  const target = item.value
  if (!target || busy.value || state.readOnly) return
  busy.value = true
  try {
    await workspace.apply({ type: 'item.update', id: target.id, folderId })
    close()
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    busy.value = false
  }
}

async function archive(): Promise<void> {
  const target = item.value
  if (!target || busy.value) return
  // Decided before the archive, while the item is still in the snapshot: the open card of this very item has to go.
  const leave = route.name === 'item-id' && route.params.id === target.id
  busy.value = true
  let archived = false
  try {
    await workspace.apply({ type: 'archive', target: 'item', id: target.id, archiveId: ids.archiveId })
    archived = true
    close()
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    busy.value = false
  }
  if (archived && leave) await router.push(target.folderId === null ? '/' : `/folder/${target.folderId}`)
}
</script>

<template>
  <AppSheet v-model:open="editOpen" :title="$t('itemMenu.editTitle')" :locked="editBusy || busy" initial-focus="#item-name">
    <ItemForm v-if="item && shown?.kind === 'edit'" :key="item.id" v-model:busy="editBusy" :item="item" @done="close" />
  </AppSheet>
  <AppSheet v-model:open="moveOpen" :title="$t('itemMenu.moveTitle')" :description="$t('itemMenu.moveHint')" :locked="busy">
    <FolderPickerList v-if="item" :choices="choices" disable-current :aria-label="$t('itemMenu.moveTitle')" @select="move" />
  </AppSheet>
  <ConfirmSheet
    v-model:open="archiveOpen"
    :title="$t('itemMenu.archiveTitle')"
    :description="$t('itemMenu.archiveConfirm', { name: item?.name ?? '' })"
    :confirm-label="$t(busy ? 'status.saving' : 'itemMenu.archive')"
    :busy="busy"
    destructive
    @confirm="archive"
  />
</template>

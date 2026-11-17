<script setup lang="ts">
import { Package } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { errorMessageKey } from '~/lib/errors'
import { iconFrom } from '~/lib/item-icons'
import { colorVars, itemColor } from '~/lib/item-colors'

// The item's icon before its name in the header, in the item's colour, like a file type icon before a file name in an
// editor: so the colour and the icon show even when a photo covers the thumbnail. Its own icon, else its folder's, else
// the general item icon (no letters here: they would read as part of the name). A tap picks the item's own icon.
const props = defineProps<{ id: string; icon: string | null; folderIcon: string | null; color: string | null }>()
const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace
const iconSet = useItemIconSet()
const shown = computed(() => iconFrom(iconSet.value, props.icon) ?? iconFrom(iconSet.value, props.folderIcon) ?? Package)
const vars = computed(() => colorVars(itemColor({ id: props.id, color: props.color })))
const picking = ref(false)

async function save(icon: string | null): Promise<void> {
  if (state.readOnly || state.saving) {
    toast.error(t(state.readOnly ? 'errors.storage.read_only' : 'photos.busy'))
    return
  }
  try {
    await workspace.apply({ type: 'item.update', id: props.id, icon })
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}
</script>

<template>
  <button
    v-if="!state.readOnly"
    type="button"
    class="pressable colored mr-1 -ml-2 -my-3 inline-flex size-11 items-center justify-center rounded-chip align-middle text-(--c)"
    :style="vars"
    :aria-label="$t('iconPicker.choose')"
    @click="picking = true"
  >
    <component :is="shown" class="size-6" stroke-width="2" aria-hidden="true" />
  </button>
  <component :is="shown" v-else class="colored mr-2 inline-block size-6 align-[-0.15em] text-(--c)" :style="vars" stroke-width="2" aria-hidden="true" />
  <IconPicker v-model:open="picking" :current="icon" @pick="save" />
</template>

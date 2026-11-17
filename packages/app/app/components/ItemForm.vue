<script setup lang="ts">
import { itemNameTaken, type Id, type Item } from '@antresol/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { unitChoices } from '~/lib/amounts'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { errorMessageKey } from '~/lib/errors'
import { defaultItemColor } from '~/lib/item-colors'

// Reads the item's values once: the dialog gives every item its own form (key).
const props = defineProps<{ item: Item }>()
const emit = defineEmits<{ done: [] }>()

const workspace = useWorkspace()
const { ids, renew } = useCommandIds(['tagId'])
const { state } = workspace

const name = ref(props.item.name)
const description = ref(props.item.description ?? '')
const unitKey = ref(props.item.unitKey)
const tagIds = ref<Id[]>([...props.item.tagIds])
const icon = ref<string | null>(props.item.icon)
const color = ref<string | null>(props.item.color)
const shownColor = computed(() => color.value ?? defaultItemColor(props.item.id))
const pickingIcon = ref(false)
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)

const snapshot = computed(() => state.snapshot)
const units = computed(() => (snapshot.value ? unitChoices(snapshot.value) : []))
const locked = computed(() => busy.value || !!state.readOnly)
// Only what differs from the item as it was opened is sent: a stale form must not revert another device's edit.
const baseline = captureBaseline({
  name: props.item.name,
  description: props.item.description,
  unitKey: props.item.unitKey,
  tagIds: props.item.tagIds,
  icon: props.item.icon,
  color: props.item.color,
})
const changes = computed(() =>
  changedFields(
    baseline,
    { name: name.value.trim(), description: description.value.trim() || null, unitKey: unitKey.value, tagIds: tagIds.value, icon: icon.value, color: color.value },
  ),
)
// A renamed item must not take a name of its folder (archived twins included); a name left as it was is not checked.
const taken = computed(() => {
  const n = name.value.trim()
  if (!snapshot.value || !n || changes.value.name === undefined) return null
  return itemNameTaken(snapshot.value, props.item.folderId, n, props.item.id)
})
const canSubmit = computed(() => !locked.value && !!snapshot.value && !taken.value && Object.keys(changes.value).length > 0)

async function createTag(tagName: string): Promise<void> {
  const s = snapshot.value
  if (!s || locked.value) return
  busy.value = true
  errorKey.value = null
  try {
    const id = ids.tagId
    await workspace.apply({ type: 'tag.create', id, inventoryId: s.inventory.id, name: tagName })
    tagIds.value = [...tagIds.value, id]
    renew()
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply({
      type: 'item.update',
      id: props.item.id,
      ...changes.value,
    })
    emit('done')
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="grid gap-4" novalidate @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="item-name">{{ $t('form.name') }}</Label>
      <Input id="item-name" v-model="name" autocomplete="off" :aria-invalid="errorKey ? true : undefined" aria-describedby="item-name-taken item-form-error" class="h-11" />
      <NameTakenNote id="item-name-taken" :taken="taken" :name="name" />
    </div>
    <div class="grid gap-2">
      <Label for="item-description">
        {{ $t('form.description') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <Textarea id="item-description" v-model="description" rows="3" class="min-h-20" />
    </div>
    <div class="grid gap-2">
      <Label for="item-unit">{{ $t('itemForm.unit') }}</Label>
      <Select v-model="unitKey">
        <SelectTrigger id="item-unit" class="h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="u in units" :key="u.key" :value="u.key">{{ u.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <IconField v-model:picking="pickingIcon" :icon="icon" :color="shownColor" :disabled="locked" @pick="icon = $event" />
    <ColorSwatches v-model="color" :auto="defaultItemColor(item.id)" :label="$t('colors.label')" :disabled="locked" />
    <div v-if="snapshot" class="grid gap-2">
      <Label>{{ $t('itemForm.tags') }}</Label>
      <TagPicker v-model="tagIds" :snapshot="snapshot" :locked="locked" @create="createTag" />
    </div>
    <p id="item-form-error" role="alert" class="field-text text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : 'itemForm.save') }}
    </Button>
  </form>
</template>

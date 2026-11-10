<script setup lang="ts">
import { newId, type Id, type Item } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { unitChoices } from '~/lib/amounts'
import { errorMessageKey } from '~/lib/errors'

// Reads the item's values once: the dialog gives every item its own form (key).
const props = defineProps<{ item: Item }>()
const emit = defineEmits<{ done: [] }>()

const workspace = useWorkspace()
const { state } = workspace

const name = ref(props.item.name)
const description = ref(props.item.description ?? '')
const unitKey = ref(props.item.unitKey)
const tagIds = ref<Id[]>([...props.item.tagIds])
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)

const snapshot = computed(() => state.snapshot)
const units = computed(() => (snapshot.value ? unitChoices(snapshot.value) : []))
const locked = computed(() => busy.value || !!state.readOnly)
const canSubmit = computed(() => !locked.value && !!snapshot.value)

async function createTag(tagName: string): Promise<void> {
  const s = snapshot.value
  if (!s || locked.value) return
  busy.value = true
  errorKey.value = null
  try {
    const id = newId()
    await workspace.apply({ type: 'tag.create', id, inventoryId: s.inventory.id, name: tagName })
    tagIds.value = [...tagIds.value, id]
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
      name: name.value.trim(),
      description: description.value.trim() || null,
      unitKey: unitKey.value,
      tagIds: tagIds.value,
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
  <form class="grid gap-3.5" novalidate @submit.prevent="submit">
    <div class="grid gap-1.5">
      <Label for="item-name">{{ $t('form.name') }}</Label>
      <Input id="item-name" v-model="name" autocomplete="off" :aria-invalid="errorKey ? true : undefined" aria-describedby="item-form-error" class="h-11 rounded-field bg-surface" />
    </div>
    <div class="grid gap-1.5">
      <Label for="item-description">
        {{ $t('form.description') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <Textarea id="item-description" v-model="description" rows="3" class="min-h-20 rounded-field bg-surface" />
    </div>
    <div class="grid gap-1.5">
      <Label for="item-unit">{{ $t('itemForm.unit') }}</Label>
      <Select v-model="unitKey">
        <SelectTrigger id="item-unit" class="h-11 w-full rounded-field bg-surface">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="u in units" :key="u.key" :value="u.key">{{ u.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div v-if="snapshot" class="grid gap-1.5">
      <Label>{{ $t('itemForm.tags') }}</Label>
      <TagPicker v-model="tagIds" :snapshot="snapshot" :locked="locked" @create="createTag" />
    </div>
    <p id="item-form-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : 'itemForm.save') }}
    </Button>
  </form>
</template>

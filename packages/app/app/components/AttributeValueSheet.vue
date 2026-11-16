<script setup lang="ts">
import type { Id } from '@antresol/core'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessageKey } from '~/lib/errors'
import { attributeChoices, type ItemView } from '~/lib/item-view'

// Gives an item a shared attribute (picking one or making a new one) or edits its value. Variants' own values are edited
// with the variant.
const props = defineProps<{ view: ItemView; open: boolean; attributeId: Id | null }>()
const emit = defineEmits<{ close: [] }>()

const NEW = '\u0000new'
const workspace = useWorkspace()
const { state } = workspace

const open = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})

const choices = computed(() => (state.snapshot ? attributeChoices(state.snapshot, props.view.item.id) : []))

const choice = ref('')
const value = ref<string | null>(null)
const inputError = ref<string | null>(null)
const formBusy = ref(false)
const saving = ref(false)
const errorKey = ref<string | null>(null)
const locked = computed(() => saving.value || formBusy.value)

const attribute = computed(() => state.snapshot?.attributes.find((a) => a.id === choice.value) ?? null)
const adding = computed(() => props.attributeId === null)
const creating = computed(() => choice.value === NEW)

function load(): void {
  errorKey.value = null
  const id = props.attributeId
  choice.value = id ?? choices.value[0]?.id ?? NEW
  const row = id ? props.view.attributes.find((a) => a.attributeId === id) : undefined
  value.value = row?.value ?? null
  inputError.value = null
}
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) load()
  },
  { immediate: true },
)
// Picking another attribute starts its values over.
watch(choice, (id, was) => {
  if (!was || id === was || !adding.value) return
  value.value = null
  inputError.value = null
})

// Cancelling the new-attribute form goes back to the first existing attribute; focus returns to the select.
async function cancelNew(): Promise<void> {
  choice.value = choices.value[0]?.id ?? ''
  await nextTick()
  document.getElementById('attribute-choice')?.focus()
}

function created(id: Id): void {
  // The new attribute is in the list now (the snapshot reloaded before the form said done).
  choice.value = id
}

const canSave = computed(() => !locked.value && !state.readOnly && !!attribute.value && !creating.value && !inputError.value)

async function save(): Promise<void> {
  const a = attribute.value
  if (!canSave.value || !a) return
  saving.value = true
  errorKey.value = null
  try {
    await workspace.apply({ type: 'item.setAttribute', itemId: props.view.item.id, attributeId: a.id, value: value.value })
    emit('close')
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppSheet
    v-model:open="open"
    :title="adding ? $t('attributeSheet.addTitle') : $t('attributeSheet.editTitle', { name: attribute?.name ?? '' })"
    :locked="locked"
  >
    <div class="mt-4 grid gap-4">
      <div v-if="adding" class="grid gap-2">
        <Label for="attribute-choice">{{ $t('attributeSheet.attribute') }}</Label>
        <Select v-model="choice" :disabled="locked">
          <SelectTrigger id="attribute-choice" class="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="a in choices" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
            <SelectItem :value="NEW">{{ $t('attributeSheet.newAttribute') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <InlineCreate
        v-if="creating"
        :title="$t('attributeSheet.newTitle')"
        :close-label="$t('attributeSheet.cancelNew')"
        :busy="formBusy"
        @cancel="cancelNew"
      >
        <AttributeForm v-model:busy="formBusy" :attribute="null" @done="created" />
      </InlineCreate>
      <template v-else-if="attribute">
        <div class="grid gap-2">
          <Label for="attribute-value">{{ $t('attributeSheet.value') }}</Label>
          <AttributeValueField
            id="attribute-value"
            :key="choice"
            v-model="value"
            :attribute="attribute"
            :disabled="locked"
            @update:error="(key) => (inputError = key)"
          />
        </div>
        <p v-if="inputError" class="field-text text-sm text-destructive">{{ $t(inputError) }}</p>
        <p role="alert" class="field-text text-sm text-destructive">
          <template v-if="errorKey">{{ $t(errorKey) }}</template>
        </p>
      </template>
    </div>
    <template v-if="!creating" #footer>
      <Button type="button" data-primary class="h-11 rounded-field" :disabled="!canSave" @click="save">
        {{ $t(saving ? 'status.saving' : 'attributeSheet.save') }}
      </Button>
    </template>
  </AppSheet>
</template>

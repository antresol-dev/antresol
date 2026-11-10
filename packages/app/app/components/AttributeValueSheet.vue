<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { errorMessageKey } from '~/lib/errors'
import { attributeChoices, attributeWrites, type ItemView } from '~/lib/item-view'

// Gives an item an attribute (picking one or making a new one) or edits its value: one value for the item, or one per variant.
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

const variants = computed(() => props.view.buckets.flatMap((b) => (b.variantId !== null && b.name !== null ? [{ id: b.variantId, name: b.name }] : [])))
const hasVariants = computed(() => variants.value.length > 0)
const choices = computed(() => (state.snapshot ? attributeChoices(state.snapshot, props.view.item.id) : []))

const choice = ref('')
const shared = ref('')
const perVariant = ref(false)
const values = ref<Record<string, string>>({})
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
  shared.value = row?.value ?? ''
  perVariant.value = row?.perVariant ?? false
  loadVariantValues()
}
function loadVariantValues(): void {
  const snapshot = state.snapshot
  const found: Record<string, string> = {}
  for (const v of variants.value) {
    found[v.id] = snapshot?.variantAttributeValues.find((x) => x.variantId === v.id && x.attributeId === choice.value)?.value ?? ''
  }
  values.value = found
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
  shared.value = ''
  perVariant.value = false
  loadVariantValues()
})

function created(id: Id): void {
  // The new attribute is in the list now (the snapshot reloaded before the form said done).
  choice.value = id
}

const canSave = computed(() => !locked.value && !state.readOnly && !!attribute.value && !creating.value)

async function save(): Promise<void> {
  const a = attribute.value
  if (!canSave.value || !a) return
  saving.value = true
  errorKey.value = null
  try {
    const snapshot = state.snapshot
    if (!snapshot) return
    const input = perVariant.value && hasVariants.value ? { variants: values.value } : { shared: shared.value }
    for (const command of attributeWrites(snapshot, props.view.item.id, a.id, input)) await workspace.apply(command)
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
    <div class="mt-3.5 grid gap-3.5">
      <div v-if="adding" class="grid gap-1.5">
        <Label for="attribute-choice">{{ $t('attributeSheet.attribute') }}</Label>
        <Select v-model="choice" :disabled="locked">
          <SelectTrigger id="attribute-choice" class="h-11 w-full rounded-field bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="a in choices" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
            <SelectItem :value="NEW">{{ $t('attributeSheet.newAttribute') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <AttributeForm v-if="creating" v-model:busy="formBusy" :attribute="null" @done="created" />
      <template v-else-if="attribute">
        <label v-if="hasVariants" class="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
          {{ $t('item.differsByVariant') }}
          <Switch v-model="perVariant" :disabled="locked" />
        </label>
        <template v-if="perVariant && hasVariants">
          <AttributeValueField
            v-for="v in variants"
            :id="`attribute-value-${v.id}`"
            :key="v.id"
            v-model="values[v.id]!"
            :label="v.name"
            :kind="attribute.kind"
            :options="attribute.options"
            :disabled="locked"
          />
        </template>
        <AttributeValueField
          v-else
          id="attribute-value"
          v-model="shared"
          :label="$t('attributeSheet.value')"
          :kind="attribute.kind"
          :options="attribute.options"
          :disabled="locked"
        />
        <p role="alert" class="text-sm text-destructive">
          <template v-if="errorKey">{{ $t(errorKey) }}</template>
        </p>
      </template>
    </div>
    <template v-if="!creating" #footer>
      <Button type="button" class="h-11 rounded-field" :disabled="!canSave" @click="save">
        {{ $t(saving ? 'status.saving' : 'attributeSheet.save') }}
      </Button>
    </template>
  </AppSheet>
</template>

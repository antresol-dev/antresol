<script setup lang="ts">
import { itemAxes, type Id, type Variant } from '@antresol/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { variantClash } from '~/lib/axes'
import { errorMessageKey } from '~/lib/errors'
import { setValuesCommand } from '~/lib/variant-commands'

// A variant is its values on the item's axes, plus a description.
const props = defineProps<{ variant: Variant }>()
const emit = defineEmits<{ done: [] }>()

const workspace = useWorkspace()
const { state } = workspace

const axes = computed(() => (state.snapshot ? itemAxes(state.snapshot, props.variant.itemId) : []))
const stored = (attributeId: Id): string | null => {
  const raw = state.snapshot?.variantAttributeValues.find((v) => v.variantId === props.variant.id && v.attributeId === attributeId)?.value
  return raw == null || raw.trim() === '' ? null : raw
}

const values = ref<Record<Id, string | null>>(Object.fromEntries(axes.value.map((a) => [a.id, stored(a.id)])))
const fieldErrors = ref<Record<Id, string | null>>({})
const description = ref(props.variant.description ?? '')
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)
// Only what differs from the variant as it was opened is sent: a stale form must not revert another device's edit.
const valueBaseline = captureBaseline(Object.fromEntries(axes.value.map((a) => [a.id, stored(a.id)])))
const descriptionBaseline = captureBaseline({ description: props.variant.description })
const changedValues = computed(() => changedFields(valueBaseline, { ...values.value }))
const changedDescription = computed(() => changedFields(descriptionBaseline, { description: description.value.trim() || null }))
const hasChanges = computed(() => Object.keys(changedValues.value).length > 0 || Object.keys(changedDescription.value).length > 0)
const hasFieldError = computed(() => Object.values(fieldErrors.value).some((e) => e))
// The values as they would be saved already belong to another variant (an archived one can be restored instead, §4.7).
const clash = computed(() =>
  state.snapshot && Object.keys(changedValues.value).length > 0 && !hasFieldError.value
    ? variantClash(state.snapshot, props.variant.itemId, values.value, props.variant.id)
    : null,
)
const canSubmit = computed(() => !busy.value && !state.readOnly && hasChanges.value && !hasFieldError.value && !clash.value)

async function restore(archiveId: Id): Promise<void> {
  if (busy.value || state.readOnly) return
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply({ type: 'restore', archiveId })
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
    const command = setValuesCommand(props.variant.itemId, [
      { variantId: props.variant.id, values: Object.fromEntries(Object.entries(changedValues.value).map(([k, v]) => [k, v ?? null])) },
    ])
    if (command) await workspace.apply(command)
    if (Object.keys(changedDescription.value).length > 0) {
      await workspace.apply({ type: 'variant.update', id: props.variant.id, ...changedDescription.value })
    }
    emit('done')
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="mt-3.5 grid gap-3.5" novalidate @submit.prevent="submit">
    <div v-for="a in axes" :key="a.id" class="grid gap-1.5">
      <Label :for="`variant-axis-${a.id}`">{{ a.name }}</Label>
      <AttributeValueField
        :id="`variant-axis-${a.id}`"
        v-model="values[a.id]!"
        :attribute="a"
        :disabled="busy"
        @update:error="(key) => (fieldErrors[a.id] = key)"
      />
      <p v-if="fieldErrors[a.id]" role="alert" class="text-sm text-destructive">{{ $t(fieldErrors[a.id]!) }}</p>
    </div>
    <div class="grid gap-1.5">
      <Label for="variant-description">
        {{ $t('variantForm.description') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <Input id="variant-description" v-model="description" autocomplete="off" class="h-11" />
    </div>
    <p v-if="clash" role="alert" class="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive">
      {{ $t(clash.archived ? 'variantForm.inArchive' : 'variantForm.exists') }}
      <Button
        v-if="clash.archived && clash.archiveId"
        type="button"
        variant="outline"
        size="sm"
        class="h-9 rounded-field"
        :disabled="busy || !!state.readOnly"
        @click="restore(clash.archiveId)"
      >
        {{ $t('variantForm.restore') }}
      </Button>
    </p>
    <p id="variant-form-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : 'variantForm.save') }}
    </Button>
  </form>
</template>

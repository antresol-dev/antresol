<script setup lang="ts">
import { formatNumberValue, type Attribute } from '@graymatter/core'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseAttributeInput } from '~/lib/attribute-values'

// A value of an attribute by its kind: free text, one of the options of a list (or none), or a number typed the way
// the attribute reads it. Emits the stored value, null when empty; a text that does not parse emits an error key
// and leaves the value as it was. The label belongs to the caller.
const props = defineProps<{
  attribute: Pick<Attribute, 'kind' | 'options' | 'unit' | 'siPrefixes'>
  modelValue: string | null
  id?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null]; 'update:error': [key: string | null] }>()

// A Select item can't have an empty value.
const NONE = '\u0000none'

const shownValue = (value: string | null): string =>
  value === null ? '' : props.attribute.kind === 'number' ? formatNumberValue(value, props.attribute) : value
const text = ref(shownValue(props.modelValue))
// The value the typed text stands for; an outside change of modelValue replaces the text, our own emit does not.
let own: string | null = props.modelValue
watch(
  () => props.modelValue,
  (value) => {
    if (value === own) return
    own = value
    text.value = shownValue(value)
  },
)

const parsed = computed(() => (text.value.trim() === '' ? null : parseAttributeInput(props.attribute, text.value)))
const hint = computed(() => {
  const p = parsed.value
  return props.attribute.kind === 'number' && p && 'value' in p ? formatNumberValue(p.value, props.attribute) : null
})

function onInput(raw: string | number): void {
  text.value = String(raw)
  const p = parsed.value
  if (p === null) {
    own = null
    emit('update:error', null)
    emit('update:modelValue', null)
  } else if ('value' in p) {
    own = p.value
    emit('update:error', null)
    emit('update:modelValue', p.value)
  } else {
    emit('update:error', `errors.domain.${p.error}`)
  }
}

function onSelect(value: unknown): void {
  const next = value === NONE ? null : String(value)
  own = next
  emit('update:error', null)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="grid gap-1.5">
    <Select v-if="attribute.kind === 'enum'" :model-value="modelValue ?? NONE" :disabled="disabled" @update:model-value="onSelect">
      <SelectTrigger :id="id" class="h-11 w-full">
        <!-- The dash reads as "em dash": screen readers get "No value" instead. -->
        <SelectValue v-slot="{ selectedLabel, modelValue: shown }">
          <template v-if="shown === NONE">
            <span aria-hidden="true">{{ $t('item.noValue') }}</span>
            <span class="sr-only">{{ $t('item.noValueLabel') }}</span>
          </template>
          <template v-else>{{ selectedLabel.join(', ') }}</template>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="NONE" :text-value="$t('item.noValueLabel')">
          <span aria-hidden="true">{{ $t('item.noValue') }}</span>
          <span class="sr-only">{{ $t('item.noValueLabel') }}</span>
        </SelectItem>
        <SelectItem v-for="o in attribute.options" :key="o" :value="o">{{ o }}</SelectItem>
      </SelectContent>
    </Select>
    <template v-else>
      <Input
        :id="id"
        :model-value="text"
        autocomplete="off"
        :autocapitalize="attribute.kind === 'number' ? 'off' : undefined"
        :autocorrect="attribute.kind === 'number' ? 'off' : undefined"
        :spellcheck="attribute.kind === 'number' ? false : undefined"
        :disabled="disabled"
        class="h-11"
        @update:model-value="onInput"
      />
      <p v-if="hint !== null" class="text-xs text-muted-foreground">{{ $t('item.numberHint', { value: hint }) }}</p>
    </template>
  </div>
</template>

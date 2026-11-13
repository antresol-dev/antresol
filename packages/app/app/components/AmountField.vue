<script setup lang="ts">
import type { UnitDef } from '@antresol/core'
import { amountPreview, amountTextOnly } from '~/lib/amounts'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// An amount as text ("10", "50cm") with its unit: a choice when there are several units, otherwise the symbol at the
// right edge of the field.
const props = defineProps<{ units: UnitDef[]; id?: string; invalid?: boolean }>()
const text = defineModel<string>({ required: true })
const unitKey = defineModel<string>('unitKey', { required: true })

const unit = computed(() => props.units.find((u) => u.key === unitKey.value) ?? props.units[0])
const preview = computed(() => (unit.value ? amountPreview(text.value, unit.value) : null))

// Typing or pasting keeps only what an amount in this unit can hold (digits, signs, the unit's own letters): "asda" never
// lands in the field. Whether the rest reads as an amount is still the form's check.
function onBeforeInput(e: InputEvent): void {
  const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? null
  if (!data || !unit.value) return
  const kept = amountTextOnly(data, unit.value)
  if (kept === data) return
  e.preventDefault()
  if (kept === '') return
  const el = e.target as HTMLInputElement
  el.setRangeText(kept, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end')
  text.value = el.value
}
const single = computed(() => (props.units.length === 1 ? props.units[0]! : null))
</script>

<template>
  <div class="grid gap-1.5">
  <div class="flex gap-2">
    <div class="relative min-w-0 flex-1">
      <Input
        :id="id"
        v-model="text"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        @beforeinput="onBeforeInput"
        :aria-invalid="invalid ? true : undefined"
        class="h-11"
        :class="single ? 'pr-14' : ''"
      />
      <span
        v-if="single"
        class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-muted-foreground"
      >
        {{ single.symbol }}
      </span>
    </div>
    <Select v-if="!single" v-model="unitKey">
      <SelectTrigger :aria-label="$t('quickAdd.unit')" class="h-11 w-32 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="u in units" :key="u.key" :value="u.key">{{ u.name }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
  <ExpressionHint :preview="preview" />
  </div>
</template>

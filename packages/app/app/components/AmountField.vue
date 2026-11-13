<script setup lang="ts">
import type { UnitDef } from '@antresol/core'
import { amountDraftOk, amountPreview } from '~/lib/amounts'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// An amount as text ("10", "50cm") with its unit: a choice when there are several units, otherwise the symbol at the
// right edge of the field.
const props = defineProps<{ units: UnitDef[]; id?: string; invalid?: boolean }>()
const text = defineModel<string>({ required: true })
const unitKey = defineModel<string>('unitKey', { required: true })

const unit = computed(() => props.units.find((u) => u.key === unitKey.value) ?? props.units[0])
const preview = computed(() => (unit.value ? amountPreview(text.value, unit.value) : null))
const single = computed(() => (props.units.length === 1 ? props.units[0]! : null))

// Typing or pasting is refused when the field would stop being (the start of) an amount in this unit: only numbers,
// expression signs and the unit's prefixes right after a number get in (the symbol shows at the edge). A pasted amount
// that ends in the unit symbol ("100 pcs") goes in without it. Deleting is never refused.
function onBeforeInput(e: InputEvent): void {
  const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? null
  const u = unit.value
  if (!data || !u) return
  const el = e.target as HTMLInputElement
  const from = el.selectionStart ?? el.value.length
  const to = el.selectionEnd ?? el.value.length
  const next = (insert: string) => el.value.slice(0, from) + insert + el.value.slice(to)
  if (amountDraftOk(next(data), u)) return
  e.preventDefault()
  const bare = data.trimEnd().endsWith(u.symbol) ? data.trimEnd().slice(0, -u.symbol.length).trimEnd() : null
  if (bare && amountDraftOk(next(bare), u)) {
    el.setRangeText(bare, from, to, 'end')
    text.value = el.value
  }
}
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

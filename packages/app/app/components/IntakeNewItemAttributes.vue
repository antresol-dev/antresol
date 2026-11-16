<script setup lang="ts">
import type { DraftNewItem, Id, InventorySnapshot } from '@antresol/core'
import { X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { attributesFrom } from '~/lib/intake-line'
import { byName } from '~/lib/views'

// The attributes of a new item of an intake (spec 2026-11-13 intakes §6, state 4): shared values typed by hand, and
// which of them the variants differ by (an axis: its value goes on each line). A new attribute is created for the
// inventory at once, as on an item card.
const props = defineProps<{
  snapshot: InventorySnapshot
  disabled?: boolean
  /** A similar item whose attributes the new one can start from. */
  similar: { itemId: Id; name: string } | null
}>()
const attributes = defineModel<DraftNewItem['attributes']>({ required: true })
const emit = defineEmits<{ 'update:error': [key: string | null] }>()

const NEW = '\u0000new'
const choice = ref('')
const creating = ref(false)
const formBusy = ref(false)

const known = computed(() => new Map(props.snapshot.attributes.map((a) => [a.id, a] as const)))
const rows = computed(() => attributes.value.flatMap((x) => {
  const a = known.value.get(x.attributeId)
  return a ? [{ ...x, attribute: a }] : []
}))
const choices = computed(() => props.snapshot.attributes.filter((a) => !attributes.value.some((x) => x.attributeId === a.id)).sort(byName))
const similarAttributes = computed(() => (props.similar ? attributesFrom(props.snapshot, props.similar.itemId) : []))

/** Why a shared value field's text does not read, per attribute; the first one shown goes to the sheet. A field that
 *  goes away (the attribute removed or made an axis, the section closed) takes its error with it. */
const errors = ref<Record<Id, string>>({})
const shownError = computed(() => {
  const row = rows.value.find((r) => !r.axis && errors.value[r.attributeId])
  return row ? errors.value[row.attributeId]! : null
})
watch(shownError, (key) => emit('update:error', key), { immediate: true })
onBeforeUnmount(() => emit('update:error', null))
function setError(attributeId: Id, key: string | null): void {
  const { [attributeId]: _gone, ...rest } = errors.value
  errors.value = key ? { ...rest, [attributeId]: key } : rest
}

function update(attributeId: Id, change: Partial<DraftNewItem['attributes'][number]>): void {
  if (change.axis !== undefined) setError(attributeId, null)
  attributes.value = attributes.value.map((x) => (x.attributeId === attributeId ? { ...x, ...change } : x))
}
function remove(attributeId: Id): void {
  setError(attributeId, null)
  attributes.value = attributes.value.filter((x) => x.attributeId !== attributeId)
}
function add(id: unknown): void {
  const value = String(id)
  if (value === NEW) {
    creating.value = true
    return
  }
  if (!known.value.has(value)) return
  attributes.value = [...attributes.value, { attributeId: value, value: null, axis: false }]
  choice.value = ''
}
function created(id: Id): void {
  creating.value = false
  attributes.value = [...attributes.value, { attributeId: id, value: null, axis: false }]
}
</script>

<template>
  <div class="grid gap-3">
    <Button
      v-if="attributes.length === 0 && similar && similarAttributes.length > 0"
      type="button"
      variant="outline"
      class="h-11 justify-start"
      :disabled="disabled"
      @click="attributes = similarAttributes"
    >
      {{ $t('intakes.line.copyAttributes', { name: similar.name }) }}
    </Button>

    <ul v-if="rows.length > 0" class="grid gap-3">
      <li v-for="row in rows" :key="row.attributeId" class="grid gap-2">
        <div class="flex min-h-11 items-center gap-2">
          <Label :for="`intake-attr-${row.attributeId}`" class="min-w-0 flex-1 truncate">{{ row.attribute.name }}</Label>
          <label class="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            {{ $t('intakes.line.axis') }}
            <Switch :model-value="row.axis" :disabled="disabled" @update:model-value="update(row.attributeId, { axis: !!$event, value: null })" />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-11 shrink-0"
            :aria-label="$t('intakes.line.removeAttribute', { name: row.attribute.name })"
            :disabled="disabled"
            @click="remove(row.attributeId)"
          >
            <X class="size-4" aria-hidden="true" />
          </Button>
        </div>
        <AttributeValueField
          v-if="!row.axis"
          :id="`intake-attr-${row.attributeId}`"
          :attribute="row.attribute"
          :model-value="row.value"
          :disabled="disabled"
          @update:model-value="update(row.attributeId, { value: $event })"
          @update:error="setError(row.attributeId, $event)"
        />
        <p v-if="!row.axis && errors[row.attributeId]" class="text-sm text-destructive">{{ $t(errors[row.attributeId]!) }}</p>
      </li>
    </ul>

    <AttributeForm v-if="creating" v-model:busy="formBusy" :attribute="null" @done="created" />
    <div v-else class="grid gap-2">
      <Select :model-value="choice" :disabled="disabled" @update:model-value="add">
        <SelectTrigger :aria-label="$t('intakes.line.addAttribute')" class="h-11 w-full">
          <SelectValue :placeholder="$t('intakes.line.addAttribute')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="a in choices" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
          <SelectItem :value="NEW">{{ $t('attributeSheet.newAttribute') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>

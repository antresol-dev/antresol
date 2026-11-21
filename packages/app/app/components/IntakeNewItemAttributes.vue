<script setup lang="ts">
import { intakeAttributes, type DraftNewAttribute, type DraftNewItem, type Id, type IntakeDraftContent, type InventorySnapshot } from '@antresol/core'
import { X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { nameClash, withNewAttribute } from '~/lib/intake-draft'
import { attributesFrom } from '~/lib/intake-line'
import { similarAttributes as similarNamesOf } from '~/lib/intake-parts'
import { byName } from '~/lib/views'

// The attributes of a new item of an intake (spec 2026-11-13 intakes §6, state 4): shared values typed by hand, and
// which of them the variants differ by (an axis: its value goes on each line). A new attribute is a draft attribute
// (spec 2026-11-16 §4) created by the commit. One made here is held by the sheet (`held`) and written into the draft
// only together with the line; `content` already shows it next to the draft's own and the inventory's, marked new.
const props = defineProps<{
  snapshot: InventorySnapshot
  content: IntakeDraftContent
  disabled?: boolean
  /** A similar item whose attributes the new one can start from. */
  similar: { itemId: Id; name: string } | null
}>()
const attributes = defineModel<DraftNewItem['attributes']>({ required: true })
/** New attributes made in this form, not in the draft yet. */
const held = defineModel<DraftNewAttribute[]>('held', { required: true })
const emit = defineEmits<{ 'update:error': [key: string | null] }>()

const NEW = '\u0000new'
const choice = ref('')
const creating = ref(false)

const { t } = useI18n()
const known = computed(() => intakeAttributes(props.content, props.snapshot))
const isDraft = (id: Id): boolean => (props.content.newAttributes ?? []).some((a) => a.id === id)
const rows = computed(() => attributes.value.flatMap((x) => {
  const a = known.value.get(x.attributeId)
  return a ? [{ ...x, attribute: a }] : []
}))
const choices = computed(() =>
  [...known.value.values()]
    .filter((a) => !attributes.value.some((x) => x.attributeId === a.id))
    .sort(byName)
    .map((a) => ({ id: a.id, name: a.name, draft: isDraft(a.id) })),
)
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
const addTrigger = ref<{ $el?: HTMLElement } | null>(null)
async function cancelNew(): Promise<void> {
  creating.value = false
  await nextTick()
  const el = addTrigger.value?.$el
  el?.focus()
}
function addId(id: Id): void {
  if (attributes.value.some((x) => x.attributeId === id)) return
  attributes.value = [...attributes.value, { attributeId: id, value: null, axis: false }]
}
/** What the typed name is already called: the inventory's attribute or one of this draft. */
function clash(name: string): { id: Id; name: string } | null {
  if (name.trim() === '') return null
  const hit = nameClash(props.snapshot, props.content, { kind: 'attribute', name })
  return hit ? { id: hit.id, name: known.value.get(hit.id)?.name ?? name.trim() } : null
}
/** The draft attributes already shown in lists count against the limit with the inventory's. */
const draftPinned = computed(() => (props.content.newAttributes ?? []).filter((a) => a.pinned).length)
const similarAttribute = (name: string) => similarNamesOf(props.snapshot, props.content, name)
const createError = ref<string | null>(null)
async function createdDraft(a: DraftNewAttribute): Promise<void> {
  const next = withNewAttribute(props.content, props.snapshot, a)
  if ('errorKey' in next) {
    createError.value = t(next.errorKey, next.params ?? {})
    return
  }
  held.value = [...held.value.filter((x) => x.id !== a.id), a]
  creating.value = false
  createError.value = null
  addId(a.id)
  await focusNew(a.id)
}
/** After a new attribute joins the item the form is gone: focus goes to its row's axis switch, or to the add trigger. */
async function focusNew(id: Id): Promise<void> {
  await nextTick()
  const row = document.getElementById(`intake-attr-axis-${id}`)
  if (row) row.focus()
  else addTrigger.value?.$el?.focus()
}
async function takeExisting(id: Id): Promise<void> {
  creating.value = false
  addId(id)
  await focusNew(id)
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
          <span v-if="isDraft(row.attributeId)" class="shrink-0 rounded-chip bg-accent-soft px-1.5 py-px text-xs font-semibold tracking-[0.04em] text-accent-soft-foreground uppercase">{{ $t('intakes.tag.new') }}</span>
          <label class="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            {{ $t('intakes.line.axis') }}
            <Switch :id="`intake-attr-axis-${row.attributeId}`" :model-value="row.axis" :disabled="disabled" @update:model-value="update(row.attributeId, { axis: !!$event, value: null })" />
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

    <InlineCreate v-if="creating" :title="$t('attributeSheet.newTitle')" :close-label="$t('attributeSheet.cancelNew')"  @cancel="cancelNew">
      <AttributeForm :attribute="null" draft :clash="clash" :other-pinned="draftPinned" :similar="similarAttribute" @draft="createdDraft" @use-existing="takeExisting" />
      <p v-if="createError" role="alert" class="text-sm text-destructive">{{ createError }}</p>
    </InlineCreate>
    <div v-else class="grid gap-2">
      <Select :model-value="choice" :disabled="disabled" @update:model-value="add">
        <SelectTrigger ref="addTrigger" :aria-label="$t('intakes.line.addAttribute')" class="h-11 w-full">
          <SelectValue :placeholder="$t('intakes.line.addAttribute')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="a in choices" :key="a.id" :value="a.id">{{ a.name }}<span v-if="a.draft" class="shrink-0 rounded-chip bg-accent-soft px-1.5 py-px text-xs font-semibold tracking-[0.04em] text-accent-soft-foreground uppercase">{{ $t('intakes.tag.new') }}</span></SelectItem>
          <SelectItem :value="NEW">{{ $t('attributeSheet.newAttribute') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>

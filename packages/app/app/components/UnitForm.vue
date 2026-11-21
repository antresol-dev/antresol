<script setup lang="ts">
import { MAX_NAME_LENGTH, SI_PREFIXES, unitClash, type CustomUnit, type DraftNewUnit } from '@antresol/core'
import type { SimilarName } from '@antresol/kit/similar-names'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { errorMessageKey } from '~/lib/errors'
import { prefixNote } from '~/lib/prefixes'

// Creates a custom unit or edits one: name, symbol and the SI prefixes quantities may show with.
// `draft` (an intake's new unit, spec 2026-11-17 §6): nothing is written; the form hands the unit to the parent as
// `draft`. `unit` then is the draft unit being edited (its id is kept). `taken` tells whether a name or a symbol is a
// unit's already (built-in, the inventory's or the draft's), `similar` lists names that look like the typed one.
const props = defineProps<{
  unit: CustomUnit | DraftNewUnit | null
  draft?: boolean
  taken?: (part: { name?: string; symbol?: string }) => boolean
  similar?: (name: string) => readonly SimilarName[]
}>()
const emit = defineEmits<{ done: []; draft: [unit: DraftNewUnit] }>()

const uid = useId()
const workspace = useWorkspace()
const { ids } = useCommandIds(['unitId'])
const { state } = workspace

/** Largest power first. */
const prefixes = Object.keys(SI_PREFIXES)
  .map(Number)
  .sort((a, b) => b - a)
  .map((power) => ({ power, ...SI_PREFIXES[power]! }))

const name = ref(props.unit?.name ?? '')
const symbol = ref(props.unit?.symbol ?? '')
const powers = ref<number[]>([...(props.unit?.prefixPowers ?? [])])
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)
// Editing sends only what differs from the unit as it was opened: a stale form must not revert another device's edit.
const baseline = captureBaseline({
  name: props.unit?.name ?? '',
  symbol: props.unit?.symbol ?? '',
  prefixPowers: props.unit?.prefixPowers ?? [],
})
const changes = computed(() =>
  changedFields(baseline, {
    name: name.value.trim(),
    symbol: symbol.value.trim(),
    prefixPowers: [...powers.value].sort((a, b) => a - b),
  }),
)
// Name (no case) and symbol (with case) must be free among built-in and custom units; only a changed part is checked.
const nameTaken = computed(() => {
  const n = name.value.trim()
  if (props.draft) return n && props.taken?.({ name: n }) ? ('name' as const) : null
  if (!state.snapshot || !n || (props.unit && changes.value.name === undefined)) return null
  return unitClash(state.snapshot, { name: n }, props.unit?.id) ? ('name' as const) : null
})
/** A draft unit is checked here, before the draft takes it (a saved unit is checked by the core). */
const symbolTooLong = computed(() => props.draft === true && symbol.value.trim().length > MAX_NAME_LENGTH)
const symbolTaken = computed(() => {
  const sym = symbol.value.trim()
  if (props.draft) return sym && props.taken?.({ symbol: sym }) ? ('symbol' as const) : null
  if (!state.snapshot || !sym || (props.unit && changes.value.symbol === undefined)) return null
  return unitClash(state.snapshot, { symbol: sym }, props.unit?.id) ? ('symbol' as const) : null
})
const alike = computed(() => (props.draft && props.similar && !nameTaken.value ? props.similar(name.value) : []))
// A draft is edited on this device, so it works offline too.
const canSubmit = computed(() =>
  props.draft
    ? !busy.value && !nameTaken.value && !symbolTaken.value && !symbolTooLong.value && name.value.trim() !== '' && symbol.value.trim() !== '' && (!state.readOnly || state.readOnly === 'offline')
    : !busy.value && !nameTaken.value && !symbolTaken.value && !state.readOnly && !!state.snapshot && (!props.unit || Object.keys(changes.value).length > 0),
)

function toggle(power: number, on: boolean): void {
  powers.value = on ? [...powers.value, power] : powers.value.filter((p) => p !== power)
}

async function submit(): Promise<void> {
  if (props.draft) {
    if (!canSubmit.value) return
    emit('draft', { id: props.unit?.id ?? ids.unitId, name: name.value.trim(), symbol: symbol.value.trim(), prefixPowers: [...powers.value].sort((a, b) => a - b) })
    return
  }
  const snapshot = state.snapshot
  if (!canSubmit.value || !snapshot) return
  busy.value = true
  errorKey.value = null
  const prefixPowers = [...powers.value].sort((a, b) => a - b)
  try {
    if (props.unit) {
      await workspace.apply({
        type: 'unit.update',
        id: props.unit.id,
        ...changes.value,
      })
    } else {
      await workspace.apply({
        type: 'unit.create',
        id: ids.unitId,
        inventoryId: snapshot.inventory.id,
        name: name.value.trim(),
        symbol: symbol.value.trim(),
        prefixPowers,
      })
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
  <form class="grid gap-4" novalidate @submit.prevent="submit">
    <div class="grid gap-2">
      <Label :for="`${uid}-name`">{{ $t('form.name') }}</Label>
      <Input
        :id="`${uid}-name`"
        v-model="name"
        autocomplete="off"
        :aria-invalid="errorKey ? true : undefined"
        :aria-describedby="`${uid}-name-taken ${uid}-form-error`"
        data-field="unit-name"
        class="h-11"
      />
      <NameTakenNote :id="`${uid}-name-taken`" :taken="nameTaken" :name="name" />
      <SimilarNote :names="alike" />
    </div>
    <div class="grid gap-2">
      <Label :for="`${uid}-symbol`">{{ $t('unitForm.symbol') }}</Label>
      <Input :id="`${uid}-symbol`" v-model="symbol" autocomplete="off" :aria-invalid="symbolTooLong ? true : undefined" :aria-describedby="`${uid}-symbol-taken ${uid}-symbol-long`" class="h-11" />
      <p v-if="symbolTooLong" :id="`${uid}-symbol-long`" role="status" class="field-text text-sm text-destructive">{{ $t('intakes.unit.symbolTooLong') }}</p>
      <NameTakenNote :id="`${uid}-symbol-taken`" :taken="symbolTaken" :name="symbol" />
    </div>
    <fieldset class="grid gap-2">
      <legend class="mb-1.5 text-sm font-medium">{{ $t('unitForm.prefixes') }}</legend>
      <div class="grid max-h-56 grid-cols-2 gap-0.5 overflow-y-auto rounded-field border border-input bg-field p-1">
        <label
          v-for="p in prefixes"
          :key="p.power"
          class="flex min-h-11 cursor-pointer items-center gap-3 rounded-row px-3 text-sm transition-colors duration-(--dur-fast) hover:bg-hover"
        >
          <Checkbox :model-value="powers.includes(p.power)" @update:model-value="toggle(p.power, $event === true)" />
          {{ prefixNote(p.power) }}
        </label>
      </div>
    </fieldset>
    <p :id="`${uid}-form-error`" role="alert" class="field-text text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : unit ? 'unitForm.save' : draft ? 'intakes.unit.add' : 'unitForm.create') }}
    </Button>
  </form>
</template>

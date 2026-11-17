<script setup lang="ts">
import { SI_PREFIXES, unitClash, type CustomUnit } from '@antresol/core'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { errorMessageKey } from '~/lib/errors'
import { prefixNote } from '~/lib/prefixes'

// Creates a custom unit or edits one: name, symbol and the SI prefixes quantities may show with.
const props = defineProps<{ unit: CustomUnit | null }>()
const emit = defineEmits<{ done: [] }>()

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
  if (!state.snapshot || !n || (props.unit && changes.value.name === undefined)) return null
  return unitClash(state.snapshot, { name: n }, props.unit?.id) ? ('name' as const) : null
})
const symbolTaken = computed(() => {
  const sym = symbol.value.trim()
  if (!state.snapshot || !sym || (props.unit && changes.value.symbol === undefined)) return null
  return unitClash(state.snapshot, { symbol: sym }, props.unit?.id) ? ('symbol' as const) : null
})
const canSubmit = computed(
  () => !busy.value && !nameTaken.value && !symbolTaken.value && !state.readOnly && !!state.snapshot && (!props.unit || Object.keys(changes.value).length > 0),
)

function toggle(power: number, on: boolean): void {
  powers.value = on ? [...powers.value, power] : powers.value.filter((p) => p !== power)
}

async function submit(): Promise<void> {
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
      <Label for="unit-name">{{ $t('form.name') }}</Label>
      <Input
        id="unit-name"
        v-model="name"
        autocomplete="off"
        :aria-invalid="errorKey ? true : undefined"
        aria-describedby="unit-name-taken unit-form-error"
        class="h-11"
      />
      <NameTakenNote id="unit-name-taken" :taken="nameTaken" :name="name" />
    </div>
    <div class="grid gap-2">
      <Label for="unit-symbol">{{ $t('unitForm.symbol') }}</Label>
      <Input id="unit-symbol" v-model="symbol" autocomplete="off" aria-describedby="unit-symbol-taken" class="h-11" />
      <NameTakenNote id="unit-symbol-taken" :taken="symbolTaken" :name="symbol" />
    </div>
    <fieldset class="grid gap-2">
      <legend class="mb-1.5 text-sm font-medium">{{ $t('unitForm.prefixes') }}</legend>
      <div class="grid max-h-56 grid-cols-2 gap-0.5 overflow-y-auto rounded-field border border-input bg-field p-1">
        <label
          v-for="p in prefixes"
          :key="p.power"
          class="flex min-h-11 cursor-pointer items-center gap-3 rounded-chip px-3 text-sm transition-colors duration-(--dur-fast) hover:bg-hover"
        >
          <Checkbox :model-value="powers.includes(p.power)" @update:model-value="toggle(p.power, $event === true)" />
          {{ prefixNote(p.power) }}
        </label>
      </div>
    </fieldset>
    <p id="unit-form-error" role="alert" class="field-text text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : unit ? 'unitForm.save' : 'unitForm.create') }}
    </Button>
  </form>
</template>

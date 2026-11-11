<script setup lang="ts">
import { getCurrency, type Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { errorMessageKey } from '~/lib/errors'
import { bucketDescription, type ItemView } from '~/lib/item-view'
import { buildStockCommand, type StockMode } from '~/lib/stock-forms'

export interface StockTarget {
  mode: StockMode
  variantId: Id | null
  /** What the form starts with instead of empty fields ("Receive here" carries what quick add had). */
  prefill?: { amount?: string; price?: string; url?: string }
}

// Receive, use, set or move stock of one bucket of the item. The form resets on every opening.
const props = defineProps<{ view: ItemView; target: StockTarget | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const workspace = useWorkspace()
const { state } = workspace
const { ids, renew } = useCommandIds(['movementId', 'transferId', 'outMovementId', 'inMovementId'])

// What the sheet shows while it animates out.
const shown = shallowRef<StockTarget>({ mode: 'receive', variantId: null })
const openings = ref(0)
const amount = ref('')
const price = ref('')
const url = ref('')
const note = ref('')
const toKey = ref('')
const busy = ref(false)
const errorKey = ref<string | null>(null)

const NONE = '__none__'
const keyOf = (id: Id | null): string => id ?? NONE
const idOf = (key: string): Id | null => (key === NONE ? null : key)

// Where stock can go: every bucket but the source, the no-variant one included.
const destinations = computed(() => {
  const rows = props.view.buckets
    .filter((b) => b.variantId !== shown.value.variantId)
    .map((b) => ({ key: keyOf(b.variantId), name: b.name ?? '' }))
  if (shown.value.variantId !== null && !props.view.buckets.some((b) => b.variantId === null)) rows.unshift({ key: NONE, name: '' })
  return rows
})

watch(
  () => props.target,
  (t) => {
    if (!t) return
    shown.value = t
    renew()
    void workspace.warmUp()
    openings.value++
    const bucket = props.view.buckets.find((b) => b.variantId === t.variantId)
    amount.value = t.prefill?.amount ?? (t.mode === 'transfer' ? (bucket?.quantity ?? '') : '')
    price.value = t.prefill?.price ?? ''
    url.value = t.prefill?.url ?? ''
    note.value = ''
    toKey.value = ''
    busy.value = false
    errorKey.value = null
  },
  { immediate: true },
)

const open = computed({
  get: () => props.target !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})

const mode = computed(() => shown.value.mode)
const summary = computed(() => (state.snapshot ? bucketDescription(state.snapshot, props.view.item.id, shown.value.variantId) : ''))
// The item has one unit: AmountField shows its symbol and no select.
const unitKey = computed(() => props.view.unit.key)
const units = computed(() => [props.view.unit])
const currencySymbol = computed(() => getCurrency(props.view.currency)?.symbol ?? props.view.currency)
const canSubmit = computed(() => !busy.value && !state.readOnly && (mode.value !== 'transfer' || toKey.value !== ''))

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const built = buildStockCommand(
    mode.value,
    { amount: amount.value, price: price.value, url: url.value, note: note.value, toVariantId: idOf(toKey.value) },
    { itemId: props.view.item.id, variantId: shown.value.variantId, unit: props.view.unit, currency: props.view.currency },
    ids,
  )
  if ('errorKey' in built) {
    errorKey.value = built.errorKey
    return
  }
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply(built.command)
    emit('done')
    emit('close')
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppSheet
    v-model:open="open"
    :title="$t(`stockForm.title.${mode}`)"
    :summary="summary"
    initial-focus="#stock-amount"
    :locked="busy"
  >
    <form :key="openings" class="mt-3.5 grid gap-3.5" novalidate @submit.prevent="submit">
      <div class="grid gap-1.5">
        <Label for="stock-amount">{{ $t(mode === 'set' ? 'stockForm.actual' : 'stockForm.amount') }}</Label>
        <AmountField id="stock-amount" v-model="amount" :unit-key="unitKey" :units="units" :invalid="errorKey === 'stockForm.invalidAmount'" />
      </div>

      <div v-if="mode === 'transfer'" class="grid gap-1.5">
        <span id="stock-to-label" class="text-sm leading-none font-medium">{{ $t('stockForm.moveTo') }}</span>
        <RadioGroup
          v-model="toKey"
          aria-labelledby="stock-to-label"
          class="grid max-h-[30dvh] gap-0.5 overflow-y-auto rounded-field border border-border bg-background p-1"
        >
          <label
            v-for="d in destinations"
            :key="d.key"
            class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-sm transition-colors duration-150 hover:bg-hover"
          >
            <RadioGroupItem :value="d.key" />
            <span class="min-w-0 flex-1 truncate">{{ d.name || $t('item.noVariant') }}</span>
          </label>
        </RadioGroup>
      </div>

      <template v-if="mode === 'receive'">
        <div class="grid gap-1.5">
          <Label for="stock-price">
            {{ $t('stockForm.price') }}
            <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
          </Label>
          <div class="relative">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">
              {{ currencySymbol }}
            </span>
            <Input id="stock-price" v-model="price" inputmode="decimal" autocomplete="off" class="h-11 rounded-field bg-surface pl-10" />
          </div>
        </div>
        <div class="grid gap-1.5">
          <Label for="stock-url">
            {{ $t('stockForm.url') }}
            <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
          </Label>
          <Input id="stock-url" v-model="url" type="url" autocomplete="off" class="h-11 rounded-field bg-surface" />
        </div>
      </template>

      <div v-if="mode !== 'transfer'" class="grid gap-1.5">
        <Label for="stock-note">
          {{ $t('stockForm.note') }}
          <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
        </Label>
        <Input id="stock-note" v-model="note" autocomplete="off" class="h-11 rounded-field bg-surface" />
      </div>

      <p role="alert" class="text-sm text-destructive">
        <template v-if="errorKey">{{ $t(errorKey) }}</template>
      </p>
      <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
        {{ $t(busy ? 'status.saving' : `stockForm.submit.${mode}`) }}
      </Button>
    </form>
  </AppSheet>
</template>

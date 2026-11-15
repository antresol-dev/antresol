<script setup lang="ts">
import { itemAxes, newId, type AttributeKind, type Id } from '@antresol/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { errorMessageKey } from '~/lib/errors'
import { looseTransferOffer } from '~/lib/item-view'
import { parseNameList } from '~/lib/lists'
import { isNewLine, planVariantBatch } from '~/lib/variant-batch'

export interface LooseOffer {
  quantity: string
  number: string
  unit: string
}
export interface VariantsAdded {
  created: { id: Id; label: string }[]
  /** The stock without a variant that could move into one of the new variants, as it was before they were added. */
  offer: LooseOffer | null
}

const props = defineProps<{ itemId: Id }>()
const emit = defineEmits<{ done: [added: VariantsAdded] }>()

const workspace = useWorkspace()
const { state } = workspace
const { add: addAxisTo } = useAddAxis()
const { ids, renew } = useCommandIds(['attributeId', 'firstVariantId'])
// One id per new variant line (and per its receipt), kept across retries; dropped after a success.
const lineIds = new Map<string, Id>()
const lineId = (key: string): Id => {
  let id = lineIds.get(key)
  if (!id) lineIds.set(key, (id = newId()))
  return id
}

// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)
const writable = computed(() => !busy.value && !state.readOnly && !!state.snapshot)

const axes = computed(() => (state.snapshot ? itemAxes(state.snapshot, props.itemId) : []))

// ---- step 1: the first axis, for an item that has none ----
// Every attribute of the inventory, the item's shared ones included: the item has no axis yet, so any of them can be the first.
const choices = computed(() => [...(state.snapshot?.attributes ?? [])].sort((a, b) => a.name.localeCompare(b.name)))
const creating = ref(false)
const picked = ref<Id | null>(null)
const newName = ref('')
const newKind = ref<AttributeKind>('number')
const newOptions = ref('')
const newUnit = ref('')
const newPrefixes = ref(false)
const kinds = ['text', 'enum', 'number'] as const
const kindLabel = { text: 'attributeForm.text', enum: 'attributeForm.list', number: 'variantsForm.number' } as const
const showCreate = computed(() => creating.value || choices.value.length === 0)
const canAddAxis = computed(() => writable.value && (showCreate.value ? newName.value.trim() !== '' : picked.value !== null))

async function addAxis(): Promise<void> {
  const snapshot = state.snapshot
  if (!canAddAxis.value || !snapshot) return
  let attributeId = picked.value
  const options = newKind.value === 'enum' ? parseNameList(newOptions.value) : []
  if (showCreate.value && newKind.value === 'enum' && options.length === 0) {
    errorKey.value = 'attributeForm.optionsRequired'
    return
  }
  busy.value = true
  errorKey.value = null
  try {
    if (showCreate.value) {
      attributeId = ids.attributeId
      await workspace.apply({
        type: 'attribute.create',
        id: attributeId,
        inventoryId: snapshot.inventory.id,
        name: newName.value.trim(),
        kind: newKind.value,
        options,
        unit: newKind.value === 'number' ? newUnit.value.trim() : '',
        siPrefixes: newKind.value === 'number' && newPrefixes.value,
      })
    }
    if (attributeId === null) return
    // The new axis shows the values step by itself once the snapshot has it. A shared value that became the first variant,
    // on an item with stock outside variants, ends here instead: the stock offer goes with it.
    const first = await addAxisTo(props.itemId, attributeId, ids.firstVariantId)
    renew()
    if (first) emit('done', { created: first.variants.map((v) => ({ id: v.id, label: v.name })), offer: first.offer })
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}

// ---- step 2: the values ----
const text = ref('')
const lines = computed(() => (state.snapshot ? planVariantBatch(state.snapshot, props.itemId, text.value) : []))
const fresh = computed(() => lines.value.filter(isNewLine))
const hasError = computed(() => lines.value.some((l) => l.error !== null))
const canSubmit = computed(() => writable.value && !hasError.value && fresh.value.length > 0)
const placeholder = computed(() => (axes.value.length > 1 ? axes.value.map((a) => a.name).join('; ') : ''))

async function submit(): Promise<void> {
  const snapshot = state.snapshot
  if (!canSubmit.value || !snapshot) return
  // Decided before the write: afterwards the item has variants and no offer.
  const offer = looseTransferOffer(snapshot, props.itemId)
  const created = fresh.value.map((l) => {
    const key = JSON.stringify(l.values ?? [])
    return { id: lineId(key), label: l.label ?? '', values: l.values ?? [], receipt: l.quantity === null ? undefined : { movementId: lineId(`m:${key}`), quantity: l.quantity } }
  })
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply({
      type: 'variant.createMany',
      itemId: props.itemId,
      variants: created.map((c) => ({ id: c.id, values: c.values, ...(c.receipt ? { initialReceipt: c.receipt } : {}) })),
    })
    lineIds.clear()
    emit('done', { created: created.map((c) => ({ id: c.id, label: c.label })), offer })
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}

async function restore(archiveId: Id): Promise<void> {
  if (!writable.value) return
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
</script>

<template>
  <form v-if="axes.length === 0" class="mt-4 grid gap-4" novalidate @submit.prevent="addAxis">
    <p class="text-sm text-muted-foreground">{{ $t('variantsForm.rule') }}</p>
    <div v-if="!showCreate" class="grid gap-2">
      <Label for="variants-axis">{{ $t('variantsForm.axis') }}</Label>
      <Select v-model="picked" :disabled="busy">
        <SelectTrigger id="variants-axis" class="h-11 w-full">
          <SelectValue :placeholder="$t('variantsForm.axisPlaceholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="a in choices" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="button" variant="ghost" class="h-11 justify-start rounded-field px-2" :disabled="busy" @click="creating = true">
        {{ $t('variantsForm.createAttribute') }}
      </Button>
    </div>
    <template v-else>
      <div class="grid gap-2">
        <Label for="variants-axis-name">{{ $t('form.name') }}</Label>
        <Input id="variants-axis-name" v-model="newName" autocomplete="off" class="h-11" />
      </div>
      <div class="grid gap-2">
        <Label id="variants-axis-kind">{{ $t('attributeForm.type') }}</Label>
        <RadioGroup
          v-model="newKind"
          aria-labelledby="variants-axis-kind"
          class="grid grid-cols-3 gap-0.5 rounded-field border border-input bg-field p-1"
        >
          <label
            v-for="k in kinds"
            :key="k"
            class="flex min-h-11 cursor-pointer items-center gap-2 rounded-chip px-3 text-sm transition-colors duration-(--dur-fast) hover:bg-hover"
          >
            <RadioGroupItem :value="k" />
            {{ $t(kindLabel[k]) }}
          </label>
        </RadioGroup>
      </div>
      <div v-if="newKind === 'enum'" class="grid gap-2">
        <Label for="variants-axis-options">{{ $t('attributeForm.options') }}</Label>
        <Textarea id="variants-axis-options" v-model="newOptions" rows="3" autocomplete="off" />
        <p class="text-sm text-subtle-foreground">{{ $t('attributeForm.hint') }}</p>
      </div>
      <template v-if="newKind === 'number'">
        <div class="grid gap-2">
          <Label for="variants-axis-unit">
            {{ $t('variantsForm.unit') }}
            <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
          </Label>
          <Input id="variants-axis-unit" v-model="newUnit" autocomplete="off" class="h-11" />
        </div>
        <label class="field-text flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
          {{ $t('variantsForm.siPrefixes') }}
          <Switch v-model="newPrefixes" :disabled="busy" />
        </label>
      </template>
      <Button v-if="choices.length > 0" type="button" variant="ghost" class="h-11 justify-start rounded-field px-2" :disabled="busy" @click="creating = false">
        {{ $t('variantsForm.pickAttribute') }}
      </Button>
    </template>
    <p role="alert" class="field-text text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canAddAxis">
      {{ $t(busy ? 'status.saving' : 'variantsForm.continue') }}
    </Button>
  </form>

  <form v-else class="mt-4 grid gap-4" novalidate @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="variants-names">{{ $t('variantsForm.names') }}</Label>
      <Textarea
        id="variants-names"
        v-model="text"
        rows="4"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        :spellcheck="false"
        :placeholder="placeholder"
        :aria-invalid="hasError || errorKey ? true : undefined"
        aria-describedby="variants-hint variants-preview variants-error"
      />
      <p id="variants-hint" class="text-sm text-subtle-foreground">
        {{ axes.length > 1 ? $t('variantsForm.hintMany', { axes: axes.map((a) => a.name).join('; ') }) : $t('variantsForm.hintOne', { axis: axes[0]?.name ?? '' }) }}
      </p>
    </div>
    <ul id="variants-preview" class="grid gap-1" :aria-label="$t('variantsForm.preview')">
      <li
        v-for="(l, n) in lines"
        :key="n"
        class="flex min-h-9 flex-wrap items-center justify-between gap-x-3 rounded-field border border-border px-3 py-1.5 text-sm"
        :class="l.error ? 'border-destructive' : ''"
      >
        <span class="min-w-0 truncate" :class="l.error || l.duplicate || l.repeat ? 'text-muted-foreground' : 'font-semibold'">
          {{ l.label ?? l.raw }}<template v-if="l.quantityLabel"> — {{ l.quantityLabel }}</template>
        </span>
        <span v-if="l.error" class="text-sm text-destructive">{{ $t(l.error) }}</span>
        <span v-else-if="l.duplicate" class="flex items-center gap-2 text-sm text-subtle-foreground">
          {{ $t(l.duplicate.archived ? 'variantsForm.inArchive' : 'variantsForm.exists') }}
          <Button
            v-if="l.duplicate.archived && l.duplicate.archiveId"
            type="button"
            variant="outline"
            size="sm"
            class="h-9 rounded-field"
            :disabled="!writable"
            @click="restore(l.duplicate.archiveId)"
          >
            {{ $t('variantsForm.restore') }}
          </Button>
        </span>
        <span v-else-if="l.repeat" class="text-sm text-subtle-foreground">{{ $t('variantsForm.repeat') }}</span>
      </li>
    </ul>
    <p id="variants-error" role="alert" class="field-text text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : 'variantsForm.add') }}
    </Button>
  </form>
</template>

<script setup lang="ts">
import { getCurrency, type Id } from '@graymatter/core'
import { ChevronDown } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { unitChoices } from '~/lib/amounts'
import { errorMessageKey } from '~/lib/errors'
import { buildQuickAdd } from '~/lib/quick-add'
import { folderChoices, pathOf, snapshotIndex } from '~/lib/views'

const props = defineProps<{ name: string; folderId: Id | null }>()
const emit = defineEmits<{ done: [added: { id: Id; name: string }] }>()

const workspace = useWorkspace()
const { state } = workspace

const name = ref(props.name)
const folderId = ref<Id | null>(props.folderId)
const unitKey = ref('pcs')
const amount = ref('')
const price = ref('')
const url = ref('')
const picking = ref(false)
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)

const snapshot = computed(() => state.snapshot)
const units = computed(() => (snapshot.value ? unitChoices(snapshot.value) : []))
const choices = computed(() => (snapshot.value ? folderChoices(snapshot.value, folderId.value) : []))
// "Electronics / ICs": the inventory, then the folders down to the chosen one.
const folderPath = computed(() => {
  const s = snapshot.value
  if (!s) return ''
  const folders = folderId.value === null ? [] : pathOf(snapshotIndex(s), folderId.value)
  return [s.inventory.name, ...folders.map((f) => f.name)].join(' / ')
})
const currencySymbol = computed(() => {
  const code = snapshot.value?.inventory.currency
  return (code && getCurrency(code)?.symbol) || code || ''
})

const canSubmit = computed(() => !busy.value && !state.readOnly && !!snapshot.value)

function pick(id: Id | null): void {
  folderId.value = id
  picking.value = false
}

async function submit(): Promise<void> {
  const s = snapshot.value
  if (!canSubmit.value || !s) return
  const built = buildQuickAdd(
    { folderId: folderId.value, name: name.value, unitKey: unitKey.value, amount: amount.value, price: price.value, url: url.value },
    s,
  )
  if ('errorKey' in built) {
    errorKey.value = built.errorKey
    return
  }
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply(built.command)
    emit('done', { id: built.command.id, name: built.command.name })
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="grid gap-3.5" novalidate @submit.prevent="submit">
    <div class="grid gap-1.5">
      <Label for="quick-add-name">{{ $t('form.name') }}</Label>
      <Input id="quick-add-name" v-model="name" autocomplete="off" class="h-11 rounded-field bg-surface" />
    </div>

    <div class="grid gap-1.5">
      <Label for="quick-add-folder">{{ $t('quickAdd.folder') }}</Label>
      <button
        id="quick-add-folder"
        type="button"
        :aria-expanded="picking"
        class="flex h-11 w-full min-w-0 items-center gap-2 rounded-field border border-input bg-surface px-3 text-left text-sm outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
        @click="picking = !picking"
      >
        <span class="min-w-0 flex-1 truncate">{{ folderPath }}</span>
        <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-150 motion-reduce:transition-none" :class="picking ? 'rotate-180' : ''" aria-hidden="true" />
      </button>
      <FolderPickerList v-if="picking" :choices="choices" :aria-label="$t('quickAdd.chooseFolder')" @select="pick" />
    </div>

    <div class="grid gap-1.5">
      <Label for="quick-add-amount">
        {{ $t('quickAdd.amount') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <AmountField id="quick-add-amount" v-model="amount" v-model:unit-key="unitKey" :units="units" />
    </div>

    <div class="grid gap-1.5">
      <Label for="quick-add-price">
        {{ $t('quickAdd.price') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <div class="relative">
        <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">
          {{ currencySymbol }}
        </span>
        <Input
          id="quick-add-price"
          v-model="price"
          inputmode="decimal"
          autocomplete="off"
          aria-describedby="quick-add-price-hint"
          class="h-11 rounded-field bg-surface pl-10"
        />
      </div>
      <p id="quick-add-price-hint" class="text-xs text-subtle-foreground">{{ $t('quickAdd.priceHint') }}</p>
    </div>

    <div class="grid gap-1.5">
      <Label for="quick-add-url">
        {{ $t('quickAdd.url') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <Input id="quick-add-url" v-model="url" type="url" autocomplete="off" class="h-11 rounded-field bg-surface" />
    </div>

    <p id="quick-add-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : 'quickAdd.add') }}
    </Button>
  </form>
</template>

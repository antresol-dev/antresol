<script setup lang="ts">
import { CURRENCIES } from '@graymatter/core'
import { Check, ChevronDown } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
  ComboboxViewport,
} from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currencyOptions } from '~/lib/currencies'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { errorMessageKey } from '~/lib/errors'

const props = defineProps<{ mode: 'create' | 'rename' }>()
const emit = defineEmits<{ done: [] }>()

const LAST_CURRENCY_KEY = 'gm-last-currency'

function readLastCurrency(): string {
  try {
    const code = localStorage.getItem(LAST_CURRENCY_KEY)
    if (code && CURRENCIES[code]) return code
  } catch {
    // storage unavailable: use the default
  }
  return 'USD'
}

function rememberCurrency(code: string): void {
  try {
    localStorage.setItem(LAST_CURRENCY_KEY, code)
  } catch {
    // a per-device convenience only
  }
}

const workspace = useWorkspace()
const { ids } = useCommandIds(['inventoryId'])
const { state } = workspace
const router = useRouter()

const sources = computed(() => state.sources.filter((s) => s.status === 'ready'))
const existing = props.mode === 'rename' ? (state.snapshot?.inventory ?? null) : null

const name = ref(existing?.name ?? '')
const description = ref(existing?.description ?? '')
const currency = ref(readLastCurrency())
const sourceId = ref(
  sources.value.find((s) => s.config.id === state.current?.sourceId)?.config.id ?? sources.value[0]?.config.id ?? '',
)
const search = ref('')
const comboOpen = ref(false)
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)

const options = computed(() => currencyOptions(search.value))
const selected = computed(() => CURRENCIES[currency.value])
// Rename sends only what differs from the inventory as it was opened: a stale form must not revert another device's edit.
const baseline = captureBaseline({ name: existing?.name ?? '', description: existing?.description ?? null })
const changes = computed(() =>
  changedFields(
    baseline,
    { name: name.value.trim(), description: description.value.trim() || null },
  ),
)
const canSubmit = computed(
  () =>
    !busy.value &&
    !state.readOnly &&
    (props.mode === 'rename' ? !!existing && Object.keys(changes.value).length > 0 : !!sourceId.value),
)

watch(comboOpen, (open) => {
  if (!open) search.value = ''
})

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  errorKey.value = null
  try {
    if (props.mode === 'create') {
      await workspace.createInventory({ sourceId: sourceId.value, name: name.value.trim(), currency: currency.value, id: ids.inventoryId })
      rememberCurrency(currency.value)
    } else if (existing) {
      await workspace.apply({
        type: 'inventory.update',
        id: existing.id,
        ...changes.value,
      })
    }
    emit('done')
    // A new history entry for the new inventory's root, even when the root is already open (see InventorySwitcher.choose).
    if (props.mode === 'create') await router.push({ path: '/', force: true })
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
      <Label for="inventory-name">{{ $t('form.name') }}</Label>
      <Input
        id="inventory-name"
        v-model="name"
        autocomplete="off"
        :aria-invalid="errorKey ? true : undefined"
        aria-describedby="inventory-form-error"
        class="h-11"
      />
    </div>

    <div v-if="mode === 'create'" class="grid gap-1.5">
      <Label for="inventory-currency">{{ $t('inventoryForm.currency') }}</Label>
      <Combobox v-model="currency" v-model:open="comboOpen" ignore-filter>
        <ComboboxAnchor class="w-full">
          <ComboboxTrigger
            id="inventory-currency"
            :aria-label="$t('inventoryForm.currency')"
            class="flex h-11 w-full items-center justify-between gap-2 rounded-field border border-input bg-field px-3 text-left text-sm"
          >
            <span class="truncate">{{ selected ? `${selected.code} · ${selected.name}` : currency }}</span>
            <ChevronDown class="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
          </ComboboxTrigger>
        </ComboboxAnchor>
        <ComboboxList class="w-(--reka-combobox-trigger-width)">
          <ComboboxInput
            :placeholder="$t('inventoryForm.currencySearch')"
            class="h-11"
            @input="search = ($event.target as HTMLInputElement).value"
          />
          <ComboboxViewport class="max-h-56 p-1">
            <ComboboxEmpty>{{ $t('inventoryForm.currencyNone') }}</ComboboxEmpty>
            <ComboboxItem v-for="c in options" :key="c.code" :value="c.code" class="min-h-11">
              <span class="w-10 shrink-0 font-semibold">{{ c.code }}</span>
              <span class="min-w-0 truncate text-subtle-foreground">{{ c.name }}</span>
              <ComboboxItemIndicator><Check class="size-4" aria-hidden="true" /></ComboboxItemIndicator>
            </ComboboxItem>
          </ComboboxViewport>
        </ComboboxList>
      </Combobox>
    </div>

    <div v-if="mode === 'create' && sources.length > 1" class="grid gap-1.5">
      <Label for="inventory-source">{{ $t('inventoryForm.source') }}</Label>
      <Select v-model="sourceId">
        <SelectTrigger id="inventory-source" class="h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="s in sources" :key="s.config.id" :value="s.config.id" class="min-h-11">
            {{ s.config.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="mode === 'rename'" class="grid gap-1.5">
      <Label for="inventory-description">
        {{ $t('form.description') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <Input id="inventory-description" v-model="description" autocomplete="off" class="h-11" />
    </div>

    <p id="inventory-form-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>

    <Button v-if="mode === 'create' && !sources.length" as-child variant="outline" class="h-11">
      <NuxtLink to="/settings" @click="emit('done')">{{ $t('inventoryForm.connectSource') }}</NuxtLink>
    </Button>
    <Button v-else type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : mode === 'create' ? 'inventoryForm.create' : 'inventoryForm.save') }}
    </Button>
  </form>
</template>

<script setup lang="ts">
import type { Id } from '@antresol/core'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { errorMessageKey } from '~/lib/errors'
import { bucketDescription } from '~/lib/item-view'
import type { LooseOffer } from '~/components/VariantsForm.vue'

// Offered right after the first variants are added: move the stock kept without a variant into one of them.
const props = defineProps<{ itemId: Id; offer: LooseOffer | null; variants: { id: Id; name: string }[] }>()
const emit = defineEmits<{ close: [] }>()

const workspace = useWorkspace()
const { ids, renew } = useCommandIds(['transferId', 'outMovementId', 'inMovementId'])
const { state } = workspace
const summary = computed(() => (state.snapshot ? bucketDescription(state.snapshot, props.itemId, null) : ''))

// What the sheet shows while it animates out.
const shown = shallowRef<{ offer: LooseOffer; variants: { id: Id; name: string }[] } | null>(null)
const toId = ref('')
const busy = ref(false)
const errorKey = ref<string | null>(null)

watch(
  () => props.offer,
  (offer) => {
    if (!offer) return
    shown.value = { offer, variants: props.variants }
    toId.value = props.variants[0]?.id ?? ''
    renew()
    busy.value = false
    errorKey.value = null
  },
  { immediate: true },
)

const open = computed({
  get: () => props.offer !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})

async function move(): Promise<void> {
  const current = shown.value
  if (!current || busy.value || state.readOnly || toId.value === '') return
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply({
      type: 'stock.transfer',
      ...ids,
      itemId: props.itemId,
      fromVariantId: null,
      toVariantId: toId.value,
      quantity: current.offer.quantity,
    })
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
    :locked="busy"
    :summary="summary"
    :title="$t('looseTransfer.title', { number: shown?.offer.number ?? '', unit: shown?.offer.unit ?? '' })"
  >
    <div class="mt-4 grid gap-4">
      <RadioGroup
        v-model="toId"
        :aria-label="$t('looseTransfer.choose')"
        class="grid max-h-[30dvh] gap-0.5 overflow-y-auto rounded-field border border-input bg-field p-1"
      >
        <label
          v-for="v in shown?.variants ?? []"
          :key="v.id"
          class="flex min-h-11 cursor-pointer items-center gap-3 rounded-chip px-3 text-sm transition-colors duration-(--dur-fast) hover:bg-hover"
        >
          <RadioGroupItem :value="v.id" />
          <span class="min-w-0 flex-1 truncate">{{ v.name }}</span>
        </label>
      </RadioGroup>
      <p role="alert" class="text-sm text-destructive">
        <template v-if="errorKey">{{ $t(errorKey) }}</template>
      </p>
    </div>
    <template #footer>
      <Button type="button" data-primary class="h-11 rounded-field" :disabled="busy || !!state.readOnly" @click="move">
        {{ $t(busy ? 'status.saving' : 'looseTransfer.move') }}
      </Button>
      <Button type="button" variant="outline" class="h-11" :disabled="busy" @click="open = false">
        {{ $t('looseTransfer.keep') }}
      </Button>
    </template>
  </AppSheet>
</template>

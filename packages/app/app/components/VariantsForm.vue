<script setup lang="ts">
import { newId, type Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { errorMessageKey } from '~/lib/errors'
import { looseTransferOffer } from '~/lib/item-view'
import { parseNameList } from '~/lib/lists'

export interface LooseOffer {
  quantity: string
  number: string
  unit: string
}
export interface VariantsAdded {
  created: { id: Id; name: string }[]
  /** The stock without a variant that could move into one of the new variants, as it was before they were added. */
  offer: LooseOffer | null
}

const props = defineProps<{ itemId: Id }>()
const emit = defineEmits<{ done: [added: VariantsAdded] }>()

const workspace = useWorkspace()
const { state } = workspace

const text = ref('')
const busy = ref(false)
const errorKey = ref<string | null>(null)
const canSubmit = computed(() => !busy.value && !state.readOnly && !!state.snapshot)

async function submit(): Promise<void> {
  const snapshot = state.snapshot
  if (!canSubmit.value || !snapshot) return
  const names = parseNameList(text.value)
  if (names.length === 0) {
    errorKey.value = 'errors.domain.name_required'
    return
  }
  // Decided before the write: afterwards the item has variants and no offer.
  const offer = looseTransferOffer(snapshot, props.itemId)
  const created = names.map((name) => ({ id: newId(), name }))
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply({ type: 'variant.createMany', itemId: props.itemId, variants: created })
    emit('done', { created, offer })
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="mt-3.5 grid gap-3.5" novalidate @submit.prevent="submit">
    <div class="grid gap-1.5">
      <Label for="variants-names">{{ $t('variantsForm.names') }}</Label>
      <Textarea
        id="variants-names"
        v-model="text"
        rows="4"
        autocomplete="off"
        :aria-invalid="errorKey ? true : undefined"
        aria-describedby="variants-hint variants-error"
        class="rounded-field bg-surface"
      />
      <p id="variants-hint" class="text-[13px] text-subtle-foreground">{{ $t('variantsForm.hint') }}</p>
    </div>
    <p id="variants-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : 'variantsForm.add') }}
    </Button>
  </form>
</template>

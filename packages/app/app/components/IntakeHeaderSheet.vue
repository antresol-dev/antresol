<script setup lang="ts">
import type { Id, IntakeHeader } from '@antresol/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { errorMessageKey } from '~/lib/errors'

// Shop, order number, purchase day and note of an intake (a draft or a committed one). A draft's screen passes `saveDraft`:
// its header is an edit of the draft, which works offline too.
const props = defineProps<{ intakeId: Id; header: IntakeHeader; shops: string[]; saveDraft?: (header: IntakeHeader) => Promise<void> }>()
const emit = defineEmits<{ saved: [] }>()
const open = defineModel<boolean>('open', { required: true })

const intakes = useIntakes()
const { state } = useWorkspace()

const shop = ref('')
const orderNumber = ref('')
const purchasedOn = ref('')
const note = ref('')
const busy = ref(false)
const errorKey = ref<string | null>(null)

// The form starts from the header as it is every time the sheet opens.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    shop.value = props.header.shop ?? ''
    orderNumber.value = props.header.orderNumber ?? ''
    purchasedOn.value = props.header.purchasedOn
    note.value = props.header.note ?? ''
    errorKey.value = null
  },
  { immediate: true },
)

const blocked = computed(() => !!state.readOnly && !(props.saveDraft && state.readOnly === 'offline'))
const canSave = computed(() => !busy.value && !blocked.value && /^\d{4}-\d{2}-\d{2}$/.test(purchasedOn.value))

async function save(): Promise<void> {
  if (!canSave.value) return
  busy.value = true
  errorKey.value = null
  try {
    const header = {
      shop: shop.value.trim() || null,
      orderNumber: orderNumber.value.trim() || null,
      purchasedOn: purchasedOn.value,
      note: note.value.trim() || null,
    }
    await (props.saveDraft ? props.saveDraft(header) : intakes.updateHeader(props.intakeId, header))
    emit('saved')
    open.value = false
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('intakes.header.title')" :locked="busy" initial-focus="#intake-shop">
    <form id="intake-header-form" class="mt-3.5 grid gap-3.5" novalidate @submit.prevent="save">
      <div class="grid gap-1.5">
        <Label for="intake-shop">{{ $t('intakes.header.shop') }}</Label>
        <Input id="intake-shop" v-model="shop" list="intake-shops" autocomplete="off" class="h-11" />
        <datalist id="intake-shops">
          <option v-for="name in shops" :key="name" :value="name" />
        </datalist>
      </div>
      <div class="grid gap-1.5">
        <Label for="intake-order">{{ $t('intakes.header.orderNumber') }}</Label>
        <Input id="intake-order" v-model="orderNumber" autocomplete="off" class="h-11" />
      </div>
      <div class="grid gap-1.5">
        <Label for="intake-date">{{ $t('intakes.header.date') }}</Label>
        <Input id="intake-date" v-model="purchasedOn" type="date" class="h-11" />
      </div>
      <div class="grid gap-1.5">
        <Label for="intake-note">
          {{ $t('intakes.header.note') }}
          <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
        </Label>
        <Textarea id="intake-note" v-model="note" rows="3" />
      </div>
      <p role="alert" class="text-sm text-destructive">
        <template v-if="errorKey">{{ $t(errorKey) }}</template>
      </p>
    </form>
    <template #footer>
      <Button type="submit" form="intake-header-form" data-primary class="h-11 rounded-field" :disabled="!canSave">
        {{ $t(busy ? 'status.saving' : 'intakes.header.save') }}
      </Button>
      <Button type="button" variant="outline" class="h-11" :disabled="busy" @click="open = false">
        {{ $t('ui.cancel') }}
      </Button>
    </template>
  </AppSheet>
</template>

<script setup lang="ts">
import { getCurrency, type Command, type Id } from '@antresol/core'
import { refDebounced } from '@vueuse/core'
import { ChevronDown, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { pricePreview, unitChoices } from '~/lib/amounts'
import { errorMessageKey } from '~/lib/errors'
import { clearDraft, linkNeedsAmount, saveDraft, type QuickAddDraft } from '~/lib/quick-add-draft'
import { buildQuickAdd, existingMatches, type MatchRow } from '~/lib/quick-add'
import { isUnknownOutcome } from '~/lib/unconfirmed'
import { folderChoices, pathOf, snapshotIndex } from '~/lib/views'

const props = defineProps<{ name: string; folderId: Id | null; url?: string; draft?: QuickAddDraft | null }>()
const emit = defineEmits<{
  done: [added: { id: Id; name: string; photoFailed: boolean }]
  /** "Receive here" on a match: receive into it instead, with what was typed. */
  receive: [into: { itemId: Id; variantId: Id | null; amount: string; price: string; url: string; photoDropped: boolean }]
  /** "Open" on a match that has variants: no stock bucket to receive into without choosing one. */
  open: [itemId: Id]
  /** Close after an unknown outcome: the next opening is a new form with new ids. */
  close: []
}>()

const workspace = useWorkspace()
const { state } = workspace
const { ids, renew } = useCommandIds(['itemId', 'movementId'])
type ItemCreate = Extract<Command, { type: 'item.create' }>
// After an unknown outcome the form is frozen until Retry (the same command) or Close (spec 4.7). A copy loaded since
// that holds the item shows it landed: saved.
const sender = useFormSender((c) => c.type === 'item.create' && !!state.snapshot?.items.some((i) => i.id === c.id))
const unconfirmed = sender.frozen
/** The command sent last: the one a retry sends again. */
let sent: ItemCreate | null = null

const name = ref(props.name)
const folderId = ref<Id | null>(props.folderId)
const unitKey = ref(props.draft?.unitKey ?? 'pcs')
const amount = ref(props.draft?.amount ?? '')
const price = ref(props.draft?.price ?? '')
const url = ref(props.draft?.url ?? props.url ?? '')
// The link the form opened with from the share sheet; a restored draft remembers its own.
const prefilledUrl = props.draft ? props.draft.prefilledUrl : props.url
const picking = ref(false)
const photo = ref<File | null>(props.draft?.photo ?? null)
const preview = computed(() => (photo.value ? URL.createObjectURL(photo.value) : null))
watch(preview, (_, old) => {
  if (old) URL.revokeObjectURL(old)
})
onBeforeUnmount(() => {
  if (preview.value) URL.revokeObjectURL(preview.value)
})
// The photo field is there only if this source can store photos.
const canPhoto = computed(() => !!state.current && workspace.fileStoreFor(state.current.sourceId) !== null)
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)
const errorParams = ref<Record<string, string>>({})

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
const pricePreviewOf = computed(() => pricePreview(price.value, snapshot.value?.inventory.currency ?? ''))
const currencySymbol = computed(() => {
  const code = snapshot.value?.inventory.currency
  return (code && getCurrency(code)?.symbol) || code || ''
})

// A shared link is kept only with an amount (see buildQuickAdd): say so while it would be left out.
const linkHint = computed(() => linkNeedsAmount(url.value, prefilledUrl, amount.value))

const canSubmit = computed(() => !busy.value && !state.readOnly && !!snapshot.value)

// "You already have it" (spec 4.9): up to three things with this name, a moment after typing stops. Save stays free.
const typedName = refDebounced(name, 150)
const matches = computed<MatchRow[]>(() => (snapshot.value ? existingMatches(typedName.value, snapshot.value, 3, { everyWord: true }) : []))
const matchLine = (m: MatchRow): string =>
  [m.path || snapshot.value?.inventory.name, m.amount].filter((x): x is string => !!x).join(' · ')

function receiveHere(m: MatchRow): void {
  if (busy.value || unconfirmed.value) return
  // The item itself has variants: which one is the person's call, on its card.
  if (m.variantId === null && m.hasVariants) {
    // Going to the card must not lose what was typed: the next opening of the sheet brings it back.
    if (snapshot.value)
      saveDraft({
        inventoryId: snapshot.value.inventory.id,
        folderId: folderId.value,
        name: name.value,
        unitKey: unitKey.value,
        amount: amount.value,
        price: price.value,
        url: url.value,
        prefilledUrl,
        photo: photo.value,
      })
    emit('open', m.itemId)
    return
  }
  // The typed values go into the receipt.
  clearDraft()
  emit('receive', { itemId: m.itemId, variantId: m.variantId, amount: amount.value, price: price.value, url: url.value, photoDropped: photo.value !== null })
}

function pick(id: Id | null): void {
  folderId.value = id
  picking.value = false
}

/** Why the last retry failed, under the "not confirmed" line; nothing more when the source just did not answer again. */
const retryErrorKey = computed(() =>
  unconfirmed.value && !isUnknownOutcome(sender.error.value) ? errorMessageKey(sender.error.value) : null,
)

async function submit(): Promise<void> {
  if (busy.value) return
  if (unconfirmed.value) {
    if (sent) await send(sent)
    return
  }
  const s = snapshot.value
  if (!canSubmit.value || !s) return
  const built = buildQuickAdd(
    { folderId: folderId.value, name: name.value, unitKey: unitKey.value, amount: amount.value, price: price.value, url: url.value, prefilledUrl },
    s,
    { itemId: ids.itemId, movementId: ids.movementId },
  )
  if ('errorKey' in built) {
    errorKey.value = built.errorKey
    errorParams.value = built.params ?? {}
    return
  }
  sent = built.command
  await send(built.command)
}

/** Sends the command (while unconfirmed, sends it again), then the photo. */
async function send(command: ItemCreate): Promise<void> {
  busy.value = true
  errorKey.value = null
  try {
    if ((await sender.send(command)) === 'failed') {
      errorKey.value = unconfirmed.value ? null : errorMessageKey(sender.error.value)
      return
    }
    // The sheet stays locked through the upload; a failed photo leaves the item and says so.
    let photoFailed = false
    if (photo.value && canPhoto.value) {
      try {
        await workspace.addPhotos(command.id, [photo.value])
      } catch {
        photoFailed = true
      }
    }
    clearDraft()
    renew()
    emit('done', { id: command.id, name: command.name, photoFailed })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="grid gap-3.5" novalidate @submit.prevent="submit">
    <fieldset :disabled="unconfirmed" class="grid min-w-0 gap-3.5">
      <div class="grid gap-1.5">
        <Label for="quick-add-name">{{ $t('form.name') }}</Label>
        <Input id="quick-add-name" v-model="name" autocomplete="off" class="h-11" />
        <section v-if="matches.length > 0" class="grid gap-1" aria-labelledby="quick-add-existing">
          <h3 id="quick-add-existing" class="pt-1 text-xs font-semibold text-subtle-foreground">{{ $t('quickAdd.existing') }}</h3>
          <ul class="grid gap-0.5">
            <li v-for="m in matches" :key="`${m.itemId}:${m.variantId ?? ''}`" class="flex min-h-11 items-center gap-2.5 rounded-field px-1">
              <ItemThumb :id="m.itemId" :folder-name="m.folderName" :cover="m.cover" class="size-9 rounded-thumb text-xs" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm font-bold">
                  {{ m.name }}<span v-if="m.variantName" class="font-semibold text-muted-foreground"> · {{ m.variantName }}</span>
                </span>
                <span class="truncate text-xs text-muted-foreground">{{ matchLine(m) }}</span>
              </span>
              <Button type="button" variant="outline" size="sm" class="h-9 shrink-0" :disabled="busy" @click="receiveHere(m)">
                {{ $t(m.variantId === null && m.hasVariants ? 'quickAdd.openMatch' : 'quickAdd.receiveHere') }}
              </Button>
            </li>
          </ul>
        </section>
      </div>

      <div class="grid gap-1.5">
        <Label for="quick-add-folder">{{ $t('quickAdd.folder') }}</Label>
        <button
          id="quick-add-folder"
          type="button"
          :aria-expanded="picking"
          class="flex h-11 w-full min-w-0 items-center gap-2 rounded-field border border-input bg-field px-3 text-left text-sm transition-colors duration-150 hover:bg-hover"
          @click="picking = !picking"
        >
          <RootMark />
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
            inputmode="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            aria-describedby="quick-add-price-hint"
            class="h-11 pl-10"
          />
        </div>
        <ExpressionHint :preview="pricePreviewOf" />
        <p id="quick-add-price-hint" class="text-xs text-subtle-foreground">{{ $t('quickAdd.priceHint') }}</p>
      </div>

      <div class="grid gap-1.5">
        <Label for="quick-add-url">
          {{ $t('quickAdd.url') }}
          <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
        </Label>
        <Input id="quick-add-url" v-model="url" type="url" autocomplete="off" class="h-11" :aria-describedby="linkHint ? 'quick-add-url-hint' : undefined" />
        <p v-if="linkHint" id="quick-add-url-hint" class="text-xs text-subtle-foreground">{{ $t('quickAdd.linkNeedsAmount') }}</p>
      </div>

      <div v-if="canPhoto" class="grid gap-1.5">
        <p class="field-text text-sm font-medium leading-none">
          {{ $t('quickAdd.photo') }}
          <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
        </p>
        <div v-if="preview" class="flex items-center gap-3">
          <img :src="preview" alt="" class="size-[42px] shrink-0 rounded-thumb object-cover" >
          <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{{ photo?.name }}</span>
          <Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" :aria-label="$t('quickAdd.removePhoto')" :disabled="busy" @click="photo = null">
            <X class="size-4" aria-hidden="true" />
          </Button>
        </div>
        <PhotoPicker v-else :disabled="busy" @pick="photo = $event[0] ?? null" />
      </div>
    </fieldset>

    <p id="quick-add-error" role="alert" class="field-text text-sm text-destructive">
      <template v-if="unconfirmed">
        {{ $t('unconfirmed.hint') }}<template v-if="retryErrorKey"> {{ $t(retryErrorKey) }}</template>
      </template>
      <template v-else-if="errorKey">{{ $t(errorKey, errorParams) }}</template>
    </p>
    <div v-if="unconfirmed" class="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" class="h-11" :disabled="busy" @click="emit('close')">
        {{ $t('unconfirmed.close') }}
      </Button>
      <Button type="submit" class="h-11 rounded-field" :disabled="busy">
        {{ $t(busy ? 'status.saving' : 'unconfirmed.retry') }}
      </Button>
    </div>
    <Button v-else type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : 'quickAdd.add') }}
    </Button>
  </form>
</template>

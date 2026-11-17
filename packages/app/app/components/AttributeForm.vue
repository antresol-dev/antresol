<script setup lang="ts">
import type { Attribute, AttributeKind, DraftNewAttribute, Id } from '@antresol/core'
import { MAX_PINNED_ATTRIBUTES, sameName } from '@antresol/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'vue-sonner'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { attributeCreateCommand, attributeFormError, MAX_UNIT_LENGTH, prefixExample } from '~/lib/axes'
import { errorMessageKey } from '~/lib/errors'
import { parseNameList } from '~/lib/lists'

// Creates an inventory attribute or edits one: the name, a list's options, a number's unit and SI prefixes. The type can't change afterwards.
// `draft` (an intake's new attribute, spec 2026-11-16 §4): nothing is written; the form hands the attribute to the
// parent as `draft` (no "Show in lists", no units made). `attribute` then is the draft attribute being edited (its id is
// kept). While a name is typed `clash` tells whether an attribute of that name exists (or is in the draft): the form
// offers it as `useExisting` instead of saving a duplicate.
const props = defineProps<{
  attribute: Attribute | null
  draft?: boolean
  clash?: (name: string) => { id: Id; name: string } | null
}>()
const emit = defineEmits<{ done: [attributeId: Id]; draft: [attribute: DraftNewAttribute]; useExisting: [id: Id] }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { ids } = useCommandIds(['attributeId'])
const { state } = workspace

const name = ref(props.attribute?.name ?? '')
const kind = ref<AttributeKind>(props.attribute?.kind ?? 'text')
const unit = ref(props.attribute?.unit ?? '')
const siPrefixes = ref(props.attribute?.siPrefixes ?? false)
const options = ref(props.attribute?.options.join('\n') ?? '')
// "Show in lists" (spec 4.11): at most MAX_PINNED_ATTRIBUTES per inventory.
const pinned = ref(props.attribute?.pinned ?? false)
const pinnedFull = computed(
  () =>
    !props.attribute?.pinned &&
    (state.snapshot?.attributes.filter((a) => a.pinned && a.id !== props.attribute?.id).length ?? 0) >= MAX_PINNED_ATTRIBUTES,
)
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)
// Editing sends only what differs from the attribute as it was opened: a stale form must not revert another device's
// edit. Options are compared as the text typed, because their order is meaningful.
const baseline = captureBaseline({
  name: props.attribute?.name ?? '',
  options: props.attribute?.options.join('\n') ?? '',
  unit: props.attribute?.unit ?? '',
  siPrefixes: props.attribute?.siPrefixes ?? false,
  pinned: props.attribute?.pinned ?? false,
})
const changes = computed(() =>
  changedFields(baseline, {
    name: name.value.trim(),
    options: options.value.trim(),
    unit: unit.value.trim(),
    siPrefixes: siPrefixes.value,
    pinned: pinned.value,
  }),
)

// The line under the switch, on or off: what prefixes make of "4k7" with this unit.
const example = computed(() => prefixExample(unit.value))
const taken = computed(() => (props.draft && props.clash ? props.clash(name.value) : null))
// Saved for real (not a draft): the name must be free among the inventory's attributes; a name left as it was is not checked.
const nameTaken = computed(() => {
  const n = name.value.trim()
  if (props.draft || !n || !state.snapshot) return null
  if (props.attribute && sameName(props.attribute.name, n) && n === props.attribute.name) return null
  return state.snapshot.attributes.some((a) => a.id !== props.attribute?.id && sameName(a.name, n)) ? ('active' as const) : null
})
// A draft is edited on this device, so it works offline too.
const blocked = computed(() => (props.draft ? !!state.readOnly && state.readOnly !== 'offline' : !!state.readOnly || !state.snapshot))
const canSubmit = computed(
  () => !busy.value && !blocked.value && !taken.value && !nameTaken.value && (props.draft || !props.attribute || Object.keys(changes.value).length > 0),
)

async function submit(): Promise<void> {
  const snapshot = state.snapshot
  if (!canSubmit.value || (!snapshot && !props.draft)) return
  const list = kind.value === 'enum' ? parseNameList(options.value) : []
  const form = { name: name.value, kind: kind.value, options: options.value, unit: unit.value, siPrefixes: siPrefixes.value }
  const invalid = attributeFormError(form)
  if (invalid) {
    errorKey.value = invalid
    return
  }
  if (props.draft) {
    errorKey.value = null
    emit('draft', {
      id: props.attribute?.id ?? ids.attributeId,
      name: name.value.trim(),
      kind: kind.value,
      unit: kind.value === 'number' ? unit.value.trim() : '',
      siPrefixes: kind.value === 'number' ? siPrefixes.value : false,
      options: list,
    })
    return
  }
  if (!snapshot) return
  busy.value = true
  errorKey.value = null
  try {
    if (props.attribute) {
      await workspace.apply({
        type: 'attribute.update',
        id: props.attribute.id,
        ...(changes.value.name !== undefined ? { name: changes.value.name } : {}),
        ...(kind.value === 'enum' && changes.value.options !== undefined ? { options: list } : {}),
        ...(kind.value === 'number' && changes.value.unit !== undefined ? { unit: unit.value.trim() } : {}),
        ...(kind.value === 'number' && changes.value.siPrefixes !== undefined ? { siPrefixes: siPrefixes.value } : {}),
        ...(changes.value.pinned !== undefined ? { pinned: pinned.value } : {}),
      })
      emit('done', props.attribute.id)
    } else {
      const id = ids.attributeId
      await workspace.apply(attributeCreateCommand(form, { id, inventoryId: snapshot.inventory.id }))
      // A create carries no pin: the pin is a second write. The attribute exists either way, so a failed pin is only
      // reported (it can be turned on in its form) and the form is done.
      if (pinned.value) {
        await workspace.apply({ type: 'attribute.update', id, pinned: true }).catch((e) => toast.error(t(errorMessageKey(e))))
      }
      emit('done', id)
    }
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
      <Label for="attribute-name">{{ $t('form.name') }}</Label>
      <Input
        id="attribute-name"
        v-model="name"
        autocomplete="off"
        :aria-invalid="errorKey ? true : undefined"
        aria-describedby="attribute-name-taken attribute-form-error"
        class="h-11"
      />
      <NameTakenNote id="attribute-name-taken" :taken="nameTaken" :name="name" />
      <p v-if="taken" class="text-sm">
        {{ $t('intakes.attribute.exists', { name: taken.name }) }}
        <button type="button" class="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" @click="emit('useExisting', taken.id)">
          {{ $t('intakes.useExisting', { name: taken.name }) }}
        </button>
      </p>
    </div>
    <div class="grid gap-2">
      <Label id="attribute-kind-label">{{ $t('attributeForm.type') }}</Label>
      <RadioGroup
        v-model="kind"
        aria-labelledby="attribute-kind-label"
        :disabled="!!attribute"
        class="grid grid-cols-3 gap-0.5 rounded-field border border-input bg-field p-1"
      >
        <label
          v-for="k in ['text', 'enum', 'number'] as const"
          :key="k"
          class="flex min-h-11 cursor-pointer items-center gap-3 rounded-chip px-3 text-sm transition-colors duration-(--dur-fast) hover:bg-hover"
        >
          <RadioGroupItem :value="k" />
          {{ $t(k === 'text' ? 'attributeForm.text' : k === 'enum' ? 'attributeForm.list' : 'attributeForm.number') }}
        </label>
      </RadioGroup>
    </div>
    <div v-if="kind === 'enum'" class="grid gap-2">
      <Label for="attribute-options">{{ $t('attributeForm.options') }}</Label>
      <Textarea id="attribute-options" v-model="options" rows="3" autocomplete="off" />
      <p class="text-sm text-subtle-foreground">{{ $t('attributeForm.hint') }}</p>
    </div>
    <template v-if="kind === 'number'">
      <div class="grid gap-2">
        <Label for="attribute-unit">{{ $t('attributeForm.unit') }}</Label>
        <Input id="attribute-unit" v-model="unit" autocomplete="off" :maxlength="MAX_UNIT_LENGTH" class="h-11" />
        <p class="text-sm text-subtle-foreground">{{ $t('attributeForm.unitHint') }}</p>
      </div>
      <div class="grid gap-1">
        <label class="field-text flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
          {{ $t('attributeForm.siPrefixes') }}
          <Switch v-model="siPrefixes" />
        </label>
        <p v-if="example" class="field-text text-sm text-subtle-foreground">{{ $t('attributeForm.siExample', { example }) }}</p>
      </div>
    </template>
    <div v-if="!draft" class="grid gap-1">
      <label class="field-text flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold" :class="pinnedFull && 'cursor-default'">
        {{ $t('attributeForm.showInLists') }}
        <Switch v-model="pinned" :disabled="pinnedFull" aria-describedby="attribute-pinned-hint" />
      </label>
      <p id="attribute-pinned-hint" class="field-text text-sm text-subtle-foreground">
        {{ $t(pinnedFull ? 'attributeForm.pinnedFull' : 'attributeForm.showInListsHint') }}
      </p>
    </div>
    <p id="attribute-form-error" role="alert" class="field-text text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : attribute ? 'attributeForm.save' : draft ? 'intakes.attribute.add' : 'attributeForm.create') }}
    </Button>
  </form>
</template>

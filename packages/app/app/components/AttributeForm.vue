<script setup lang="ts">
import type { Attribute, Id } from '@graymatter/core'
import { newId } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { errorMessageKey } from '~/lib/errors'
import { parseNameList } from '~/lib/lists'

// Creates an inventory attribute or edits one: the name and, for a list, its options. The type can't change afterwards.
const props = defineProps<{ attribute: Attribute | null }>()
const emit = defineEmits<{ done: [attributeId: Id] }>()

const workspace = useWorkspace()
const { state } = workspace

const name = ref(props.attribute?.name ?? '')
const kind = ref<'text' | 'enum'>(props.attribute?.kind ?? 'text')
const options = ref(props.attribute?.options.join('\n') ?? '')
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)
// Editing sends only what differs from the attribute as it was opened: a stale form must not revert another device's
// edit. Options are compared as the text typed, because their order is meaningful.
const baseline = captureBaseline({ name: props.attribute?.name ?? '', options: props.attribute?.options.join('\n') ?? '' })
const changes = computed(() => changedFields(baseline, { name: name.value.trim(), options: options.value.trim() }))
const canSubmit = computed(
  () => !busy.value && !state.readOnly && !!state.snapshot && (!props.attribute || Object.keys(changes.value).length > 0),
)

async function submit(): Promise<void> {
  const snapshot = state.snapshot
  if (!canSubmit.value || !snapshot) return
  const list = kind.value === 'enum' ? parseNameList(options.value) : []
  if (kind.value === 'enum' && list.length === 0) {
    errorKey.value = 'attributeForm.optionsRequired'
    return
  }
  busy.value = true
  errorKey.value = null
  try {
    if (props.attribute) {
      await workspace.apply({
        type: 'attribute.update',
        id: props.attribute.id,
        ...(changes.value.name !== undefined ? { name: changes.value.name } : {}),
        ...(kind.value === 'enum' && changes.value.options !== undefined ? { options: list } : {}),
      })
      emit('done', props.attribute.id)
    } else {
      const id = newId()
      await workspace.apply({
        type: 'attribute.create',
        id,
        inventoryId: snapshot.inventory.id,
        name: name.value.trim(),
        kind: kind.value,
        options: list,
      })
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
  <form class="grid gap-3.5" novalidate @submit.prevent="submit">
    <div class="grid gap-1.5">
      <Label for="attribute-name">{{ $t('form.name') }}</Label>
      <Input
        id="attribute-name"
        v-model="name"
        autocomplete="off"
        :aria-invalid="errorKey ? true : undefined"
        aria-describedby="attribute-form-error"
        class="h-11 rounded-field bg-surface"
      />
    </div>
    <div class="grid gap-1.5">
      <Label id="attribute-kind-label">{{ $t('attributeForm.type') }}</Label>
      <RadioGroup
        v-model="kind"
        aria-labelledby="attribute-kind-label"
        :disabled="!!attribute"
        class="grid grid-cols-2 gap-0.5 rounded-field border border-border bg-background p-1"
      >
        <label
          v-for="k in ['text', 'enum'] as const"
          :key="k"
          class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-sm transition-colors duration-150 hover:bg-hover"
        >
          <RadioGroupItem :value="k" />
          {{ $t(k === 'text' ? 'attributeForm.text' : 'attributeForm.list') }}
        </label>
      </RadioGroup>
    </div>
    <div v-if="kind === 'enum'" class="grid gap-1.5">
      <Label for="attribute-options">{{ $t('attributeForm.options') }}</Label>
      <Textarea id="attribute-options" v-model="options" rows="3" autocomplete="off" class="rounded-field bg-surface" />
      <p class="text-[13px] text-subtle-foreground">{{ $t('attributeForm.hint') }}</p>
    </div>
    <p id="attribute-form-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : attribute ? 'attributeForm.save' : 'attributeForm.create') }}
    </Button>
  </form>
</template>

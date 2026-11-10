<script setup lang="ts">
import type { Variant } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { captureBaseline, changedFields } from '~/lib/changed-fields'
import { errorMessageKey } from '~/lib/errors'

const props = defineProps<{ variant: Variant }>()
const emit = defineEmits<{ done: [] }>()

const workspace = useWorkspace()
const { state } = workspace

const name = ref(props.variant.name)
const description = ref(props.variant.description ?? '')
// The sheet around the form locks while this is set.
const busy = defineModel<boolean>('busy', { default: false })
const errorKey = ref<string | null>(null)
// Only what differs from the variant as it was opened is sent: a stale form must not revert another device's edit.
const baseline = captureBaseline({ name: props.variant.name, description: props.variant.description })
const changes = computed(() =>
  changedFields(
    baseline,
    { name: name.value.trim(), description: description.value.trim() || null },
  ),
)
const canSubmit = computed(() => !busy.value && !state.readOnly && Object.keys(changes.value).length > 0)

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply({
      type: 'variant.update',
      id: props.variant.id,
      ...changes.value,
    })
    emit('done')
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
      <Label for="variant-name">{{ $t('form.name') }}</Label>
      <Input
        id="variant-name"
        v-model="name"
        autocomplete="off"
        :aria-invalid="errorKey ? true : undefined"
        aria-describedby="variant-form-error"
        class="h-11 rounded-field bg-surface"
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="variant-description">
        {{ $t('form.description') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
      </Label>
      <Input id="variant-description" v-model="description" autocomplete="off" class="h-11 rounded-field bg-surface" />
    </div>
    <p id="variant-form-error" role="alert" class="text-sm text-destructive">
      <template v-if="errorKey">{{ $t(errorKey) }}</template>
    </p>
    <Button type="submit" class="h-11 rounded-field" :disabled="!canSubmit">
      {{ $t(busy ? 'status.saving' : 'variantForm.save') }}
    </Button>
  </form>
</template>

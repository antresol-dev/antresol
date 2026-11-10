<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { errorMessageKey } from '~/lib/errors'
import type { ItemView } from '~/lib/item-view'

// The per-variant attribute values of one variant.
const props = defineProps<{ view: ItemView; variantId: Id | null }>()
const emit = defineEmits<{ close: [] }>()

const workspace = useWorkspace()
const { state } = workspace

// What the sheet shows while it animates out.
const shown = shallowRef<{ id: Id; name: string; attributes: { id: Id; name: string; kind: 'text' | 'enum'; options: string[] }[] } | null>(null)
const values = ref<Record<string, string>>({})
const initial = ref<Record<string, string>>({})
const saving = ref(false)
const errorKey = ref<string | null>(null)

watch(
  () => props.variantId,
  (id) => {
    if (!id) return
    const bucket = props.view.buckets.find((b) => b.variantId === id)
    shown.value = {
      id,
      name: bucket?.name ?? '',
      attributes: props.view.attributes.filter((a) => a.perVariant).map((a) => ({ id: a.attributeId, name: a.name, kind: a.kind, options: a.options })),
    }
    const found: Record<string, string> = {}
    for (const v of bucket?.values ?? []) found[v.attributeId] = v.value ?? ''
    values.value = { ...found }
    initial.value = found
    saving.value = false
    errorKey.value = null
  },
  { immediate: true },
)

const open = computed({
  get: () => props.variantId !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})

async function save(): Promise<void> {
  const current = shown.value
  if (!current || saving.value || state.readOnly) return
  saving.value = true
  errorKey.value = null
  try {
    for (const a of current.attributes) {
      const next = (values.value[a.id] ?? '').trim()
      if (next === (initial.value[a.id] ?? '').trim()) continue
      await workspace.apply({ type: 'variant.setAttribute', variantId: current.id, attributeId: a.id, value: next === '' ? null : next })
    }
    emit('close')
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('attributeSheet.variantTitle', { name: shown?.name ?? '' })" :locked="saving">
    <div class="mt-3.5 grid gap-3.5">
      <AttributeValueField
        v-for="a in shown?.attributes ?? []"
        :id="`variant-value-${a.id}`"
        :key="a.id"
        v-model="values[a.id]!"
        :label="a.name"
        :kind="a.kind"
        :options="a.options"
        :disabled="saving"
      />
      <p role="alert" class="text-sm text-destructive">
        <template v-if="errorKey">{{ $t(errorKey) }}</template>
      </p>
    </div>
    <template #footer>
      <Button type="button" class="h-11 rounded-field" :disabled="saving || !!state.readOnly" @click="save">
        {{ $t(saving ? 'status.saving' : 'attributeSheet.save') }}
      </Button>
    </template>
  </AppSheet>
</template>

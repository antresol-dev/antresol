<script setup lang="ts">
import type { Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { errorMessageKey } from '~/lib/errors'
import type { AxisRow, ItemView } from '~/lib/item-view'

// Variants by axes in one table, to fill in the empty values quickly. `variantId` opens the sheet (and marks its row).
const props = defineProps<{ view: ItemView; variantId: Id | null }>()
const emit = defineEmits<{ close: [] }>()

const workspace = useWorkspace()
const { state } = workspace

type Cells = Record<string, string | null>
const key = (variantId: Id, attributeId: Id): string => `${variantId}:${attributeId}`
const rowsOf = (view: ItemView) => view.buckets.filter((b) => b.variantId !== null)

// What the sheet shows while it animates out, and the values as they were when it opened (nothing else is sent).
const axes = shallowRef<AxisRow[]>([])
const rows = shallowRef<{ id: Id; label: string }[]>([])
const values = ref<Cells>({})
const baseline = shallowRef<Cells>({})
const fieldErrors = ref<Record<string, string | null>>({})
const saving = ref(false)
const errorKey = ref<string | null>(null)

watch(
  () => props.variantId,
  (id) => {
    if (!id) return
    axes.value = props.view.axes
    const buckets = rowsOf(props.view)
    rows.value = buckets.map((b) => ({ id: b.variantId!, label: b.name ?? '' }))
    const found: Cells = {}
    for (const b of buckets) for (const v of b.values) found[key(b.variantId!, v.attributeId)] = v.value
    values.value = found
    baseline.value = { ...found }
    fieldErrors.value = {}
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

const changed = computed(() => Object.keys(values.value).filter((k) => (values.value[k] ?? null) !== (baseline.value[k] ?? null)))
const hasFieldError = computed(() => Object.values(fieldErrors.value).some((e) => e))
const canSave = computed(() => !saving.value && !state.readOnly && changed.value.length > 0 && !hasFieldError.value)

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  errorKey.value = null
  try {
    for (const k of changed.value) {
      const [variantId, attributeId] = k.split(':') as [Id, Id]
      await workspace.apply({ type: 'variant.setAttribute', variantId, attributeId, value: values.value[k] ?? null })
      // Written: this cell is no longer pending, so a failure further on does not resend it.
      baseline.value = { ...baseline.value, [k]: values.value[k] ?? null }
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
  <AppSheet v-model:open="open" :title="$t('variantValues.title')" :locked="saving">
    <div class="mt-3.5 grid gap-3.5">
      <p v-if="axes.length === 0" class="text-sm text-muted-foreground">{{ $t('variantValues.empty') }}</p>
      <div v-else class="overflow-x-auto">
        <table class="w-full border-separate border-spacing-x-2 border-spacing-y-1.5 text-sm">
          <thead>
            <tr class="text-left text-[13px] text-subtle-foreground">
              <th v-for="a in axes" :key="a.attributeId" scope="col" class="min-w-32 font-semibold">{{ a.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" :aria-current="r.id === variantId ? 'true' : undefined">
              <td v-for="a in axes" :key="a.attributeId" class="align-top">
                <div class="flex items-center gap-1.5">
                  <AttributeValueField
                    :id="`variant-value-${r.id}-${a.attributeId}`"
                    v-model="values[key(r.id, a.attributeId)]!"
                    class="min-w-0 flex-1"
                    :attribute="a"
                    :disabled="saving"
                    @update:error="(e) => (fieldErrors[key(r.id, a.attributeId)] = e)"
                  />
                  <span v-if="(values[key(r.id, a.attributeId)] ?? null) === null" class="text-muted-foreground" aria-hidden="true">—</span>
                </div>
                <p v-if="fieldErrors[key(r.id, a.attributeId)]" role="alert" class="mt-1 text-xs text-destructive">
                  {{ $t(fieldErrors[key(r.id, a.attributeId)]!) }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p role="alert" class="text-sm text-destructive">
        <template v-if="errorKey">{{ $t(errorKey) }}</template>
      </p>
    </div>
    <template #footer>
      <Button type="button" class="h-11 rounded-field" :disabled="!canSave" @click="save">
        {{ $t(saving ? 'status.saving' : 'variantValues.save') }}
      </Button>
    </template>
  </AppSheet>
</template>

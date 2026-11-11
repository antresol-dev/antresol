<script setup lang="ts">
import type { Attribute } from '@graymatter/core'
import { Pencil, Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { errorMessageKey } from '~/lib/errors'

defineProps<{ rows: { attribute: Attribute; itemCount: number }[] }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

type Target = { kind: 'form'; attribute: Attribute | null } | { kind: 'delete'; attribute: Attribute; count: number }
const target = shallowRef<Target | null>(null)
// The last target stays while a sheet animates out.
const shown = shallowRef<Target | null>(null)
const formBusy = ref(false)
const deleting = ref(false)
const locked = computed(() => !!state.readOnly || state.saving || formBusy.value || deleting.value)

function open(next: Target): void {
  target.value = next
  shown.value = next
}
const sheetOpen = (kind: Target['kind']) =>
  computed({
    get: () => target.value?.kind === kind,
    set: (o: boolean) => {
      if (!o && !formBusy.value && !deleting.value) target.value = null
    },
  })
const formOpen = sheetOpen('form')
const deleteOpen = sheetOpen('delete')

const actions = [
  { key: 'edit', label: 'dictionaries.edit', icon: Pencil },
  { key: 'delete', label: 'dictionaries.delete', icon: Trash2, destructive: true },
]
function select(row: { attribute: Attribute; itemCount: number }, key: string): void {
  if (key === 'edit') open({ kind: 'form', attribute: row.attribute })
  else if (key === 'delete') open({ kind: 'delete', attribute: row.attribute, count: row.itemCount })
}
const typeLabel = (a: Attribute): string =>
  a.kind === 'enum'
    ? t('dictionaries.attributeList', { options: a.options.join(', ') })
    : a.kind === 'number'
      ? t(a.unit ? 'attributeForm.typeNumberUnit' : 'attributeForm.typeNumber', { unit: a.unit })
      : t('dictionaries.attributeText')

async function remove(): Promise<void> {
  const cur = target.value
  if (locked.value || !cur || cur.kind !== 'delete') return
  deleting.value = true
  try {
    await workspace.apply({ type: 'attribute.delete', id: cur.attribute.id })
    target.value = null
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section class="grid min-w-0 gap-2" aria-labelledby="dictionaries-attributes">
    <div class="flex min-h-11 items-center justify-between gap-2 px-1">
      <h2 id="dictionaries-attributes" class="text-[17px] font-bold tracking-[-0.01em] text-foreground">
        {{ $t('dictionaries.attributes') }}
      </h2>
      <!-- Thinner than the default raised button (R(3,7), 40 px): it must not outweigh the section's heading. -->
      <Button variant="ghost" class="raised-sm h-10" :disabled="locked" @click="open({ kind: 'form', attribute: null })">
        <Plus class="size-4" aria-hidden="true" />
        {{ $t('dictionaries.addAttribute') }}
      </Button>
    </div>
    <ul v-if="rows.length > 0">
      <li
        v-for="row in rows"
        :key="row.attribute.id"
        class="relative flex min-h-[62px] items-center gap-3 px-3.5 py-1.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <span class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-[15px] font-bold">{{ row.attribute.name }}</span>
          <span class="truncate text-[13px] text-muted-foreground">{{ typeLabel(row.attribute) }}</span>
        </span>
        <span class="shrink-0 text-[13px] text-muted-foreground">{{ $t('dictionaries.itemCount', row.itemCount) }}</span>
        <RowMenu
          class="size-11"
          :label="row.attribute.name"
          :actions="actions.map((a) => ({ ...a, label: $t(a.label), disabled: locked }))"
          @select="select(row, $event)"
        />
      </li>
    </ul>
    <p v-else class="px-1 text-sm text-muted-foreground">{{ $t('dictionaries.noAttributes') }}</p>

    <AppSheet
      v-model:open="formOpen"
      :title="$t(shown?.kind === 'form' && shown.attribute ? 'dictionaries.attributeEditTitle' : 'dictionaries.attributeNewTitle')"
      :locked="formBusy"
      initial-focus="#attribute-name"
    >
      <AttributeForm
        v-if="shown?.kind === 'form'"
        :key="shown.attribute?.id ?? 'new'"
        v-model:busy="formBusy"
        :attribute="shown.attribute"
        @done="target = null"
      />
    </AppSheet>
    <ConfirmSheet
      v-model:open="deleteOpen"
      :title="$t('dictionaries.attributeDeleteTitle')"
      :description="
        shown?.kind === 'delete'
          ? $t('dictionaries.attributeDeleteConfirm', { name: shown.attribute.name, count: shown.count }, shown.count)
          : ''
      "
      :confirm-label="$t(deleting ? 'status.saving' : 'dictionaries.delete')"
      :busy="deleting"
      destructive
      @confirm="remove"
    />
  </section>
</template>

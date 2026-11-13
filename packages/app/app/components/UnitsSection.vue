<script setup lang="ts">
import type { CustomUnit, UnitDef } from '@antresol/core'
import { Pencil, Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { errorMessageKey } from '~/lib/errors'
import { prefixList } from '~/lib/prefixes'

type Row = { unit: UnitDef; custom: CustomUnit | null; itemCount: number }
defineProps<{ rows: Row[] }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

type Target = { kind: 'form'; unit: CustomUnit | null } | { kind: 'delete'; unit: CustomUnit }
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
function select(row: Row, key: string): void {
  if (!row.custom) return
  open(key === 'edit' ? { kind: 'form', unit: row.custom } : { kind: 'delete', unit: row.custom })
}
async function remove(): Promise<void> {
  const cur = target.value
  if (locked.value || !cur || cur.kind !== 'delete') return
  deleting.value = true
  try {
    await workspace.apply({ type: 'unit.delete', id: cur.unit.id })
    target.value = null
  } catch (e) {
    // unit_in_use: the unit stays; the sheet closes and the reason shows as a message.
    target.value = null
    toast.error(t(errorMessageKey(e)))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section class="grid min-w-0 gap-2" aria-labelledby="dictionaries-units">
    <div class="flex min-h-11 items-center justify-between gap-2">
      <h2 id="dictionaries-units" class="text-base font-semibold tracking-[-0.01em] text-foreground">{{ $t('dictionaries.units') }}</h2>
      <!-- Thinner than the default raised button (R(3,7), 40 px): it must not outweigh the section's heading. -->
      <Button variant="ghost" class="raised-sm h-10" :disabled="locked" @click="open({ kind: 'form', unit: null })">
        <Plus class="size-4" aria-hidden="true" />
        {{ $t('dictionaries.addUnit') }}
      </Button>
    </div>
    <ul class="surface-list">
      <li
        v-for="row in rows"
        :key="row.unit.key"
        class="relative flex min-h-14 items-center gap-3 px-3 py-1.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <span class="flex min-w-0 grow flex-col gap-0.5">
          <span class="truncate text-base font-semibold">{{ row.unit.name }} · {{ row.unit.symbol }}</span>
          <span v-if="row.unit.prefixPowers.length > 0" class="truncate text-sm text-muted-foreground">
            {{ $t('dictionaries.prefixes', { list: prefixList(row.unit) }) }}
          </span>
        </span>
        <span class="shrink-0 text-sm text-muted-foreground">{{ $t('dictionaries.itemCount', row.itemCount) }}</span>
        <span v-if="!row.custom" class="shrink-0 rounded-full bg-chip px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {{ $t('dictionaries.builtIn') }}
        </span>
        <RowMenu
          v-else
          class="size-11"
          :label="row.unit.name"
          :actions="actions.map((a) => ({ ...a, label: $t(a.label), disabled: locked }))"
          @select="select(row, $event)"
        />
      </li>
    </ul>

    <AppSheet
      v-model:open="formOpen"
      :title="$t(shown?.kind === 'form' && shown.unit ? 'dictionaries.unitEditTitle' : 'dictionaries.unitNewTitle')"
      :locked="formBusy"
      initial-focus="#unit-name"
    >
      <UnitForm
        v-if="shown?.kind === 'form'"
        :key="shown.unit?.id ?? 'new'"
        v-model:busy="formBusy"
        :unit="shown.unit"
        @done="target = null"
      />
    </AppSheet>
    <ConfirmSheet
      v-model:open="deleteOpen"
      :title="$t('dictionaries.unitDeleteTitle')"
      :description="shown?.kind === 'delete' ? $t('dictionaries.unitDeleteConfirm', { name: shown.unit.name }) : ''"
      :confirm-label="$t(deleting ? 'status.saving' : 'dictionaries.delete')"
      :busy="deleting"
      destructive
      @confirm="remove"
    />
  </section>
</template>

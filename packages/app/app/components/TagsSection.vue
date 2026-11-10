<script setup lang="ts">
import { newId, type Tag } from '@graymatter/core'
import { Pencil, Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessageKey } from '~/lib/errors'

defineProps<{ rows: { tag: Tag; itemCount: number }[] }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

type Target = { kind: 'create' } | { kind: 'rename'; tag: Tag } | { kind: 'delete'; tag: Tag; count: number }
const target = shallowRef<Target | null>(null)
// The last target stays while a sheet animates out.
const shown = shallowRef<Target | null>(null)
const name = ref('')
const busy = ref(false)
const errorKey = ref<string | null>(null)
const locked = computed(() => !!state.readOnly || state.saving || busy.value)

function open(next: Target): void {
  target.value = next
  shown.value = next
  name.value = next.kind === 'rename' ? next.tag.name : ''
  errorKey.value = null
}
const sheetOpen = (kinds: Target['kind'][]) =>
  computed({
    get: () => !!target.value && kinds.includes(target.value.kind),
    set: (o: boolean) => {
      if (!o && !busy.value) target.value = null
    },
  })
const formOpen = sheetOpen(['create', 'rename'])
const deleteOpen = sheetOpen(['delete'])

const actions = [
  { key: 'rename', label: 'dictionaries.rename', icon: Pencil },
  { key: 'delete', label: 'dictionaries.delete', icon: Trash2, destructive: true },
]
function select(row: { tag: Tag; itemCount: number }, key: string): void {
  if (key === 'rename') open({ kind: 'rename', tag: row.tag })
  else if (key === 'delete') open({ kind: 'delete', tag: row.tag, count: row.itemCount })
}

async function write(command: Parameters<typeof workspace.apply>[0]): Promise<boolean> {
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply(command)
    return true
  } catch (e) {
    errorKey.value = errorMessageKey(e)
    return false
  } finally {
    busy.value = false
  }
}

async function submit(): Promise<void> {
  const cur = target.value
  const snapshot = state.snapshot
  if (locked.value || !snapshot || !cur || cur.kind === 'delete') return
  const ok = await write(
    cur.kind === 'create'
      ? { type: 'tag.create', id: newId(), inventoryId: snapshot.inventory.id, name: name.value.trim() }
      : { type: 'tag.rename', id: cur.tag.id, name: name.value.trim() },
  )
  if (ok) target.value = null
}

async function remove(): Promise<void> {
  const cur = target.value
  if (locked.value || !cur || cur.kind !== 'delete') return
  if (await write({ type: 'tag.delete', id: cur.tag.id })) target.value = null
  else if (errorKey.value) toast.error(t(errorKey.value))
}
</script>

<template>
  <section class="grid min-w-0 gap-2" aria-labelledby="dictionaries-tags">
    <div class="flex min-h-11 items-center justify-between gap-2 px-1">
      <h2 id="dictionaries-tags" class="text-[13px] font-semibold text-subtle-foreground">{{ $t('dictionaries.tags') }}</h2>
      <Button variant="outline" class="h-11 rounded-field bg-surface" :disabled="locked" @click="open({ kind: 'create' })">
        <Plus class="size-4" aria-hidden="true" />
        {{ $t('dictionaries.addTag') }}
      </Button>
    </div>
    <ul v-if="rows.length > 0" class="rounded-card border border-border bg-surface py-1">
      <li
        v-for="row in rows"
        :key="row.tag.id"
        class="relative flex min-h-[54px] items-center gap-3 px-3.5 py-1.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <span class="min-w-0 grow truncate text-[15px] font-bold">{{ row.tag.name }}</span>
        <span class="shrink-0 text-[13px] text-muted-foreground">{{ $t('dictionaries.itemCount', row.itemCount) }}</span>
        <RowMenu
          class="size-11"
          :label="row.tag.name"
          :actions="actions.map((a) => ({ ...a, label: $t(a.label), disabled: locked }))"
          @select="select(row, $event)"
        />
      </li>
    </ul>
    <p v-else class="px-1 text-sm text-muted-foreground">{{ $t('dictionaries.noTags') }}</p>

    <AppSheet
      v-model:open="formOpen"
      :title="$t(shown?.kind === 'rename' ? 'dictionaries.renameTitle' : 'dictionaries.addTitle')"
      :locked="busy"
      initial-focus="#tag-name"
    >
      <form class="grid gap-3.5" novalidate @submit.prevent="submit">
        <div class="grid gap-1.5">
          <Label for="tag-name">{{ $t('form.name') }}</Label>
          <Input
            id="tag-name"
            v-model="name"
            autocomplete="off"
            :aria-invalid="errorKey ? true : undefined"
            aria-describedby="tag-form-error"
            class="h-11 rounded-field bg-surface"
          />
        </div>
        <p id="tag-form-error" role="alert" class="text-sm text-destructive">
          <template v-if="errorKey && formOpen">{{ $t(errorKey) }}</template>
        </p>
        <Button type="submit" class="h-11 rounded-field" :disabled="locked || !state.snapshot">
          {{ $t(busy ? 'status.saving' : shown?.kind === 'rename' ? 'dictionaries.tagSave' : 'dictionaries.tagCreate') }}
        </Button>
      </form>
    </AppSheet>
    <ConfirmSheet
      v-model:open="deleteOpen"
      :title="$t('dictionaries.tagDeleteTitle')"
      :description="
        shown?.kind === 'delete' ? $t('dictionaries.tagDeleteConfirm', { name: shown.tag.name, count: shown.count }) : ''
      "
      :confirm-label="$t(busy ? 'status.saving' : 'dictionaries.delete')"
      :busy="busy"
      destructive
      @confirm="remove"
    />
  </section>
</template>

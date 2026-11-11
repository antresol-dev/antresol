<script setup lang="ts">
import type { Id, Quantity } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'vue-sonner'
import { applyCounts, countChanges, countRows, renewCountId, type CountIds, type CountRow } from '~/lib/count-folder'
import { errorMessageKey } from '~/lib/errors'
import { isUnknownOutcome } from '~/lib/unconfirmed'
import { folderView } from '~/lib/views'

// "Count this folder" (spec 4.14): every bucket of the folder's own items with its stock filled in; changed rows are
// marked; "Apply N changes" sends one stock.set per changed row, one after another, with ids kept until each lands. A
// failure stops there: what landed stays, the row that did not is marked, the rest stay changed for the next Apply.
const props = defineProps<{ folderId: Id }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const snapshot = computed(() => state.snapshot)
const view = computed(() => (snapshot.value ? folderView(snapshot.value, props.folderId) : null))
const rows = computed(() => (snapshot.value ? countRows(snapshot.value, props.folderId) : null))

const title = computed(() => (view.value?.folder ? t('countFolder.title', { name: view.value.folder.name }) : t('countFolder.menu')))
const crumbs = computed(() => {
  const s = snapshot.value
  const v = view.value
  if (!s || !v?.folder) return []
  return [{ name: s.inventory.name, to: '/' }, ...v.crumbs.map((c) => ({ name: c.name, to: `/folder/${c.id}` }))]
})

/** What was typed, by row key; a row without an entry follows the stock. */
const entries = reactive(new Map<string, string>())
/** The movementId of each row's count until it lands: a retry of the same number sends the same command, another
 *  number a new one (applyCounts). */
const ids: CountIds = new Map()
/** `unknown`: the source did not answer, so the count may have landed ("Not confirmed"; Apply again is safe). */
const failed = ref<{ key: string; messageKey: string; unknown: boolean } | null>(null)
const progress = ref<{ done: number; total: number } | null>(null)
const busy = computed(() => progress.value !== null)

const changes = computed(() => (rows.value ? countChanges(rows.value, entries) : []))
const changeOf = computed(() => new Map(changes.value.map((c) => [c.row.key, c] as const)))
const ready = computed(() => changes.value.filter((c): c is { row: CountRow; target: Quantity } => c.target !== null))
const bad = computed(() => changes.value.length - ready.value.length)
const canApply = computed(() => !busy.value && !state.readOnly && ready.value.length > 0 && bad.value === 0)

/** Items in name order; an item with variants gets a heading row above its variants. */
const groups = computed(() => {
  const list: { itemId: Id; name: string; hasVariants: boolean; rows: CountRow[] }[] = []
  for (const row of rows.value ?? []) {
    if (row.first) list.push({ itemId: row.itemId, name: row.itemName, hasVariants: row.hasVariants, rows: [] })
    list.at(-1)?.rows.push(row)
  }
  return list
})
const labelOf = (row: CountRow): string => (row.variantName === null ? row.itemName : `${row.itemName} · ${row.variantName}`)

function edit(row: CountRow, text: string | number): void {
  entries.set(row.key, String(text))
  renewCountId(ids, row.key)
  if (failed.value?.key === row.key) failed.value = null
}

// Enter (the keyboard's "Next") goes to the next row's field: a drawer is counted without other taps.
const list = useTemplateRef<HTMLElement>('list')
function next(event: KeyboardEvent): void {
  const fields = [...(list.value?.querySelectorAll<HTMLInputElement>('input[data-count]') ?? [])]
  const following = fields[fields.indexOf(event.target as HTMLInputElement) + 1]
  if (following) following.focus()
  else (event.target as HTMLElement).blur()
}
function selectAll(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) event.target.select()
}

async function apply(): Promise<void> {
  const cur = state.current
  if (!canApply.value || !cur) return
  const batch = ready.value
  const target = { ...cur }
  failed.value = null
  progress.value = { done: 0, total: batch.length }
  const result = await applyCounts(batch, ids, (command) => workspace.applyTo(target, command), (done) => {
    progress.value = { done, total: batch.length }
  })
  // What landed is the stock now: those rows follow it again.
  for (const c of batch.slice(0, result.done)) entries.delete(c.row.key)
  progress.value = null
  if (result.failed) {
    const { key, error } = result.failed
    failed.value = { key, messageKey: errorMessageKey(error), unknown: isUnknownOutcome(error) }
  } else {
    toast.success(t('countFolder.saved', result.done))
  }
}

onBeforeRouteLeave(() => changes.value.length === 0 || window.confirm(t('countFolder.leave')))

const linkClass =
  'min-h-11 content-center rounded-chip text-sm font-semibold text-accent-ink underline-offset-4 hover:underline'
const divider =
  "relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
</script>

<template>
  <ScreenHeader :title="title" :crumbs="crumbs" wrap-title />
  <ScreenBody>
    <template v-if="rows">
      <EmptyState v-if="rows.length === 0" :text="$t('countFolder.empty')">
        <NuxtLink :to="`/folder/${folderId}`" :class="linkClass">{{ $t('countFolder.back') }}</NuxtLink>
      </EmptyState>
      <template v-else>
        <p class="px-1 text-sm text-muted-foreground">{{ $t('countFolder.hint') }}</p>
        <ul ref="list">
          <template v-for="g in groups" :key="g.itemId">
            <li v-if="g.hasVariants" :class="[divider, 'px-3.5 pt-2.5 pb-1 text-[15px] font-bold wrap-anywhere']">{{ g.name }}</li>
            <li
              v-for="row in g.rows"
              :key="row.key"
              :class="[divider, 'flex min-h-[58px] items-center gap-3 py-1.5 pr-3.5', g.hasVariants ? 'pl-7' : 'pl-3.5', changeOf.has(row.key) && 'rounded-field bg-accent-soft']"
            >
              <label :for="`count-${row.key}`" class="flex min-w-0 grow flex-col gap-0.5">
                <span class="line-clamp-2 text-[15px] wrap-anywhere" :class="g.hasVariants ? 'font-semibold' : 'font-bold'">
                  {{ row.variantName ?? row.itemName }}
                </span>
                <span v-if="changeOf.get(row.key)?.target === null" class="text-[13px] text-destructive">{{ $t('countFolder.invalid') }}</span>
                <span v-else-if="failed?.key === row.key" class="text-[13px] text-destructive">
                  {{ $t(failed.unknown ? 'countFolder.notConfirmed' : 'countFolder.notSaved', { reason: $t(failed.messageKey) }) }}
                </span>
                <span v-else-if="changeOf.has(row.key)" class="text-[13px] text-muted-foreground tabular-nums">
                  {{ $t('countFolder.was', { amount: `${row.number} ${row.unit}` }) }}
                </span>
              </label>
              <div class="relative w-32 shrink-0">
                <Input
                  :id="`count-${row.key}`"
                  data-count
                  :model-value="entries.get(row.key) ?? row.quantity"
                  inputmode="decimal"
                  enterkeyhint="next"
                  autocomplete="off"
                  :aria-label="$t('countFolder.field', { name: labelOf(row) })"
                  :aria-invalid="changeOf.get(row.key)?.target === null ? true : undefined"
                  :readonly="busy"
                  class="h-11 pr-12 text-right font-bold tabular-nums"
                  @update:model-value="(v) => edit(row, v)"
                  @keydown.enter.prevent="next"
                  @focus="selectAll"
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-muted-foreground">
                  {{ row.unitDef.symbol }}
                </span>
              </div>
            </li>
          </template>
        </ul>
        <div
          v-if="changes.length > 0 || busy || failed"
          class="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-border bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:-mx-7 lg:px-7"
        >
          <p role="status" class="min-w-0 grow text-sm" :class="failed && !busy ? 'text-destructive' : 'text-muted-foreground'">
            <template v-if="progress">{{ $t('countFolder.saving', { done: progress.done, total: progress.total }) }}</template>
            <template v-else-if="failed">{{ $t('countFolder.stopped', changes.length) }}</template>
            <template v-else-if="bad > 0">{{ $t('countFolder.fixFirst', bad) }}</template>
          </p>
          <Button class="h-11 shrink-0 rounded-field px-4 font-bold" :disabled="!canApply" @click="apply">
            {{ $t('countFolder.apply', ready.length) }}
          </Button>
        </div>
      </template>
    </template>
    <EmptyState v-else-if="snapshot" :text="$t('countFolder.gone')">
      <NuxtLink to="/" :class="linkClass">{{ $t('empty.backTo', { name: snapshot.inventory.name }) }}</NuxtLink>
    </EmptyState>
    <div v-else class="grid grid-cols-1 gap-3.5" aria-hidden="true">
      <Skeleton class="h-40 rounded-card" />
    </div>
  </ScreenBody>
</template>

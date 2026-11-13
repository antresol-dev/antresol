<script setup lang="ts">
import { axisRemovalPreview, type Id } from '@antresol/core'
import { ArrowDown, ArrowUp, Link2, ListOrdered, Plus, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { axesSummary, axisRemovalNotice, movedAxes, type AxisRemovalNotice } from '~/lib/axes'
import { errorMessageKey } from '~/lib/errors'
import type { ItemView } from '~/lib/item-view'

// The head of the variants section: what the variants differ by, and the menu that changes it (add an attribute, reorder,
// make one shared, remove one). Making an axis shared or removing it shows what that would do first.
const props = defineProps<{ view: ItemView }>()

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace
const { add: addAxis, loss: axisLoss } = useAddAxis()

const itemId = computed(() => props.view.item.id)
const summary = computed(() => axesSummary(props.view.axes))
const busy = ref(false)
const formBusy = ref(false)
const locked = computed(() => !!state.readOnly || state.saving || busy.value)
const errorKey = ref<string | null>(null)

const actions = computed(() => [
  { key: 'add', label: t('axes.add'), icon: Plus, disabled: locked.value },
  ...(props.view.axes.length > 1 ? [{ key: 'reorder', label: t('axes.reorder'), icon: ListOrdered, disabled: locked.value }] : []),
  ...props.view.axes.map((a) => ({ key: `share:${a.attributeId}`, label: t('axes.makeShared', { name: a.name }), icon: Link2, disabled: locked.value })),
  ...props.view.axes.map((a) => ({ key: `remove:${a.attributeId}`, label: t('axes.remove', { name: a.name }), icon: Trash2, destructive: true, disabled: locked.value })),
])

// --- Add an attribute the variants differ by.
const NEW = '\u0000new'
const addOpen = ref(false)
const choice = ref('')
const choices = computed(() => {
  const axes = new Set(props.view.axes.map((a) => a.attributeId))
  return (state.snapshot?.attributes ?? []).filter((a) => !axes.has(a.id)).sort((a, b) => a.name.localeCompare(b.name))
})
const creating = computed(() => choice.value === NEW)
const addLocked = computed(() => busy.value || formBusy.value)
function openAdd(): void {
  errorKey.value = null
  choice.value = choices.value[0]?.id ?? NEW
  addOpen.value = true
}
const addSheetOpen = computed({
  get: () => addOpen.value,
  set: (open: boolean) => {
    if (!open && !addLocked.value) addOpen.value = false
  },
})
// A shared value the new axis would drop (another axis exists and there are no variants to take it) is confirmed first.
// The item always has an axis here, so the new one never makes a first variant and there is no stock offer to make.
const dropLoss = ref<{ name: string; value: string } | null>(null)
const dropShown = shallowRef<{ name: string; value: string } | null>(null)
const dropOpen = computed({
  get: () => dropLoss.value !== null,
  set: (open: boolean) => {
    if (!open && !busy.value) dropLoss.value = null
  },
})
function submitAdd(): void {
  if (addLocked.value || state.readOnly || creating.value || !choice.value) return
  const loss = axisLoss(itemId.value, choice.value)
  if (!loss) return void applyAdd()
  dropShown.value = loss
  dropLoss.value = loss
}
async function applyAdd(): Promise<void> {
  if (busy.value || state.readOnly || !choice.value) return
  busy.value = true
  errorKey.value = null
  try {
    await addAxis(itemId.value, choice.value)
    addOpen.value = false
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    dropLoss.value = null
    busy.value = false
  }
}

// --- Reorder: each step writes at once.
const reorderOpen = ref(false)
async function move(id: Id, direction: 'up' | 'down'): Promise<void> {
  const ids = props.view.axes.map((a) => a.attributeId)
  const next = movedAxes(ids, id, direction)
  if (next === ids || busy.value || state.readOnly) return
  busy.value = true
  errorKey.value = null
  try {
    await workspace.apply({ type: 'item.reorderAxes', itemId: itemId.value, attributeIds: next })
  } catch (e) {
    errorKey.value = errorMessageKey(e)
  } finally {
    busy.value = false
  }
}

// --- Make shared / remove, after the preview.
interface Pending {
  mode: 'share' | 'remove'
  attributeId: Id
  name: string
  notice: AxisRemovalNotice
}
const pending = ref<Pending | null>(null)
// What the sheet shows while it animates out.
const shown = shallowRef<Pending | null>(null)
const pendingOpen = computed({
  get: () => pending.value !== null,
  set: (open: boolean) => {
    if (!open && !busy.value) pending.value = null
  },
})
async function askRemoval(mode: Pending['mode'], attributeId: Id): Promise<void> {
  const s = state.snapshot
  const axis = props.view.axes.find((a) => a.attributeId === attributeId)
  if (!s || !axis) return
  const next = { mode, attributeId, name: axis.name, notice: axisRemovalNotice(s, axisRemovalPreview(s, itemId.value, attributeId)) }
  errorKey.value = null
  // Nothing is lost and nothing is in the way: no question to ask.
  if (next.notice.kind === 'none') return void (await confirmRemoval(next))
  shown.value = next
  pending.value = next
}
async function confirmRemoval(p: Pending | null = pending.value): Promise<void> {
  if (!p || p.notice.kind === 'blocked' || busy.value) return
  busy.value = true
  try {
    await workspace.apply(
      p.mode === 'share'
        ? { type: 'item.removeAxis', itemId: itemId.value, attributeId: p.attributeId }
        : { type: 'item.removeAttribute', itemId: itemId.value, attributeId: p.attributeId },
    )
    pending.value = null
  } catch (e) {
    errorKey.value = errorMessageKey(e)
    pending.value = null
  } finally {
    busy.value = false
  }
}

function select(key: string): void {
  if (key === 'add') openAdd()
  else if (key === 'reorder') reorderOpen.value = true
  else if (key.startsWith('share:')) void askRemoval('share', key.slice(6))
  else if (key.startsWith('remove:')) void askRemoval('remove', key.slice(7))
}
</script>

<template>
  <div class="grid gap-1">
    <div class="flex min-h-11 items-center justify-between gap-2">
      <h2 class="min-w-0 section-label text-[15px] wrap-anywhere">
        {{ $t('item.variantsTitle') }}
        <span v-if="summary" class="font-normal">{{ $t('axes.by', { axes: summary }) }}</span>
      </h2>
      <RowMenu class="size-11" :label="$t('item.variantsTitle')" :button-label="$t('axes.menu')" :actions="actions" @select="select" />
    </div>
    <p v-if="errorKey && !addOpen" role="alert" class="px-1 text-sm text-destructive">{{ $t(errorKey) }}</p>

    <AppSheet v-model:open="addSheetOpen" :title="$t('axes.addTitle')" :description="$t('axes.addHint')" :locked="addLocked">
      <div class="mt-3.5 grid gap-3.5">
        <div class="grid gap-1.5">
          <Label for="axis-choice">{{ $t('attributeSheet.attribute') }}</Label>
          <Select v-model="choice" :disabled="addLocked">
            <SelectTrigger id="axis-choice" class="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="a in choices" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
              <SelectItem :value="NEW">{{ $t('attributeSheet.newAttribute') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AttributeForm v-if="creating" v-model:busy="formBusy" :attribute="null" @done="(id) => (choice = id)" />
        <p v-else role="alert" class="text-sm text-destructive">
          <template v-if="errorKey">{{ $t(errorKey) }}</template>
        </p>
      </div>
      <template v-if="!creating" #footer>
        <Button type="button" data-primary class="h-11 rounded-field" :disabled="addLocked || !!state.readOnly || !choice" @click="submitAdd">
          {{ $t(busy ? 'status.saving' : 'axes.addConfirm') }}
        </Button>
      </template>
    </AppSheet>

    <ConfirmSheet
      v-model:open="dropOpen"
      :title="$t('axes.dropTitle', { name: dropShown?.name ?? '' })"
      :description="$t('axes.dropBody', { name: dropShown?.name ?? '', value: dropShown?.value ?? '' })"
      :confirm-label="$t(busy ? 'status.saving' : 'axes.dropConfirm')"
      :busy="busy"
      destructive
      @confirm="applyAdd"
    />

    <AppSheet v-model:open="reorderOpen" :title="$t('axes.reorderTitle')" :locked="busy">
      <ol class="mt-3.5 grid divide-y divide-divider">
        <li v-for="(a, n) in view.axes" :key="a.attributeId" class="flex min-h-12 items-center justify-between gap-2 pl-1">
          <span class="min-w-0 text-[15px] font-semibold wrap-anywhere">{{ a.name }}</span>
          <span class="flex shrink-0">
            <Button
              variant="ghost"
              size="icon"
              class="size-11"
              :aria-label="$t('axes.moveUp', { name: a.name })"
              :disabled="locked || n === 0"
              @click="move(a.attributeId, 'up')"
            >
              <ArrowUp class="size-5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-11"
              :aria-label="$t('axes.moveDown', { name: a.name })"
              :disabled="locked || n === view.axes.length - 1"
              @click="move(a.attributeId, 'down')"
            >
              <ArrowDown class="size-5" aria-hidden="true" />
            </Button>
          </span>
        </li>
      </ol>
      <p role="alert" class="mt-2 text-sm text-destructive">
        <template v-if="errorKey">{{ $t(errorKey) }}</template>
      </p>
    </AppSheet>

    <AppSheet
      v-model:open="pendingOpen"
      :title="$t(shown?.mode === 'share' ? 'axes.shareTitle' : 'axes.removeTitle', { name: shown?.name ?? '' })"
      :locked="busy"
    >
      <div v-if="shown" class="mt-3.5 grid gap-2.5 text-sm">
        <template v-if="shown.notice.kind === 'blocked'">
          <p role="alert" class="text-destructive">{{ $t(shown.notice.messageKey) }}</p>
          <template v-if="shown.notice.groups.length > 0">
            <p class="text-muted-foreground">{{ $t('axes.collisions') }}</p>
            <ul class="grid gap-1">
              <li v-for="g in shown.notice.groups" :key="g" class="rounded-field bg-chip px-3 py-2 wrap-anywhere">{{ g }}</li>
            </ul>
          </template>
        </template>
        <template v-else-if="shown.notice.kind === 'confirm'">
          <p>
            {{
              shown.mode === 'share' && shown.notice.sharedValue !== null
                ? $t('axes.shareSame', { name: shown.name })
                : $t(shown.mode === 'share' ? 'axes.shareLoses' : 'axes.removeLoses', { name: shown.name })
            }}
          </p>
          <ul class="grid gap-1">
            <li v-for="v in shown.notice.values" :key="v.variantId" class="rounded-field bg-chip px-3 py-2 wrap-anywhere">{{ v.label }}</li>
          </ul>
        </template>
      </div>
      <template #footer>
        <Button
          type="button"
          data-primary
          :variant="shown?.mode === 'remove' ? 'destructive' : 'default'"
          class="h-11 rounded-field"
          :disabled="busy || shown?.notice.kind === 'blocked'"
          @click="confirmRemoval()"
        >
          {{ $t(busy ? 'status.saving' : shown?.mode === 'share' ? 'axes.shareConfirm' : 'axes.removeConfirm') }}
        </Button>
        <Button type="button" variant="outline" class="h-11" :disabled="busy" @click="pendingOpen = false">
          {{ $t('ui.cancel') }}
        </Button>
      </template>
    </AppSheet>
  </div>
</template>

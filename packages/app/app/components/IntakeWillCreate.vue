<script setup lang="ts">
import {
  draftAttribute,
  type DraftNewAttribute,
  type DraftNewTag,
  type DraftNewUnit,
  type EntityProblem,
  type Id,
  type IntakeDraftContent,
  type InventorySnapshot,
  type ResolvedIntake,
} from '@antresol/core'
import { ChevronDown, Folder, Pencil, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { colorVars } from '~/lib/item-colors'
import { nameClash, useExisting, withNewAttribute } from '~/lib/intake-draft'
import { folderGroups } from '~/lib/intake-entities'
import {
  itemsUsingValue,
  linesUsingAttribute,
  linesUsingValue,
  similarAttributes,
  similarUnits,
  undoTo,
  unitTaken,
  withEditedTag,
  withRenamedAddedValue,
  withoutAddedValue,
  withoutAttributeEverywhere,
  withoutTagEverywhere,
  withoutUnitEverywhere,
} from '~/lib/intake-parts'
import { UNDO_MIN_MS } from '~/lib/undo'

// "Will be created" on a draft intake's screen (spec 2026-11-16 §4, 2026-11-17 §6): the draft's folders (compact trees
// under their nearest existing parent), units, attributes, tags, values added to lists and new items. A block with
// nothing in it is not shown. Each row is edited in its own sheet; nothing is created here: a unit, attribute, tag or
// value goes when no item uses it, and "Remove from all items" takes it off every item at once. A folder or an attribute
// that the commit would refuse shows why, with "Use existing" where the cause is a name that is taken. Folders and new
// items fold behind their title when there are more than three.
const props = defineProps<{
  content: IntakeDraftContent
  snapshot: InventorySnapshot
  resolved: ResolvedIntake
  readOnly: boolean
  edit: (change: (c: IntakeDraftContent) => IntakeDraftContent) => Promise<boolean>
}>()
/** A draft folder was tapped: the screen opens its sheet. */
const emit = defineEmits<{ 'open-folder': [id: Id] }>()

const { t } = useI18n()
const uid = useId()

const groups = computed(() => folderGroups(props.snapshot, props.content))
const attributes = computed(() => props.content.newAttributes ?? [])
const units = computed(() => props.content.newUnits ?? [])
const tags = computed(() => props.content.newTags ?? [])
const options = computed(() =>
  (props.content.addedOptions ?? []).flatMap((o) =>
    o.values.map((value) => ({
      key: `${o.attributeId}:${value}`,
      attributeId: o.attributeId,
      value,
      name: props.snapshot.attributes.find((a) => a.id === o.attributeId)?.name ?? '',
      lines: linesUsingValue(props.content, o.attributeId, value),
      items: itemsUsingValue(props.content, o.attributeId, value),
    })),
  ),
)
const items = computed(() => props.content.newItems)
const problems = computed(() => new Map(props.resolved.entities.map((e) => [e.id, e.problem] as const)))
const problemOf = (id: Id): EntityProblem | null => problems.value.get(id) ?? null
const problemKey = (p: EntityProblem): string => `intakes.entity.problem.${p.code}`
const folderCount = computed(() => groups.value.reduce((n, g) => n + g.folders.length, 0))

/** Folders and new items fold when there are more than COLLAPSE_AFTER of them; a block with a problem in it starts open. */
const COLLAPSE_AFTER = 3
const foldersOpen = ref<boolean | null>(null)
const itemsOpen = ref<boolean | null>(null)
/** What a folded block holds, in a line: "Anchors, Cables, Fasteners…". */
const folderNames = computed(() => groups.value.flatMap((g) => g.folders.map(({ folder }) => folder.name)).join(', '))
const itemNames = computed(() => items.value.map((i) => i.name).join(', '))
const foldersFold = computed(() => folderCount.value > COLLAPSE_AFTER)
const itemsFold = computed(() => items.value.length > COLLAPSE_AFTER)
const foldersShown = computed(() => !foldersFold.value || (foldersOpen.value ?? groups.value.some((g) => g.folders.some(({ folder }) => problemOf(folder.id)))))
const itemsShown = computed(() => !itemsFold.value || (itemsOpen.value ?? items.value.some((i) => problemOf(i.id))))

const existingName = (id: Id): string =>
  props.snapshot.folders.find((f) => f.id === id)?.name ??
  props.snapshot.attributes.find((a) => a.id === id)?.name ??
  (props.content.newFolders ?? []).find((f) => f.id === id)?.name ??
  ''
/** The existing entity a duplicate-name problem points at (a draft one is not "existing"). */
function existingOf(p: EntityProblem | null): Id | null {
  if (p?.code !== 'duplicate_name') return null
  const id = p.existingId
  return props.snapshot.folders.some((f) => f.id === id) || props.snapshot.attributes.some((a) => a.id === id) ? id : null
}
function takeExisting(draftId: Id, existingId: Id): void {
  void props.edit((c) => useExisting(c, draftId, existingId))
}

const kindText = (a: DraftNewAttribute): string =>
  [t(a.kind === 'text' ? 'attributeForm.text' : a.kind === 'enum' ? 'attributeForm.list' : 'attributeForm.number'), a.unit || null, a.siPrefixes ? t('intakes.screen.siPrefixes') : null, a.pinned ? t('intakes.attribute.pinned') : null]
    .filter(Boolean)
    .join(', ')

// ---- Attributes: edit in the form's draft mode, remove ----
const editing = ref<DraftNewAttribute | null>(null)
const editOpen = ref(false)
const formBusy = ref(false)
function openAttribute(a: DraftNewAttribute): void {
  editing.value = a
  editOpen.value = true
}
const editingAttribute = computed(() => (editing.value ? draftAttribute(editing.value, props.snapshot.inventory.id) : null))
const clash = (name: string) => {
  const hit = nameClash(props.snapshot, props.content, { kind: 'attribute', name }, editing.value?.id)
  return hit && name.trim() !== '' ? { id: hit.id, name: props.snapshot.attributes.find((a) => a.id === hit.id)?.name ?? (props.content.newAttributes ?? []).find((a) => a.id === hit.id)?.name ?? name.trim() } : null
}
async function saveAttribute(a: DraftNewAttribute): Promise<void> {
  const next = withNewAttribute(props.content, props.snapshot, a)
  if ('errorKey' in next) {
    toast.error(t(next.errorKey, next.params ?? {}))
    return
  }
  formBusy.value = true
  try {
    if (await props.edit((c) => {
      const r = withNewAttribute(c, props.snapshot, a)
      return 'errorKey' in r ? c : r
    })) editOpen.value = false
  } finally {
    formBusy.value = false
  }
}
async function useExistingAttribute(existingId: Id): Promise<void> {
  const draftId = editing.value?.id
  if (!draftId) return
  if (await props.edit((c) => useExisting(c, draftId, existingId))) editOpen.value = false
}
const otherPinned = computed(() => (props.content.newAttributes ?? []).filter((a) => a.pinned && a.id !== editing.value?.id).length)
const similarAttribute = (name: string) => similarAttributes(props.snapshot, props.content, name, editing.value?.id)

/** Takes something off every item at once; Undo puts the draft back while nothing else was changed after it. */
async function removeEverywhere(next: (c: IntakeDraftContent) => IntakeDraftContent, message: string): Promise<void> {
  if (props.readOnly) return
  const before = props.content
  const after = next(before)
  if (!(await props.edit(next))) return
  toast(message, { duration: UNDO_MIN_MS, action: { label: t('undo.action'), onClick: () => void props.edit(undoTo(before, after)) } })
}
/** What waits for a yes: removing something that takes lines with it asks first, naming how many. */
const confirm = ref<{ title: string; description: string; run: () => void } | null>(null)
const confirmOpen = ref(false)
function ask(title: string, description: string, run: () => void): void {
  confirm.value = { title, description, run }
  confirmOpen.value = true
}
function confirmed(): void {
  const c = confirm.value
  confirmOpen.value = false
  confirm.value = null
  c?.run()
}
function removeAttribute(a: DraftNewAttribute): void {
  const lines = linesUsingAttribute(props.content, a.id)
  const run = () => removeEverywhere((c) => withoutAttributeEverywhere(c, a.id), lines > 0 ? t('intakes.attribute.removedLines', { name: a.name, count: lines }, lines) : t('intakes.attribute.removed', { name: a.name }))
  if (lines === 0) void run()
  else ask(t('intakes.attribute.confirmTitle', { name: a.name, count: lines }, lines), t('intakes.attribute.confirmLines', { name: a.name }, lines), () => void run())
}
const removeUnit = (u: DraftNewUnit) => removeEverywhere((c) => withoutUnitEverywhere(c, u.id), t('intakes.unit.removed', { name: u.name }))
const removeTag = (x: DraftNewTag) => removeEverywhere((c) => withoutTagEverywhere(c, x.id), t('intakes.tag.removed', { name: x.name }))
function removeOption(o: { attributeId: Id; value: string }): void {
  const lines = linesUsingValue(props.content, o.attributeId, o.value)
  const run = () => removeEverywhere((c) => withoutAddedValue(c, o.attributeId, o.value), lines > 0 ? t('intakes.option.removedLines', { value: o.value, count: lines }, lines) : t('intakes.option.removed', { value: o.value }))
  if (lines === 0) void run()
  else ask(t('intakes.option.confirmTitle', { value: o.value, count: lines }, lines), t('intakes.option.confirmLines', { value: o.value }, lines), () => void run())
}

// ---- Units: edit in the form's draft mode ----
const unitEditing = ref<DraftNewUnit | null>(null)
const unitOpen = ref(false)
const unitBusy = ref(false)
function openUnit(u: DraftNewUnit): void {
  unitEditing.value = u
  unitOpen.value = true
}
async function saveUnit(u: DraftNewUnit): Promise<void> {
  unitBusy.value = true
  try {
    if (await props.edit((c) => ({ ...c, newUnits: (c.newUnits ?? []).map((x) => (x.id === u.id ? u : x)) }))) unitOpen.value = false
  } finally {
    unitBusy.value = false
  }
}
const unitIsTaken = (part: { name?: string; symbol?: string }) => unitTaken(props.snapshot, props.content, part, unitEditing.value?.id)
const similarUnit = (name: string) => similarUnits(props.snapshot, props.content, name, unitEditing.value?.id)

// ---- Tags: name and colour ----
const tagEditing = ref<DraftNewTag | null>(null)
const tagOpen = ref(false)
const tagName = ref('')
const tagColor = ref<string | null>(null)
const tagError = ref<string | null>(null)
function openTag(x: DraftNewTag): void {
  tagEditing.value = x
  tagName.value = x.name
  tagColor.value = x.color ?? null
  tagError.value = null
  tagOpen.value = true
}
async function saveTag(): Promise<void> {
  const x = tagEditing.value
  if (!x) return
  const next = withEditedTag(props.content, props.snapshot, x.id, { name: tagName.value, color: tagColor.value })
  if ('errorKey' in next) {
    tagError.value = t(next.errorKey, next.params ?? {})
    return
  }
  if (await props.edit((c) => {
    const r = withEditedTag(c, props.snapshot, x.id, { name: tagName.value, color: tagColor.value })
    return 'errorKey' in r ? c : r
  })) tagOpen.value = false
}

// ---- Values added to lists ----
const optionEditing = ref<{ attributeId: Id; value: string; name: string } | null>(null)
const optionOpen = ref(false)
const optionText = ref('')
const optionError = ref<string | null>(null)
function openOption(o: { attributeId: Id; value: string; name: string }): void {
  optionEditing.value = o
  optionText.value = o.value
  optionError.value = null
  optionOpen.value = true
}
async function saveOption(): Promise<void> {
  const o = optionEditing.value
  if (!o) return
  const next = withRenamedAddedValue(props.content, props.snapshot, o.attributeId, o.value, optionText.value)
  if ('errorKey' in next) {
    optionError.value = t(next.errorKey, next.params ?? {})
    return
  }
  if (await props.edit((c) => {
    const r = withRenamedAddedValue(c, props.snapshot, o.attributeId, o.value, optionText.value)
    return 'errorKey' in r ? c : r
  })) optionOpen.value = false
}

// A row is the rounded element that carries the hover highlight and fills the list's row edge to edge (like FolderList);
// its control keeps the padding and the focus ring, side actions sit in the same row, 6 px off the row's right edge; a two-line row keeps 8 px above and below its text.
const dividerClass =
  "relative not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
const rowClass = `${dividerClass} flex min-h-11 min-w-0 items-center gap-2 rounded-field pr-1.5 transition-colors duration-(--dur-fast)`
const infoRowClass = `${dividerClass} flex min-h-9 min-w-0 items-center gap-2 px-3 py-1`
const hoverClass = computed(() => (props.readOnly ? '' : 'hover:bg-hover'))
const tapClass =
  'flex min-h-11 min-w-0 grow items-center gap-2 rounded-field px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none'
/** A block's title that folds it: the title's own inset, a 44 px target. */
const foldTitle =
  'flex min-h-11 w-full min-w-0 items-center gap-2 rounded-field px-3 text-left text-sm font-semibold text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const existingLink =
  'inline-flex min-h-11 mr-2 max-w-[45%] min-w-0 items-center rounded-chip px-1 text-sm font-semibold underline underline-offset-2 hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
</script>

<template>
  <section v-if="groups.length > 0 || units.length > 0 || attributes.length > 0 || tags.length > 0 || options.length > 0 || items.length > 0" class="grid min-w-0 grid-cols-1 gap-3" :aria-label="$t('intakes.willCreate.title')">
    <h2 class="section-label px-3 text-xs">{{ $t('intakes.willCreate.title') }}</h2>

    <div v-if="groups.length > 0" class="grid min-w-0 grid-cols-1 gap-1">
      <h3 v-if="!foldersFold" class="px-3 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.folders') }}</h3>
      <h3 v-else class="min-w-0">
        <button type="button" :class="foldTitle" :aria-expanded="foldersShown" :aria-controls="`${uid}-folders`" @click="foldersOpen = !foldersShown">
          <span class="shrink-0">{{ $t('intakes.willCreate.folders') }}</span>
          <span class="shrink-0 font-normal tabular-nums">{{ folderCount }}</span>
          <span v-if="!foldersShown" class="min-w-0 truncate font-normal">{{ folderNames }}</span>
          <ChevronDown class="ml-auto size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="foldersShown ? 'rotate-180' : ''" aria-hidden="true" />
        </button>
      </h3>
      <ul v-if="foldersShown" :id="`${uid}-folders`" class="surface-list">
        <template v-for="group in groups" :key="group.parentId ?? 'root'">
          <li v-if="group.context.length > 0" :class="infoRowClass" class="text-sm text-muted-foreground">
            <Folder class="size-4 shrink-0 text-icon" aria-hidden="true" />
            <span class="min-w-0 truncate">{{ group.context.join(' / ') }}</span>
          </li>
          <li v-for="{ folder, depth } in group.folders" :key="folder.id" :class="[rowClass, hoverClass]">
            <button type="button" :class="tapClass" :style="{ paddingLeft: `${12 + Math.min(depth, 4) * 16 + (group.context.length > 0 ? 16 : 0)}px` }" :disabled="readOnly" @click="emit('open-folder', folder.id)">
              <Folder class="size-4 shrink-0 text-icon" aria-hidden="true" />
              <span class="min-w-0 truncate font-semibold">{{ folder.name }}</span>
              <span v-if="problemOf(folder.id)" class="min-w-0 truncate text-xs text-destructive">{{ $t(problemKey(problemOf(folder.id)!)) }}</span>
            </button>
            <button v-if="existingOf(problemOf(folder.id))" type="button" :class="existingLink" :disabled="readOnly" @click="takeExisting(folder.id, existingOf(problemOf(folder.id))!)">
              <span class="min-w-0 truncate">{{ $t('intakes.useExisting', { name: existingName(existingOf(problemOf(folder.id))!) }) }}</span>
            </button>
          </li>
        </template>
      </ul>
    </div>

    <div v-if="units.length > 0" class="grid min-w-0 grid-cols-1 gap-1">
      <h3 class="px-3 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.units') }}</h3>
      <ul class="surface-list">
        <li v-for="u in units" :key="u.id" :class="[rowClass, hoverClass]">
          <button type="button" :class="tapClass" :aria-label="$t('intakes.unit.edit', { name: u.name })" :aria-describedby="problemOf(u.id) ? `${uid}-${u.id}` : undefined" :disabled="readOnly" @click="openUnit(u)">
            <span class="grid min-w-0 gap-0.5">
              <span class="min-w-0 truncate font-semibold">{{ $t('intakes.willCreate.unitSymbol', { name: u.name, symbol: u.symbol }) }}</span>
              <span v-if="problemOf(u.id)" :id="`${uid}-${u.id}`" class="min-w-0 truncate text-xs text-destructive">{{ $t(problemKey(problemOf(u.id)!)) }}</span>
            </span>
            <Pencil class="ml-auto size-4 shrink-0 text-icon" aria-hidden="true" />
          </button>
          <Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" :aria-label="$t('intakes.willCreate.removeEverywhere', { name: u.name })" :disabled="readOnly" @click="removeUnit(u)">
            <X class="size-4" aria-hidden="true" />
          </Button>
        </li>
      </ul>
    </div>

    <div v-if="attributes.length > 0" class="grid min-w-0 grid-cols-1 gap-1">
      <h3 class="px-3 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.attributes') }}</h3>
      <ul class="surface-list">
        <li v-for="a in attributes" :key="a.id" :class="[rowClass, hoverClass]">
          <button type="button" :class="tapClass" :aria-label="$t('intakes.attribute.edit', { name: a.name })" :aria-describedby="`${uid}-${a.id}`" :disabled="readOnly" @click="openAttribute(a)">
            <span class="grid min-w-0 gap-0.5">
              <span class="min-w-0 truncate font-semibold">{{ a.name }}</span>
              <span :id="`${uid}-${a.id}`" class="min-w-0 truncate text-xs text-muted-foreground">
                {{ kindText(a) }}<template v-if="problemOf(a.id)"> · <span class="text-destructive">{{ $t(problemKey(problemOf(a.id)!)) }}</span></template>
              </span>
            </span>
            <Pencil class="ml-auto size-4 shrink-0 text-icon" aria-hidden="true" />
          </button>
          <button v-if="existingOf(problemOf(a.id))" type="button" :class="existingLink" :disabled="readOnly" @click="takeExisting(a.id, existingOf(problemOf(a.id))!)">
            <span class="min-w-0 truncate">{{ $t('intakes.useExisting', { name: existingName(existingOf(problemOf(a.id))!) }) }}</span>
          </button>
          <Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" :aria-label="$t('intakes.willCreate.removeEverywhere', { name: a.name })" :disabled="readOnly" @click="removeAttribute(a)">
            <X class="size-4" aria-hidden="true" />
          </Button>
        </li>
      </ul>
    </div>

    <div v-if="tags.length > 0" class="grid min-w-0 grid-cols-1 gap-1">
      <h3 class="px-3 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.tags') }}</h3>
      <ul class="surface-list">
        <li v-for="x in tags" :key="x.id" :class="[rowClass, hoverClass]">
          <button type="button" :class="tapClass" :aria-label="$t('intakes.tag.edit', { name: x.name })" :aria-describedby="problemOf(x.id) ? `${uid}-${x.id}` : undefined" :disabled="readOnly" @click="openTag(x)">
            <span v-if="x.color" class="colored size-2 shrink-0 rounded-full bg-(--c)" :style="colorVars(x.color)" aria-hidden="true" />
            <span class="grid min-w-0 gap-0.5">
              <span class="min-w-0 truncate font-semibold">{{ x.name }}</span>
              <span v-if="problemOf(x.id)" :id="`${uid}-${x.id}`" class="min-w-0 truncate text-xs text-destructive">{{ $t(problemKey(problemOf(x.id)!)) }}</span>
            </span>
            <Pencil class="ml-auto size-4 shrink-0 text-icon" aria-hidden="true" />
          </button>
          <Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" :aria-label="$t('intakes.willCreate.removeEverywhere', { name: x.name })" :disabled="readOnly" @click="removeTag(x)">
            <X class="size-4" aria-hidden="true" />
          </Button>
        </li>
      </ul>
    </div>

    <div v-if="options.length > 0" class="grid min-w-0 grid-cols-1 gap-1">
      <h3 class="px-3 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.options') }}</h3>
      <ul class="surface-list">
        <li v-for="o in options" :key="o.key" :class="[rowClass, hoverClass]">
          <button type="button" :class="tapClass" :aria-label="$t('intakes.option.edit', { name: o.name, value: o.value })" :aria-describedby="`${uid}-option-${options.indexOf(o)}`" :disabled="readOnly" @click="openOption(o)">
            <span class="grid min-w-0 gap-0.5">
              <span class="min-w-0 truncate font-semibold">{{ $t('intakes.willCreate.option', { name: o.name, value: o.value }) }}</span>
              <span :id="`${uid}-option-${options.indexOf(o)}`" class="min-w-0 truncate text-xs text-muted-foreground">
                {{ $t('intakes.willCreate.optionLines', o.lines) }}<template v-if="o.items > 0"> · {{ $t('intakes.willCreate.optionItems', o.items) }}</template><template v-if="problemOf(o.attributeId)"> · <span class="text-destructive">{{ $t(problemKey(problemOf(o.attributeId)!)) }}</span></template>
              </span>
            </span>
            <Pencil class="ml-auto size-4 shrink-0 text-icon" aria-hidden="true" />
          </button>
          <Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" :aria-label="$t('intakes.option.remove', { value: o.value })" :disabled="readOnly" @click="removeOption(o)">
            <X class="size-4" aria-hidden="true" />
          </Button>
        </li>
      </ul>
    </div>

    <div v-if="items.length > 0" class="grid min-w-0 grid-cols-1 gap-1">
      <h3 v-if="!itemsFold" class="px-3 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.items') }}</h3>
      <h3 v-else class="min-w-0">
        <button type="button" :class="foldTitle" :aria-expanded="itemsShown" :aria-controls="`${uid}-items`" @click="itemsOpen = !itemsShown">
          <span class="shrink-0">{{ $t('intakes.willCreate.items') }}</span>
          <span class="shrink-0 font-normal tabular-nums">{{ items.length }}</span>
          <span v-if="!itemsShown" class="min-w-0 truncate font-normal">{{ itemNames }}</span>
          <ChevronDown class="ml-auto size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="itemsShown ? 'rotate-180' : ''" aria-hidden="true" />
        </button>
      </h3>
      <ul v-if="itemsShown" :id="`${uid}-items`" class="surface-list">
        <li v-for="item in items" :key="item.id" class="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']">
          <IntakeNewItemCard :item="item" :content="content" :snapshot="snapshot" :problem="problemOf(item.id)" :read-only="readOnly" :edit="edit" />
        </li>
      </ul>
    </div>
  </section>
 <ConfirmSheet
    v-model:open="confirmOpen"
    :title="confirm?.title ?? ''"
    :description="confirm?.description ?? ''"
    :confirm-label="$t('intakes.willCreate.confirmRemove')"
    destructive
    @confirm="confirmed"
  />
  <AppSheet v-model:open="editOpen" :title="$t('intakes.attribute.editTitle')" :locked="formBusy" initial-focus="[data-field='attribute-name']">
    <div class="mt-4">
      <AttributeForm
        v-if="editing"
        v-model:busy="formBusy"
        :attribute="editingAttribute"
        draft
        :clash="clash"
        :other-pinned="otherPinned"
        :similar="similarAttribute"
        @draft="saveAttribute"
        @use-existing="useExistingAttribute"
      />
    </div>
  </AppSheet>
  <AppSheet v-model:open="unitOpen" :title="$t('intakes.unit.editTitle')" :locked="unitBusy" initial-focus="[data-field='unit-name']">
    <div class="mt-4">
      <UnitForm v-if="unitEditing" :key="unitEditing.id" v-model:busy="unitBusy" :unit="unitEditing" draft :taken="unitIsTaken" :similar="similarUnit" @draft="saveUnit" />
    </div>
  </AppSheet>
  <AppSheet v-model:open="tagOpen" :title="$t('intakes.tag.editTitle')" initial-focus="#intake-tag-name">
    <form class="mt-4 grid gap-4" novalidate @submit.prevent="saveTag">
      <div class="grid gap-2">
        <Label for="intake-tag-name">{{ $t('form.name') }}</Label>
        <Input id="intake-tag-name" v-model="tagName" autocomplete="off" :aria-invalid="tagError ? true : undefined" aria-describedby="intake-tag-error" class="h-11" @input="tagError = null" />
      </div>
      <ColorSwatches :key="tagEditing?.id ?? 'none'" v-model="tagColor" :auto="null" :label="$t('colors.label')" />
      <p id="intake-tag-error" role="alert" class="field-text text-sm text-destructive">{{ tagError }}</p>
      <Button type="submit" class="h-11 rounded-field" :disabled="tagName.trim() === ''">{{ $t('intakes.tag.save') }}</Button>
    </form>
  </AppSheet>
  <AppSheet v-model:open="optionOpen" :title="$t('intakes.option.editTitle')" initial-focus="#intake-option-value">
    <form class="mt-4 grid gap-4" novalidate @submit.prevent="saveOption">
      <div class="grid gap-2">
        <Label for="intake-option-value">{{ optionEditing?.name }}</Label>
        <Input id="intake-option-value" v-model="optionText" autocomplete="off" :aria-invalid="optionError ? true : undefined" aria-describedby="intake-option-error" class="h-11" @input="optionError = null" />
      </div>
      <p id="intake-option-error" role="alert" class="field-text text-sm text-destructive">{{ optionError }}</p>
      <Button type="submit" class="h-11 rounded-field" :disabled="optionText.trim() === ''">{{ $t('intakes.option.save') }}</Button>
    </form>
  </AppSheet>
</template>

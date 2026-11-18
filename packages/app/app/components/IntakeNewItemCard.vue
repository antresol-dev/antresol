<script setup lang="ts">
import {
  BUILTIN_UNITS,
  formatAttributeValue,
  intakeAttributes,
  intakeUnits,
  isCanonicalNumber,
  newId,
  resolveUnit,
  type DraftLinePhoto,
  type DraftNewItem,
  type DraftNewUnit,
  type EntityProblem,
  type Id,
  type IntakeDraftContent,
  type InventorySnapshot,
} from '@antresol/core'
import { ChevronDown, Image as ImageIcon, ImagePlus, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { defaultItemColor } from '~/lib/item-colors'
import { nameClash, restoreNewItem, withItemUnit, withNewItem, withoutNewItem } from '~/lib/intake-draft'
import { similarItems, similarUnits, unitChoicesWithDraft, unitTaken } from '~/lib/intake-parts'
import { folderChoicesWithDraft, folderPathWithDraft } from '@antresol/kit/draft-folders'
import { UNDO_MIN_MS } from '~/lib/undo'

// One new item of an intake (spec 2026-11-16 §4): a row (photo or an empty slot, name, folder path, the values of its
// variants without amounts) that opens into a card: photo, name, folder, description, unit, tags, attributes and the
// variants list; an icon and a colour (as in the item's form), and a unit that may be a new one ("New unit…", a draft
// unit). Edits go through `edit`, so the device-first save keeps working. A name an item of the folder has is refused
// (archived ones count); names that only look alike are shown as advice.
const props = defineProps<{
  item: DraftNewItem
  content: IntakeDraftContent
  snapshot: InventorySnapshot
  problem: EntityProblem | null
  readOnly: boolean
  edit: (change: (c: IntakeDraftContent) => IntakeDraftContent) => Promise<boolean>
}>()

const { t } = useI18n()
const intakes = useIntakes()
const workspace = useWorkspace()

const expanded = ref(false)
const pickingFolder = ref(false)
const tagsOpen = ref(false)
const uploading = ref(false)
const name = ref(props.item.name)
const description = ref(props.item.description ?? '')
watch(() => props.item.name, (v) => (name.value = v))
watch(() => props.item.description, (v) => (description.value = v ?? ''))

const disabled = computed(() => props.readOnly || uploading.value)
const canPhoto = computed(() => !!workspace.state.current && workspace.fileStoreFor(workspace.state.current.sourceId) !== null)
const attributes = computed(() => intakeAttributes(props.content, props.snapshot))
const unit = computed(() => resolveUnit(props.item.unitKey, intakeUnits(props.content, props.snapshot)) ?? BUILTIN_UNITS.pcs)
const unitList = computed(() => unitChoicesWithDraft(props.snapshot, props.content))
const pickingIcon = ref(false)
const shownColor = computed(() => props.item.color ?? defaultItemColor(props.item.id))
const NEW_UNIT = '\u0000new'
const creatingUnit = ref(false)
const unitError = ref<string | null>(null)
const unitIsTaken = (part: { name?: string; symbol?: string }) => unitTaken(props.snapshot, props.content, part)
const similarUnit = (n: string) => similarUnits(props.snapshot, props.content, n)
function pickUnit(key: unknown): void {
  if (key === NEW_UNIT) {
    creatingUnit.value = true
    return
  }
  void patch({ unitKey: String(key) })
}
async function newUnit(u: DraftNewUnit): Promise<void> {
  const next = withItemUnit(props.content, props.snapshot, props.item.id, u)
  if ('errorKey' in next) {
    unitError.value = t(next.errorKey, next.params ?? {})
    return
  }
  unitError.value = null
  if (await props.edit((c) => {
    const r = withItemUnit(c, props.snapshot, props.item.id, u)
    return 'errorKey' in r ? c : r
  })) creatingUnit.value = false
}
const path = computed(() => folderPathWithDraft(props.snapshot, props.content, props.item.folderId).join(' / ') || props.snapshot.inventory.name)

const valueText = (attributeId: Id, value: string | null): string => {
  const a = attributes.value.get(attributeId)
  if (value === null || !a) return value ?? ''
  return a.kind !== 'number' || isCanonicalNumber(value) ? formatAttributeValue(a, value) : value
}
/** The variants the lines make: "1 µH / 50 V" per line, each once, with the photo of its line (if any). */
const variants = computed(() => {
  const seen = new Set<string>()
  const out: { label: string; photo: DraftLinePhoto | null }[] = []
  for (const l of props.content.lines) {
    if (l.itemId !== props.item.id || l.axisValues.length === 0) continue
    const label = l.axisValues.map((v) => valueText(v.attributeId, v.value)).join(' / ')
    if (!seen.has(label)) {
      seen.add(label)
      out.push({ label, photo: l.photo })
    }
  }
  return out
})
const axisNames = computed(() => props.item.attributes.filter((x) => x.axis).map((x) => attributes.value.get(x.attributeId)?.name ?? ''))
const valuesLine = computed(() => {
  if (variants.value.length === 0) return ''
  return (axisNames.value.length === 1 ? `${axisNames.value[0]}: ` : '') + variants.value.map((v) => v.label).join(' · ')
})
const summary = computed(() => [path.value, valuesLine.value].filter(Boolean).join(' · '))
const tagNames = computed(() =>
  (props.item.tagIds ?? [])
    .map((id) => props.snapshot.tags.find((x) => x.id === id)?.name ?? (props.content.newTags ?? []).find((x) => x.id === id)?.name)
    .filter(Boolean)
    .join(', '),
)
const problemKey = computed(() => (props.problem ? `intakes.entity.problem.${props.problem.code}` : null))

/** Changes this item in the draft as it is when the edit runs. */
async function patch(change: Partial<DraftNewItem>): Promise<void> {
  if (props.readOnly) return
  await props.edit((c) => {
    const cur = c.newItems.find((x) => x.id === props.item.id)
    return cur ? withNewItem(c, { ...cur, ...change }) : c
  })
}
/** What the typed name collides with in the item's folder (itself excepted). */
function takenIn(typed: string, folderId: Id | null): 'active' | 'archived' | null {
  if (typed.trim() === '') return null
  const hit = nameClash(props.snapshot, props.content, { kind: 'item', name: typed, folderId }, props.item.id)
  return hit ? (hit.archived ? 'archived' : 'active') : null
}
const nameTaken = computed(() => takenIn(name.value, props.item.folderId))
const alike = computed(() => (nameTaken.value ? [] : similarItems(props.snapshot, props.content, name.value, props.item.folderId, props.item.id)))
async function saveName(): Promise<void> {
  const v = name.value.trim()
  if (v === '') {
    name.value = props.item.name
    return
  }
  // A taken name stays as typed, with its note, until it is fixed or Escape puts the old one back.
  if (nameTaken.value) return
  if (v !== props.item.name) await patch({ name: v })
}
async function saveDescription(): Promise<void> {
  const v = description.value.trim() || null
  if (v !== (props.item.description ?? null)) await patch({ description: v })
}

async function upload(files: File[]): Promise<void> {
  const file = files[0]
  if (!file) return
  uploading.value = true
  try {
    await patch({ photos: [{ ...(await intakes.uploadPhoto(file)), id: newId() }] })
  } catch {
    toast.error(t('intakes.line.photoFailed'))
  } finally {
    uploading.value = false
  }
}

const folderChoices = computed(() =>
  folderChoicesWithDraft(props.snapshot, props.content, props.item.folderId).map((c) => ({
    ...c,
    name: c.draft ? t('intakes.folder.newSuffix', { name: c.name }) : c.name,
  })),
)
function setFolder(id: Id | null): void {
  pickingFolder.value = false
  const taken = takenIn(props.item.name, id)
  if (taken) {
    toast.error(t(taken === 'archived' ? 'nameTaken.archived' : 'nameTaken.active', { name: props.item.name }))
    return
  }
  void patch({ folderId: id })
}

const tagIds = computed({
  get: () => props.item.tagIds ?? [],
  set: (list: Id[]) => void patch({ tagIds: list }),
})
async function addTag(typed: string): Promise<void> {
  const tagName = typed.trim()
  if (!tagName || props.readOnly) return
  await props.edit((c) => {
    const cur = c.newItems.find((x) => x.id === props.item.id)
    if (!cur) return c
    const tags = c.newTags ?? []
    const same = tags.find((x) => x.name.toLowerCase() === tagName.toLowerCase())
    const tag = same ?? { id: newId(), name: tagName }
    const next = { ...c, newTags: same ? tags : [...tags, tag] }
    return withNewItem(next, { ...cur, tagIds: [...(cur.tagIds ?? []).filter((x) => x !== tag.id), tag.id] })
  })
}

async function remove(): Promise<void> {
  const { removed } = withoutNewItem(props.content, props.item.id)
  if (!removed || props.readOnly) return
  if (!(await props.edit((c) => withoutNewItem(c, props.item.id).content))) return
  toast(t('intakes.item.removed', { name: removed.item.name }), {
    duration: UNDO_MIN_MS,
    action: { label: t('undo.action'), onClick: () => void props.edit((c) => restoreNewItem(c, removed)) },
  })
}

const summaryRow =
  "relative flex min-h-11 min-w-0 items-center gap-3 rounded-field px-3 py-2 text-left transition-colors duration-(--dur-fast) not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-[''] hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
const panelId = `intake-item-${props.item.id}`
</script>

<template>
  <div class="min-w-0">
    <button
      type="button"
      class="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-field px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      :aria-expanded="expanded"
      :aria-controls="panelId"
      @click="expanded = !expanded"
    >
      <PhotoImg v-if="item.photos?.[0]" :photo="item.photos[0]" size="thumb" alt="" class="size-9 shrink-0 rounded-thumb object-cover" />
      <span v-else class="grid size-9 shrink-0 place-items-center rounded-thumb bg-thumb text-thumb-foreground"><ImagePlus class="size-4" aria-hidden="true" /></span>
      <span class="grid min-w-0 grow gap-0.5">
        <span class="flex min-w-0 items-center gap-2">
          <span class="min-w-0 truncate text-base font-semibold">{{ item.name }}</span>
          <span v-if="problem" class="shrink-0 rounded-chip border border-destructive px-1.5 py-px text-xs font-semibold tracking-[0.04em] text-destructive uppercase">{{ $t('intakes.tag.problem') }}</span>
        </span>
        <span class="min-w-0 truncate text-sm text-muted-foreground">{{ summary }}</span>
      </span>
      <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="expanded ? 'rotate-180' : ''" aria-hidden="true" />
    </button>

    <div v-if="expanded" :id="panelId" class="grid min-w-0 gap-4 px-3 pt-2 pb-4">
      <p v-if="problemKey" role="alert" class="text-sm text-destructive">{{ $t(problemKey) }}</p>

      <div v-if="canPhoto || item.photos?.length" class="grid gap-2">
        <Label>{{ $t('intakes.line.photo') }}</Label>
        <div v-if="item.photos?.[0]" class="flex items-center gap-3">
          <PhotoImg :photo="item.photos[0]" size="thumb" alt="" class="size-16 shrink-0 rounded-thumb object-cover" />
          <PhotoPicker v-if="canPhoto" :disabled="disabled" @pick="upload" />
          <Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" :aria-label="$t('quickAdd.removePhoto')" :disabled="disabled" @click="patch({ photos: [] })">
            <X class="size-4" aria-hidden="true" />
          </Button>
        </div>
        <PhotoPicker v-else-if="canPhoto" :disabled="disabled" @pick="upload" />
      </div>

      <div class="grid gap-2">
        <Label :for="`${panelId}-name`">{{ $t('form.name') }}</Label>
        <Input :id="`${panelId}-name`" v-model="name" autocomplete="off" class="h-11" :disabled="readOnly" :aria-invalid="nameTaken ? true : undefined" :aria-describedby="`${panelId}-name-note`" @change="saveName" @keydown.esc="name = item.name" />
        <NameTakenNote :id="`${panelId}-name-note`" :taken="nameTaken" :name="name" />
        <SimilarNote :names="alike" />
      </div>

      <div class="grid gap-2">
        <Label>{{ $t('intakes.line.folder') }}</Label>
        <button type="button" :class="summaryRow" class="border border-input" :aria-expanded="pickingFolder" :disabled="disabled" @click="pickingFolder = !pickingFolder">
          <span class="min-w-0 grow truncate text-sm">{{ path }}</span>
          <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="pickingFolder ? 'rotate-180' : ''" aria-hidden="true" />
        </button>
        <FolderPickerList v-if="pickingFolder" :choices="folderChoices" @select="setFolder" />
      </div>

      <div class="grid gap-2">
        <Label :for="`${panelId}-description`">
          {{ $t('form.description') }}
          <span class="font-normal text-subtle-foreground">· {{ $t('form.optional') }}</span>
        </Label>
        <Textarea :id="`${panelId}-description`" v-model="description" rows="3" class="min-h-20" :disabled="readOnly" @change="saveDescription" />
      </div>

      <InlineCreate v-if="creatingUnit" :title="$t('intakes.unit.newTitle')" :close-label="$t('intakes.unit.cancelNew')" @cancel="creatingUnit = false">
        <UnitForm :unit="null" draft :taken="unitIsTaken" :similar="similarUnit" @draft="newUnit" />
        <p v-if="unitError" role="alert" class="text-sm text-destructive">{{ unitError }}</p>
      </InlineCreate>
      <div v-else class="grid gap-2">
        <Label>{{ $t('intakes.item.unit') }}</Label>
        <Select :model-value="item.unitKey" :disabled="readOnly" @update:model-value="pickUnit">
          <SelectTrigger :aria-label="$t('intakes.item.unit')" class="h-11 w-full">
            <SelectValue>{{ unit.name }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="u in unitList" :key="u.key" :value="u.key">{{ u.name }}</SelectItem>
            <SelectItem :value="NEW_UNIT">{{ $t('intakes.unit.newUnit') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <IconField v-model:picking="pickingIcon" :icon="item.icon ?? null" :color="shownColor" :disabled="readOnly" @pick="patch({ icon: $event })" />
      <ColorSwatches :model-value="item.color ?? null" :auto="defaultItemColor(item.id)" :label="$t('colors.label')" :disabled="readOnly" @update:model-value="patch({ color: $event })" />

      <div class="grid gap-2">
        <button type="button" :class="summaryRow" class="border border-input" :aria-expanded="tagsOpen" :disabled="disabled" @click="tagsOpen = !tagsOpen">
          <span class="shrink-0 text-sm font-semibold">{{ $t('intakes.line.tags') }}</span>
          <span class="min-w-0 grow truncate text-right text-sm" :class="tagNames ? 'text-foreground' : 'text-muted-foreground'">{{ tagNames || $t('intakes.line.add') }}</span>
          <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="tagsOpen ? 'rotate-180' : ''" aria-hidden="true" />
        </button>
        <TagPicker v-if="tagsOpen" v-model="tagIds" :snapshot="snapshot" :extra-tags="content.newTags ?? []" :locked="disabled" @create="addTag" />
      </div>

      <div class="grid gap-2">
        <Label>{{ $t('intakes.line.attributes') }}</Label>
        <ul v-if="item.attributes.length > 0" class="surface-list">
          <li
            v-for="x in item.attributes"
            :key="x.attributeId"
            class="relative flex min-w-0 items-baseline gap-3 px-3 py-2 text-sm not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
          >
            <span class="min-w-0 grow truncate font-semibold">{{ attributes.get(x.attributeId)?.name }}</span>
            <span class="min-w-0 truncate text-muted-foreground">{{ x.axis ? $t('intakes.item.axis') : valueText(x.attributeId, x.value) }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">{{ $t('intakes.item.noAttributes') }}</p>
        <p class="text-sm text-subtle-foreground">{{ $t('intakes.item.attributesHint') }}</p>
      </div>

      <div class="grid gap-2">
        <Label>{{ $t('intakes.item.variants') }}</Label>
        <ul v-if="variants.length > 0" class="surface-list">
          <li
            v-for="v in variants"
            :key="v.label"
            class="relative flex min-w-0 items-center gap-3 px-3 py-2 text-sm not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-15 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
          >
            <PhotoImg v-if="v.photo" :photo="v.photo" size="thumb" alt="" class="size-9 shrink-0 rounded-thumb object-cover" />
            <span v-else class="grid size-9 shrink-0 place-items-center rounded-thumb bg-thumb text-thumb-foreground"><ImageIcon class="size-4" aria-hidden="true" /></span>
            <span class="min-w-0 wrap-anywhere">{{ v.label }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">{{ $t('intakes.item.noVariants') }}</p>
      </div>

      <div>
        <Button type="button" variant="outline" class="h-11 text-destructive" :disabled="readOnly" @click="remove">{{ $t('intakes.item.remove') }}</Button>
      </div>
    </div>
  </div>
</template>

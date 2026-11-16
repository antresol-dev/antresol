<script setup lang="ts">
import {
  BUILTIN_UNITS,
  formatAmount,
  formatAttributeValue,
  getCurrency,
  itemAxes,
  itemStock,
  newId,
  resolveUnit,
  type Attribute,
  type DraftLine,
  type DraftLinePhoto,
  type DraftNewItem,
  type DraftNewTag,
  type Id,
  type IntakeDraftContent,
  type InventorySnapshot,
} from '@antresol/core'
import { refDebounced } from '@vueuse/core'
import { ChevronDown, ChevronRight, Info, Pencil, Plus, TriangleAlert, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { pricePreview, parseMoneyText, unitChoices } from '~/lib/amounts'
import { parseAttributeInput } from '~/lib/attribute-values'
import { formatMoney } from '~/lib/format'
import {
  alreadyInDraft,
  buildDraftLine,
  duplicateWarning,
  lineMatches,
  nextLineDefaults,
  priceText,
  restoreLine,
  suggestedFolder,
  valueHint,
  valuesFromQuery,
  withLine,
  withoutLine,
} from '~/lib/intake-line'
import { UNDO_MIN_MS } from '~/lib/undo'
import { folderChoices, pathOf, snapshotIndex, type SearchRow } from '~/lib/views'

// The line sheet of a draft intake (spec 2026-11-13 intakes §6): "what is it" with what the inventory and the draft
// already have, then the item's card (or a new item) and the amount; price & link, photo, attributes and folder are
// summary rows that open on tap. Every change goes into the draft through `edit` (the device at once, the database
// after a pause).
const props = defineProps<{
  /** The line to edit; null: a new line. */
  lineId: Id | null
  content: IntakeDraftContent
  snapshot: InventorySnapshot
  readOnly: boolean
  /** Applies a change to the draft's content; false when it was not applied. */
  edit: (change: (c: IntakeDraftContent) => IntakeDraftContent) => Promise<boolean>
}>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const workspace = useWorkspace()
const intakes = useIntakes()

type Values = { attributeId: Id; value: string }[]

const mode = ref<'search' | 'line'>('search')
const query = ref('')
const formLineId = ref<Id>(newId())
const ids = ref<DraftLine['ids']>({ movementId: newId(), variantId: newId(), photoId: newId() })
const itemId = ref<Id | null>(null)
const newItem = ref<DraftNewItem | null>(null)
const axisValues = ref<Values>([])
const amount = ref('')
const price = ref('')
const url = ref('')
const urlPrefix = ref<string | null>(null)
const photo = ref<DraftLinePhoto | null>(null)
const defaults = ref<{ folderId: Id | null; unitKey: string; urlPrefix: string | null }>({ folderId: null, unitKey: 'pcs', urlPrefix: null })

const priceOpen = ref(false)
const photoOpen = ref(false)
const attributesOpen = ref(false)
const tagsOpen = ref(false)
/** New tags this form made: created by the commit, not now (the source's revision stays as it is). */
const addedTags = ref<DraftNewTag[]>([])
const pickingFolder = ref(false)
const replacing = ref(false)
const editingAxis = ref<Id | null>(null)
const recent = ref<Id[]>([])
const uploading = ref(false)
const saving = ref(false)
const error = ref<{ key: string; params?: Record<string, string> } | null>(null)
const attributeError = ref<string | null>(null)

const s = computed(() => props.snapshot)
const ix = computed(() => snapshotIndex(s.value))
const editing = computed(() => props.lineId !== null)
const busy = computed(() => saving.value || uploading.value)
const disabled = computed(() => props.readOnly || busy.value)
const canPhoto = computed(() => !!workspace.state.current && workspace.fileStoreFor(workspace.state.current.sourceId) !== null)

/** What the axes show: a stored number as the attribute writes it ("4700" -> "4.7 kΩ"). */
function shown(values: Values): Values {
  return values.map(({ attributeId, value }) => {
    const a = s.value.attributes.find((x) => x.id === attributeId)
    return { attributeId, value: a ? formatAttributeValue(a, value) : value }
  })
}

function startNew(from: typeof defaults.value): void {
  defaults.value = from
  mode.value = 'search'
  query.value = ''
  formLineId.value = newId()
  ids.value = { movementId: newId(), variantId: newId(), photoId: newId() }
  itemId.value = null
  newItem.value = null
  axisValues.value = []
  amount.value = ''
  price.value = ''
  urlPrefix.value = from.urlPrefix
  url.value = from.urlPrefix ? `${from.urlPrefix}/` : ''
  photo.value = null
  priceOpen.value = false
  photoOpen.value = false
  attributesOpen.value = false
  tagsOpen.value = false
  addedTags.value = []
  pickingFolder.value = false
  replacing.value = false
  editingAxis.value = null
  error.value = null
  attributeError.value = null
}

function load(): void {
  const line = props.content.lines.find((l) => l.id === props.lineId)
  if (!line) {
    const last = props.content.lines.at(-1)
    startNew(last ? nextLineDefaults(last, props.content, s.value) : { folderId: null, unitKey: 'pcs', urlPrefix: null })
    return
  }
  startNew({ folderId: null, unitKey: 'pcs', urlPrefix: null })
  formLineId.value = line.id
  ids.value = line.ids
  itemId.value = line.itemId
  const n = props.content.newItems.find((x) => x.id === line.itemId)
  newItem.value = n ? structuredClone(toRaw(n)) : null
  axisValues.value = shown(line.axisValues)
  amount.value = line.quantity
  price.value = line.totalPrice === null ? '' : priceText(line.totalPrice, s.value.inventory.currency)
  url.value = line.sourceUrl ?? ''
  photo.value = line.photo
  query.value = n?.name ?? ix.value.items.get(line.itemId)?.name ?? ''
  mode.value = 'line'
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    load()
    void intakes.recentFolders().then(
      (found) => (recent.value = found),
      () => (recent.value = []),
    )
  },
  { immediate: true },
)

// ---- State 1: what is it ----
const typed = refDebounced(query, 150)
const matches = computed(() => lineMatches(typed.value, s.value, props.content))
const variantCount = (id: Id): number => ix.value.itemVariants.get(id)?.length ?? 0
const where = (r: SearchRow): string => r.path || s.value.inventory.name

function focusSoon(selector: string): void {
  void nextTick(() => document.querySelector<HTMLElement>(selector)?.focus())
}

function variantValues(variantId: Id): Values {
  return s.value.variantAttributeValues.flatMap((x) => (x.variantId === variantId && x.value !== null ? [{ attributeId: x.attributeId, value: x.value }] : []))
}

function pickExisting(row: SearchRow, exact: boolean): void {
  itemId.value = row.itemId
  newItem.value = null
  axisValues.value = shown(exact && row.variantId !== null ? variantValues(row.variantId) : valuesFromQuery(s.value, row.itemId, query.value))
  enterLine()
}
function pickDraftItem(id: Id): void {
  const n = props.content.newItems.find((x) => x.id === id)
  if (!n) return
  newItem.value = structuredClone(toRaw(n))
  itemId.value = id
  axisValues.value = shown(valuesFromQuery(s.value, id, query.value, props.content))
  enterLine()
}
function pickNew(): void {
  const name = query.value.trim()
  if (name === '') return
  const suggested = suggestedFolder(s.value, matches.value)
  newItem.value = { id: newId(), name, folderId: suggested?.folderId ?? defaults.value.folderId, unitKey: defaults.value.unitKey, attributes: [] }
  itemId.value = newItem.value.id
  axisValues.value = []
  enterLine()
}
function enterLine(): void {
  mode.value = 'line'
  error.value = null
  editingAxis.value = axes.value.find((a) => !valueOf(a.id).trim())?.id ?? null
  focusSoon(editingAxis.value ? `#intake-axis-${editingAxis.value}` : '#intake-line-amount')
}
function changeItem(): void {
  mode.value = 'search'
  focusSoon('#intake-line-query')
}
/** Enter in "what is it": the first thing offered, or a new item when nothing is. */
function pickFirst(): void {
  const m = matches.value
  if (typed.value !== query.value) return
  if (m.exact[0]) pickExisting(m.exact[0], true)
  else if (m.otherValue[0]) pickExisting(m.otherValue[0], false)
  else if (m.inDraft[0]) pickDraftItem(m.inDraft[0].newItemId)
  else pickNew()
}

// ---- States 2–4: the item and the line ----
const item = computed(() => (itemId.value && !newItem.value ? (ix.value.items.get(itemId.value) ?? null) : null))
const axes = computed<Attribute[]>(() => {
  const n = newItem.value
  if (n) return n.attributes.flatMap((x) => (x.axis ? (s.value.attributes.filter((a) => a.id === x.attributeId)) : []))
  return itemId.value ? itemAxes(s.value, itemId.value) : []
})
const valueOf = (attributeId: Id): string => axisValues.value.find((x) => x.attributeId === attributeId)?.value ?? ''
function setValue(attributeId: Id, value: string): void {
  const rest = axisValues.value.filter((x) => x.attributeId !== attributeId)
  axisValues.value = [...rest, { attributeId, value }]
}
/** The shared values of an existing item, as chips: "0.25 W". */
const sharedChips = computed(() => {
  const id = item.value?.id
  if (!id) return []
  return s.value.itemAttributes.flatMap((x) => {
    const a = x.itemId === id && x.axisPosition === null && x.value ? s.value.attributes.find((y) => y.id === x.attributeId) : undefined
    return a ? [formatAttributeValue(a, x.value!)] : []
  })
})

const draftForHints = computed(() => (newItem.value ? withNewItem(props.content, newItem.value) : props.content))
function withNewItem(c: IntakeDraftContent, n: DraftNewItem): IntakeDraftContent {
  return { ...c, newItems: [...c.newItems.filter((x) => x.id !== n.id), n] }
}
const hint = computed(() => (itemId.value ? valueHint(s.value, draftForHints.value, itemId.value, axisValues.value) : null))
const hintUnit = computed(() => resolveUnit(item.value?.unitKey ?? 'pcs', s.value.units) ?? BUILTIN_UNITS.pcs)
const nearestText = computed(() => {
  const h = hint.value
  if (h?.kind !== 'new') return null
  const a = axes.value.find((x) => x.kind === 'number')
  const parts = [h.nearest.below, h.nearest.above].flatMap((n) =>
    n && a ? [t('intakes.line.nearestValue', { value: formatAttributeValue(a, n.value), amount: formatAmount(n.quantity, hintUnit.value) })] : [],
  )
  return parts.length > 0 ? t('intakes.line.nearest', { values: parts.join(' · ') }) : null
})
/** The typed values as the axes store them; null while one is missing or does not fit. */
const canonicalValues = computed<Values | null>(() => {
  const out: Values = []
  for (const a of axes.value) {
    const parsed = parseAttributeInput(a, valueOf(a.id))
    if (!('value' in parsed)) return null
    out.push({ attributeId: a.id, value: parsed.value })
  }
  return out
})
/** "47 kΩ" for typed "47k": the values as the attributes write them. */
const hintValue = computed(() =>
  axes.value
    .map((a) => {
      const value = canonicalValues.value?.find((x) => x.attributeId === a.id)?.value
      return value === undefined ? valueOf(a.id) : formatAttributeValue(a, value)
    })
    .join(' · '),
)
const inDraftAlready = computed(() =>
  itemId.value && canonicalValues.value ? alreadyInDraft(props.content, itemId.value, canonicalValues.value, formLineId.value) : false,
)

const tag = computed(() => {
  if (newItem.value) return 'new'
  if (axes.value.length === 0) return 'add'
  if (hint.value?.kind === 'new') return 'newValue'
  return hint.value ? 'add' : null
})
const haveText = computed(() => {
  const i = item.value
  if (!i) return ''
  const h = hint.value
  const q = h?.kind === 'existing' ? h.have : axes.value.length === 0 ? itemStock(s.value, i.id).quantity : null
  const folder = i.folderId === null ? s.value.inventory.name : pathOf(ix.value, i.folderId).map((f) => f.name).join(' / ')
  return [q === null ? null : t('intakes.line.have', { amount: formatAmount(q, hintUnit.value) }), folder].filter(Boolean).join(' · ')
})

// "Looks like you already have this": the inventory's, else another new item of the draft with the same name.
const typedName = refDebounced(computed(() => newItem.value?.name ?? ''), 150)
const duplicate = computed(() => {
  const n = newItem.value
  if (!n) return null
  const asTyped = [typedName.value, ...axisValues.value.map((x) => x.value)].join(' ')
  const row = duplicateWarning(s.value, { ...n, name: typedName.value }, asTyped)
  if (row) return { kind: 'inventory' as const, row }
  const key = typedName.value.trim().toLowerCase()
  const twin = props.content.newItems.find((x) => x.id !== n.id && x.name.trim().toLowerCase() === key)
  return key && twin ? { kind: 'draft' as const, twin } : null
})
function useInstead(): void {
  const d = duplicate.value
  if (!d) return
  if (d.kind === 'draft') {
    pickDraftItem(d.twin.id)
    return
  }
  const values = d.row.variantId !== null ? variantValues(d.row.variantId) : valuesFromQuery(s.value, d.row.itemId, [newItem.value?.name, ...axisValues.value.map((x) => x.value)].join(' '))
  itemId.value = d.row.itemId
  newItem.value = null
  axisValues.value = shown(values)
  enterLine()
}

// The new item's folder: next to the similar item, the folders this device used last, or any other.
const nameMatches = computed(() => (newItem.value ? lineMatches(typedName.value, s.value, props.content) : null))
const suggested = computed(() => (nameMatches.value ? suggestedFolder(s.value, nameMatches.value) : null))
const similarItem = computed(() => {
  const m = nameMatches.value
  const r = m ? (m.exact[0] ?? m.otherValue[0] ?? m.similar[0]) : undefined
  return r ? { itemId: r.itemId, name: r.name } : null
})
const folderName = (id: Id | null): string => (id === null ? s.value.inventory.name : (ix.value.folders.get(id)?.name ?? ''))
const folderChips = computed(() => {
  const n = newItem.value
  if (!n) return []
  const chips: { id: Id | null; label: string }[] = []
  const add = (id: Id | null, label: string): void => {
    if (!chips.some((c) => c.id === id) && (id === null || ix.value.folders.has(id))) chips.push({ id, label })
  }
  if (suggested.value) add(suggested.value.folderId, t('intakes.line.suggested', { folder: folderName(suggested.value.folderId), name: suggested.value.nextTo }))
  for (const id of recent.value) add(id, folderName(id))
  add(n.folderId, folderName(n.folderId))
  return chips
})
function setFolder(id: Id | null): void {
  if (newItem.value) newItem.value = { ...newItem.value, folderId: id }
  pickingFolder.value = false
}

const units = computed(() => {
  if (newItem.value) return unitChoices(s.value)
  return [resolveUnit(item.value?.unitKey ?? 'pcs', s.value.units) ?? BUILTIN_UNITS.pcs]
})
const unitKey = computed({
  get: () => newItem.value?.unitKey ?? item.value?.unitKey ?? 'pcs',
  set: (key: string) => {
    if (newItem.value) newItem.value = { ...newItem.value, unitKey: key }
  },
})
const attributes = computed({
  get: () => newItem.value?.attributes ?? [],
  set: (list: DraftNewItem['attributes']) => {
    if (!newItem.value) return
    newItem.value = { ...newItem.value, attributes: list }
    const axisIds = list.filter((x) => x.axis).map((x) => x.attributeId)
    axisValues.value = axisValues.value.filter((x) => axisIds.includes(x.attributeId))
  },
})
const attributesSummary = computed(() =>
  attributes.value
    .flatMap((x) => {
      const a = s.value.attributes.find((y) => y.id === x.attributeId)
      if (!a) return []
      if (x.axis) return [`${a.name} ${valueOf(a.id) || '…'}`]
      return [x.value ? `${a.name} ${formatAttributeValue(a, x.value)}` : a.name]
    })
    .join(' · '),
)

// ---- Tags of a new item ----
/** The new tags of the draft and this form's own, by id: what the picker offers next to the inventory's tags. */
const draftTags = computed<DraftNewTag[]>(() => {
  const list = [...(props.content.newTags ?? [])]
  for (const t of addedTags.value) if (!list.some((x) => x.id === t.id)) list.push(t)
  return list
})
const tagIds = computed({
  get: () => newItem.value?.tagIds ?? [],
  set: (list: Id[]) => {
    if (newItem.value) newItem.value = { ...newItem.value, tagIds: list }
  },
})
function addTag(name: string): void {
  const typed = name.trim()
  if (typed === '' || !newItem.value) return
  const same = draftTags.value.find((t) => t.name.toLowerCase() === typed.toLowerCase())
  const tag = same ?? { id: newId(), name: typed }
  if (!same) addedTags.value = [...addedTags.value, tag]
  if (!tagIds.value.includes(tag.id)) tagIds.value = [...tagIds.value, tag.id]
}
const tagsSummary = computed(() =>
  tagIds.value
    .flatMap((id) => {
      const name = s.value.tags.find((x) => x.id === id)?.name ?? draftTags.value.find((x) => x.id === id)?.name
      return name ? [name] : []
    })
    .join(', '),
)

// ---- Price & link, photo ----
const currencySymbol = computed(() => {
  const code = s.value.inventory.currency
  return (code && getCurrency(code)?.symbol) || code || ''
})
const pricePreviewOf = computed(() => pricePreview(price.value, s.value.inventory.currency))
const realUrl = computed(() => {
  const typedUrl = url.value.trim()
  const prefix = urlPrefix.value
  return typedUrl === '' || (prefix !== null && (typedUrl === prefix || typedUrl === `${prefix}/`)) ? '' : typedUrl
})
/** "lcsc.com/C25819" for "https://www.lcsc.com/product-detail/C25819.html". */
function shortLink(link: string): string {
  try {
    const u = new URL(link)
    const last = u.pathname.split('/').filter(Boolean).at(-1)?.replace(/\.[a-z]+$/i, '')
    return [u.host.replace(/^www\./, ''), last].filter(Boolean).join('/')
  } catch {
    return link
  }
}
const priceSummary = computed(() => {
  const minor = price.value.trim() ? parseMoneyText(price.value, s.value.inventory.currency) : null
  const parts = [minor !== null ? formatMoney(minor, s.value.inventory.currency) : price.value.trim(), realUrl.value ? shortLink(realUrl.value) : '']
  return parts.filter(Boolean).join(' · ')
})

/** The photo the variant this line adds to has already (one per variant: replaced only when asked). */
const variantPhoto = computed(() => {
  const h = hint.value
  if (newItem.value || (h?.kind !== 'existing' && h?.kind !== 'archived')) return null
  return s.value.photos.find((p) => p.variantId === h.variantId) ?? null
})
/** `replace`: picked through "Replace photo" (buildDraftLine keeps it only while the variant has a photo). */
async function upload(files: File[], replace: boolean): Promise<void> {
  const file = files[0]
  if (!file) return
  uploading.value = true
  error.value = null
  try {
    const stored = await intakes.uploadPhoto(file)
    photo.value = { ...stored, replace }
    replacing.value = false
  } catch {
    error.value = { key: 'intakes.line.photoFailed' }
  } finally {
    uploading.value = false
  }
}

// ---- Save, remove ----
async function save(next: boolean): Promise<void> {
  if (disabled.value || mode.value !== 'line' || !itemId.value) return
  if (attributeError.value) {
    error.value = { key: attributeError.value }
    return
  }
  const built = buildDraftLine(
    {
      lineId: formLineId.value,
      ids: ids.value,
      itemId: itemId.value,
      newItem: newItem.value,
      axisValues: axisValues.value,
      amount: amount.value,
      price: price.value,
      url: url.value,
      urlPrefix: urlPrefix.value,
      photo: photo.value,
      newTags: draftTags.value,
    },
    s.value,
    props.content,
  )
  if ('errorKey' in built) {
    error.value = { key: built.errorKey, params: built.params }
    // The link sits in the folded "Price & link": open it so the field to fix is in sight.
    if (built.errorKey === 'errors.domain.invalid_url' || built.errorKey === 'quickAdd.invalidPrice') priceOpen.value = true
    return
  }
  saving.value = true
  try {
    const applied = await props.edit((c) => withLine(c, built.line, built.newItem, built.newTags))
    if (!applied) return
    if (!next) {
      open.value = false
      return
    }
    const content = withLine(props.content, built.line, built.newItem, built.newTags)
    startNew(nextLineDefaults(built.line, content, s.value))
    focusSoon('#intake-line-query')
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  if (disabled.value || !editing.value) return
  const id = formLineId.value
  const { removed } = withoutLine(props.content, id)
  if (!removed) return
  saving.value = true
  try {
    if (!(await props.edit((c) => withoutLine(c, id).content))) return
  } finally {
    saving.value = false
  }
  open.value = false
  const label = removed.newItem ? t('intakes.line.removedWithItem', { name: removed.newItem.name }) : t('intakes.line.removed')
  toast(label, {
    duration: UNDO_MIN_MS,
    action: { label: t('undo.action'), onClick: () => void props.edit((c) => restoreLine(c, removed)) },
  })
}

const title = computed(() => t(editing.value ? 'intakes.line.editTitle' : 'intakes.line.addTitle'))
// Like the app's list rows: a rounded highlight inside the column (its edges line up with the fields above, the text sits
// 12 px in, like a field's text), and an inset divider between rows instead of a full-width border.
const summaryRow =
  "relative flex min-h-11 min-w-0 items-center gap-3 rounded-field px-3 py-2 text-left transition-colors duration-(--dur-fast) not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-[''] hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
const matchRow =
  'flex min-h-11 w-full min-w-0 items-center gap-3 rounded-field px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none'
const banner = 'grid gap-1 rounded-field px-3 py-3 text-sm'
const chip = 'inline-flex min-h-8 items-center gap-1 rounded-chip border px-3 py-1 text-sm font-semibold'
</script>

<template>
  <AppSheet v-model:open="open" :title="title" :locked="busy" :initial-focus="editing ? '#intake-line-amount' : '#intake-line-query'">
    <div class="mt-3 grid min-w-0 gap-3">
      <!-- 1 · What is it -->
      <template v-if="mode === 'search'">
        <div class="grid gap-1.5">
          <Label for="intake-line-query">{{ $t('intakes.line.what') }}</Label>
          <Input
            id="intake-line-query"
            v-model="query"
            autocomplete="off"
            :placeholder="$t('intakes.line.whatHint')"
            :disabled="disabled"
            class="h-11"
            @keydown.enter.prevent="pickFirst"
          />
        </div>
        <template v-if="typed.trim()">
          <section v-if="matches.exact.length + matches.otherValue.length + matches.similar.length > 0" class="grid gap-1" aria-labelledby="intake-line-have">
            <h3 id="intake-line-have" class="section-label px-1 text-xs">{{ $t('intakes.line.alreadyHave') }}</h3>
            <ul class="surface-list">
              <li v-for="r in matches.exact" :key="`e:${r.itemId}:${r.variantId}`">
                <button type="button" :class="[matchRow, 'match-best']" :disabled="disabled" @click="pickExisting(r, true)">
                  <span class="min-w-0 grow">
                    <span class="block truncate text-sm font-semibold">{{ r.name }}<template v-if="r.variantName"> · {{ r.variantName }}</template></span>
                    <span class="block truncate text-xs text-muted-foreground">
                      <template v-if="r.variantName">{{ $t('intakes.line.exact') }} · </template>{{ $t('intakes.line.have', { amount: r.amount }) }} · {{ where(r) }}
                    </span>
                  </span>
                  <span class="tag-add shrink-0 rounded-chip px-1.5 py-px text-xs font-semibold tracking-[0.04em] uppercase">{{ $t('intakes.tag.add') }}</span>
                </button>
              </li>
              <li v-for="r in matches.otherValue" :key="`o:${r.itemId}`">
                <button type="button" :class="matchRow" :disabled="disabled" @click="pickExisting(r, false)">
                  <span class="min-w-0 grow">
                    <span class="block truncate text-sm"><b>{{ r.name }}</b> · {{ $t('intakes.line.otherValue') }}</span>
                    <span class="block truncate text-xs text-muted-foreground">{{ $t('intakes.line.values', variantCount(r.itemId)) }} · {{ where(r) }}</span>
                  </span>
                  <ChevronRight class="size-4 shrink-0 text-icon" aria-hidden="true" />
                </button>
              </li>
              <li v-for="r in matches.similar" :key="`s:${r.itemId}`">
                <button type="button" :class="matchRow" :disabled="disabled" @click="pickExisting(r, true)">
                  <span class="min-w-0 grow">
                    <span class="block truncate text-sm">{{ r.name }}<template v-if="r.variantName"> · {{ r.variantName }}</template></span>
                    <span class="block truncate text-xs text-muted-foreground">{{ $t('intakes.line.have', { amount: r.amount }) }} · {{ where(r) }}</span>
                  </span>
                  <ChevronRight class="size-4 shrink-0 text-icon" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </section>
          <section v-if="matches.inDraft.length > 0" class="grid gap-1" aria-labelledby="intake-line-in-draft">
            <h3 id="intake-line-in-draft" class="section-label px-1 text-xs">{{ $t('intakes.line.inIntake') }}</h3>
            <ul class="surface-list">
              <li v-for="d in matches.inDraft" :key="d.newItemId">
                <button type="button" :class="matchRow" :disabled="disabled" @click="pickDraftItem(d.newItemId)">
                  <span class="min-w-0 grow truncate text-sm font-semibold">{{ d.name }}</span>
                  <span class="shrink-0 rounded-chip bg-accent-soft px-1.5 py-px text-xs font-semibold tracking-[0.04em] text-accent-soft-foreground uppercase">{{ $t('intakes.tag.new') }}</span>
                </button>
              </li>
            </ul>
          </section>
          <ul class="surface-list">
            <li>
              <button type="button" :class="[matchRow, 'font-semibold text-accent-ink']" :disabled="disabled" @click="pickNew">
                <Plus class="size-4 shrink-0" aria-hidden="true" />
                <span class="min-w-0 grow truncate text-sm">{{ $t('intakes.line.newItem', { name: query.trim() }) }}</span>
              </button>
            </li>
          </ul>
        </template>
      </template>

      <!-- 2–4 · The item and the line -->
      <template v-else>
        <div v-if="duplicate" :class="[banner, 'banner-warn']" role="status">
          <p class="flex items-center gap-2 font-semibold"><TriangleAlert class="size-4 shrink-0 text-warning" aria-hidden="true" />{{ $t('intakes.line.duplicate') }}</p>
          <p class="wrap-anywhere">
            <template v-if="duplicate.kind === 'inventory'">
              {{ duplicate.row.name }}<template v-if="duplicate.row.variantName"> · {{ duplicate.row.variantName }}</template> · {{ $t('intakes.line.have', { amount: duplicate.row.amount }) }}
            </template>
            <template v-else>{{ duplicate.twin.name }} · {{ $t('intakes.line.inIntake') }}</template>
          </p>
          <div>
            <Button type="button" variant="outline" size="sm" class="h-9" :disabled="disabled" @click="useInstead">{{ $t('intakes.line.useInstead') }}</Button>
          </div>
        </div>

        <div class="grid min-w-0 gap-2 rounded-field border border-input p-3">
          <div class="flex min-w-0 items-start gap-2">
            <div class="min-w-0 grow">
              <template v-if="newItem">
                <Label for="intake-line-name" class="sr-only">{{ $t('intakes.line.name') }}</Label>
                <Input
                  id="intake-line-name"
                  :model-value="newItem.name"
                  autocomplete="off"
                  :disabled="disabled"
                  class="h-10 font-semibold"
                  @update:model-value="newItem = { ...newItem!, name: String($event) }"
                  @keydown.enter.prevent="save(!editing)"
                />
              </template>
              <p v-else class="pt-0.5 text-base font-semibold wrap-anywhere">{{ item?.name }}</p>
            </div>
            <span
              v-if="tag"
              class="mt-1.5 shrink-0 rounded-chip px-1.5 py-px text-xs font-semibold tracking-[0.04em] uppercase"
              :class="tag === 'add' ? 'tag-add' : 'bg-accent-soft text-accent-soft-foreground'"
            >{{ $t(`intakes.tag.${tag}`) }}</span>
          </div>
          <div v-if="sharedChips.length + axes.length > 0" class="flex flex-wrap gap-1.5">
            <span v-for="c in sharedChips" :key="c" :class="[chip, 'border-input text-foreground']">{{ c }}</span>
            <button
              v-for="a in axes"
              :key="a.id"
              type="button"
              :class="[chip, 'border-dashed', editingAxis === a.id ? 'border-ring bg-accent-soft text-accent-soft-foreground' : 'border-input text-foreground hover:bg-hover']"
              :aria-label="$t('intakes.line.editValue', { name: a.name })"
              :aria-expanded="editingAxis === a.id"
              :disabled="disabled"
              @click="editingAxis = editingAxis === a.id ? null : a.id; editingAxis && focusSoon(`#intake-axis-${a.id}`)"
            >
              {{ valueOf(a.id) || a.name }}
              <Pencil class="size-4" aria-hidden="true" />
            </button>
          </div>
          <div v-if="editingAxis" class="grid gap-1.5">
            <Label :for="`intake-axis-${editingAxis}`">{{ axes.find((a) => a.id === editingAxis)?.name }}</Label>
            <Input
              :id="`intake-axis-${editingAxis}`"
              :model-value="valueOf(editingAxis)"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              :disabled="disabled"
              class="h-11"
              @update:model-value="setValue(editingAxis!, String($event))"
              @keydown.enter.prevent="editingAxis = axes.find((a) => a.id !== editingAxis && !valueOf(a.id).trim())?.id ?? null; focusSoon(editingAxis ? `#intake-axis-${editingAxis}` : '#intake-line-amount')"
            />
          </div>
          <p class="text-xs text-muted-foreground wrap-anywhere">
            <template v-if="newItem">{{ $t('intakes.line.newItemCaption') }}</template>
            <template v-else>{{ haveText }}</template>
          </p>
          <div>
            <Button type="button" variant="ghost" size="sm" class="h-9 text-accent-ink" :disabled="disabled" @click="changeItem">{{ $t('intakes.line.change') }}</Button>
          </div>
        </div>

        <p v-if="hint?.kind === 'existing'" :class="[banner, 'banner-ok']" role="status">
          {{ $t('intakes.line.existing', { value: hintValue, amount: formatAmount(hint.have, hintUnit) }) }}
        </p>
        <p v-else-if="hint?.kind === 'archived'" :class="[banner, 'banner-ok']" role="status">{{ $t('intakes.line.archived', { value: hintValue }) }}</p>
        <div v-else-if="hint?.kind === 'new' && !newItem" :class="[banner, 'bg-accent-soft text-accent-soft-foreground']" role="status">
          <p>{{ $t('intakes.line.newValue', { value: hintValue }) }}</p>
          <p v-if="nearestText">{{ nearestText }}</p>
        </div>
        <p v-if="inDraftAlready" :class="[banner, 'flex items-start gap-2 bg-chip text-foreground']" role="status">
          <Info class="mt-0.5 size-4 shrink-0 text-icon" aria-hidden="true" />
          <span>{{ $t('intakes.line.inDraft') }}</span>
        </p>

        <div class="grid gap-1.5" @keydown.enter.prevent="save(!editing)">
          <Label for="intake-line-amount">{{ $t('intakes.line.amount') }}</Label>
          <AmountField id="intake-line-amount" v-model="amount" v-model:unit-key="unitKey" :units="units" />
        </div>

        <div v-if="newItem" class="grid gap-1.5">
          <p class="text-sm font-medium leading-none">{{ $t('intakes.line.folder') }}</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="c in folderChips"
              :key="c.id ?? 'root'"
              type="button"
              :aria-pressed="newItem.folderId === c.id"
              :class="[chip, 'min-h-9 max-w-full', newItem.folderId === c.id ? 'border-ring bg-accent-soft text-accent-soft-foreground' : 'border-input hover:bg-hover']"
              :disabled="disabled"
              @click="setFolder(c.id)"
            >
              <span class="truncate">{{ c.label }}</span>
            </button>
            <button type="button" :class="[chip, 'min-h-9 border-input hover:bg-hover']" :aria-expanded="pickingFolder" :disabled="disabled" @click="pickingFolder = !pickingFolder">
              {{ $t('intakes.line.other') }}
            </button>
          </div>
          <FolderPickerList v-if="pickingFolder" :choices="folderChoices(s, newItem.folderId)" :aria-label="$t('quickAdd.chooseFolder')" @select="setFolder" />
        </div>

        <div class="grid">
          <template v-if="newItem">
            <button type="button" :class="summaryRow" :aria-expanded="attributesOpen" :disabled="disabled" @click="attributesOpen = !attributesOpen">
              <span class="shrink-0 text-sm font-semibold">{{ $t('intakes.line.attributes') }}</span>
              <span class="min-w-0 grow truncate text-right text-sm" :class="attributesSummary ? 'text-foreground' : 'text-muted-foreground'">
                {{ attributesSummary || $t('intakes.line.add') }}
              </span>
              <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="attributesOpen ? 'rotate-180' : ''" aria-hidden="true" />
            </button>
            <div v-if="attributesOpen" class="py-3">
              <IntakeNewItemAttributes v-model="attributes" :snapshot="s" :similar="similarItem" :disabled="disabled" @update:error="attributeError = $event" />
            </div>

            <button type="button" :class="summaryRow" :aria-expanded="tagsOpen" :disabled="disabled" @click="tagsOpen = !tagsOpen">
              <span class="shrink-0 text-sm font-semibold">{{ $t('intakes.line.tags') }}</span>
              <span class="min-w-0 grow truncate text-right text-sm" :class="tagsSummary ? 'text-foreground' : 'text-muted-foreground'">
                {{ tagsSummary || $t('intakes.line.add') }}
              </span>
              <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="tagsOpen ? 'rotate-180' : ''" aria-hidden="true" />
            </button>
            <div v-if="tagsOpen" class="py-3">
              <TagPicker v-model="tagIds" :snapshot="s" :extra-tags="draftTags" :locked="disabled" @create="addTag" />
            </div>
          </template>

          <button type="button" :class="summaryRow" :aria-expanded="priceOpen" :disabled="disabled" @click="priceOpen = !priceOpen">
            <span class="shrink-0 text-sm font-semibold">{{ $t('intakes.line.priceLink') }}</span>
            <span class="min-w-0 grow truncate text-right text-sm" :class="priceSummary ? 'text-foreground' : 'text-muted-foreground'">
              {{ priceSummary || $t('intakes.line.add') }}
            </span>
            <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="priceOpen ? 'rotate-180' : ''" aria-hidden="true" />
          </button>
          <div v-if="priceOpen" class="grid gap-3 py-3" @keydown.enter.prevent="save(!editing)">
            <div class="grid gap-1.5">
              <Label for="intake-line-price">{{ $t('quickAdd.price') }}</Label>
              <div class="relative">
                <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">{{ currencySymbol }}</span>
                <Input id="intake-line-price" v-model="price" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" :disabled="disabled" class="h-11 pl-10" />
              </div>
              <ExpressionHint :preview="pricePreviewOf" />
            </div>
            <div class="grid gap-1.5">
              <Label for="intake-line-url">{{ $t('quickAdd.url') }}</Label>
              <Input id="intake-line-url" v-model="url" type="url" autocomplete="off" :disabled="disabled" class="h-11" />
            </div>
          </div>

          <template v-if="canPhoto">
            <button type="button" :class="summaryRow" :aria-expanded="photoOpen" :disabled="disabled" @click="photoOpen = !photoOpen">
              <span class="shrink-0 text-sm font-semibold">{{ $t('intakes.line.photo') }}</span>
              <span class="flex min-w-0 grow justify-end">
                <PhotoImg v-if="photo || variantPhoto" :photo="(photo ?? variantPhoto)!" size="thumb" alt="" class="size-8 rounded-thumb object-cover" />
                <span v-else class="text-sm text-muted-foreground">{{ $t('intakes.line.add') }}</span>
              </span>
              <ChevronDown class="size-4 shrink-0 text-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none" :class="photoOpen ? 'rotate-180' : ''" aria-hidden="true" />
            </button>
            <div v-if="photoOpen" class="grid gap-2 py-3">
              <div v-if="photo" class="flex items-center gap-3">
                <PhotoImg :photo="photo" size="thumb" alt="" class="size-10 shrink-0 rounded-thumb object-cover" />
                <span class="min-w-0 flex-1 text-sm text-muted-foreground">
                  {{ variantPhoto ? $t(photo.replace ? 'intakes.line.replaces' : 'intakes.line.keepsPhoto') : $t('intakes.line.photoSet') }}
                </span>
                <Button v-if="variantPhoto && !photo.replace" type="button" variant="outline" class="h-9" :disabled="disabled" @click="photo = { ...photo, replace: true }">
                  {{ $t('intakes.line.replacePhoto') }}
                </Button>
                <Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" :aria-label="$t('quickAdd.removePhoto')" :disabled="disabled" @click="photo = null">
                  <X class="size-4" aria-hidden="true" />
                </Button>
              </div>
              <template v-else-if="variantPhoto && !replacing">
                <div class="flex items-center gap-3">
                  <PhotoImg :photo="variantPhoto" size="thumb" alt="" class="size-10 shrink-0 rounded-thumb object-cover" />
                  <span class="min-w-0 flex-1 text-sm text-muted-foreground">{{ $t('intakes.line.currentPhoto') }}</span>
                  <Button type="button" variant="outline" class="h-9" :disabled="disabled" @click="replacing = true">{{ $t('intakes.line.replacePhoto') }}</Button>
                </div>
              </template>
              <p v-else-if="uploading" class="text-sm text-muted-foreground">{{ $t('intakes.line.uploading') }}</p>
              <PhotoPicker v-else :disabled="disabled" @pick="upload($event, replacing)" />
            </div>
          </template>
        </div>
      </template>

      <p role="alert" class="text-sm text-destructive">
        <template v-if="error">{{ $t(error.key, error.params ?? {}) }}</template>
      </p>
    </div>

    <template v-if="mode === 'line'" #footer>
      <template v-if="editing">
        <Button type="button" data-primary class="h-11 rounded-field" :disabled="disabled" @click="save(false)">
          {{ $t(saving ? 'status.saving' : 'intakes.line.save') }}
        </Button>
        <Button type="button" variant="ghost" class="h-11 text-destructive" :disabled="disabled" @click="remove">{{ $t('intakes.line.remove') }}</Button>
      </template>
      <template v-else>
        <Button type="button" data-primary class="h-11 rounded-field" :disabled="disabled" @click="save(true)">
          {{ $t(saving ? 'status.saving' : 'intakes.line.addNext') }}
        </Button>
        <Button type="button" variant="outline" class="h-11" :disabled="disabled" @click="save(false)">{{ $t('intakes.line.addClose') }}</Button>
      </template>
    </template>
  </AppSheet>
</template>

<style scoped>
/* The exact variant, first and marked; and "adding to what you have": a green tint under the page's own text colour,
   which keeps the text's contrast in every style. */
.match-best,
.banner-ok,
.tag-add {
  background: color-mix(in oklab, #16a34a 16%, var(--surface));
  color: var(--foreground);
}
.banner-warn {
  background: color-mix(in oklab, var(--warning) 14%, var(--surface));
  border: 1px solid var(--warning);
  color: var(--foreground);
}
</style>

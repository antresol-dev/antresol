<script setup lang="ts">
import {
  draftAttribute,
  type DraftNewAttribute,
  type EntityProblem,
  type Id,
  type IntakeDraftContent,
  type InventorySnapshot,
  type ResolvedIntake,
} from '@antresol/core'
import { Folder, Pencil, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { nameClash, useExisting, withNewAttribute, withoutNewAttribute } from '~/lib/intake-draft'
import { folderGroups } from '~/lib/intake-entities'
import { UNDO_MIN_MS } from '~/lib/undo'

// "Will be created" on a draft intake's screen (spec 2026-11-16 §4): the draft's folders (compact trees under their
// nearest existing parent), attributes and new items. A block with nothing in it is not shown. A folder or an attribute
// that the commit would refuse shows why, with "Use existing" where the cause is a name that is taken.
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

const groups = computed(() => folderGroups(props.snapshot, props.content))
const attributes = computed(() => props.content.newAttributes ?? [])
const items = computed(() => props.content.newItems)
const problems = computed(() => new Map(props.resolved.entities.map((e) => [e.id, e.problem] as const)))
const problemOf = (id: Id): EntityProblem | null => problems.value.get(id) ?? null
const problemKey = (p: EntityProblem): string => `intakes.entity.problem.${p.code}`

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
  [t(a.kind === 'text' ? 'attributeForm.text' : a.kind === 'enum' ? 'attributeForm.list' : 'attributeForm.number'), a.unit || null, a.siPrefixes ? t('intakes.screen.siPrefixes') : null]
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
async function removeAttribute(a: DraftNewAttribute): Promise<void> {
  const result = withoutNewAttribute(props.content, a.id)
  if ('errorKey' in result) {
    toast.error(t(result.errorKey, result.params ?? {}))
    return
  }
  if (!(await props.edit((c) => {
    const r = withoutNewAttribute(c, a.id)
    return 'errorKey' in r ? c : r
  }))) return
  toast(t('intakes.attribute.removed', { name: a.name }), {
    duration: UNDO_MIN_MS,
    action: {
      label: t('undo.action'),
      onClick: () =>
        void props.edit((c) => {
          const r = withNewAttribute(c, props.snapshot, a)
          return 'errorKey' in r ? c : r
        }),
    },
  })
}

// A row is the rounded element that carries the hover highlight and fills the list's row edge to edge (like FolderList);
// its control keeps the padding and the focus ring, side actions sit in the same row.
const dividerClass =
  "relative not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
const rowClass = `${dividerClass} flex min-h-11 min-w-0 items-center gap-2 rounded-field transition-colors duration-(--dur-fast)`
const infoRowClass = `${dividerClass} flex min-h-9 min-w-0 items-center gap-2 px-3 py-1`
const hoverClass = computed(() => (props.readOnly ? '' : 'hover:bg-hover'))
const tapClass =
  'flex min-h-11 min-w-0 grow items-center gap-2 rounded-field px-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none'
const existingLink =
  'inline-flex min-h-11 mr-2 max-w-[45%] min-w-0 items-center rounded-chip px-1 text-sm font-semibold underline underline-offset-2 hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
</script>

<template>
  <section v-if="groups.length > 0 || attributes.length > 0 || items.length > 0" class="grid min-w-0 grid-cols-1 gap-3" :aria-label="$t('intakes.willCreate.title')">
    <h2 class="section-label px-1 text-xs">{{ $t('intakes.willCreate.title') }}</h2>

    <div v-if="groups.length > 0" class="grid min-w-0 gap-1">
      <h3 class="px-1 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.folders') }}</h3>
      <ul class="surface-list">
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

    <div v-if="attributes.length > 0" class="grid min-w-0 gap-1">
      <h3 class="px-1 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.attributes') }}</h3>
      <ul class="surface-list">
        <li v-for="a in attributes" :key="a.id" :class="[rowClass, hoverClass]">
          <button type="button" :class="tapClass" :aria-label="$t('intakes.attribute.edit', { name: a.name })" :disabled="readOnly" @click="openAttribute(a)">
            <span class="grid min-w-0 gap-0.5">
              <span class="min-w-0 truncate font-semibold">{{ a.name }}</span>
              <span class="min-w-0 truncate text-xs text-muted-foreground">
                {{ kindText(a) }}<template v-if="problemOf(a.id)"> · <span class="text-destructive">{{ $t(problemKey(problemOf(a.id)!)) }}</span></template>
              </span>
            </span>
            <Pencil class="ml-auto size-4 shrink-0 text-icon" aria-hidden="true" />
          </button>
          <button v-if="existingOf(problemOf(a.id))" type="button" :class="existingLink" :disabled="readOnly" @click="takeExisting(a.id, existingOf(problemOf(a.id))!)">
            <span class="min-w-0 truncate">{{ $t('intakes.useExisting', { name: existingName(existingOf(problemOf(a.id))!) }) }}</span>
          </button>
          <Button type="button" variant="ghost" size="icon" class="size-11 shrink-0" :aria-label="$t('intakes.attribute.remove', { name: a.name })" :disabled="readOnly" @click="removeAttribute(a)">
            <X class="size-4" aria-hidden="true" />
          </Button>
        </li>
      </ul>
    </div>

    <div v-if="items.length > 0" class="grid min-w-0 gap-1">
      <h3 class="px-1 text-sm font-semibold text-muted-foreground">{{ $t('intakes.willCreate.items') }}</h3>
      <ul class="surface-list">
        <li v-for="item in items" :key="item.id" class="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-3 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']">
          <IntakeNewItemCard :item="item" :content="content" :snapshot="snapshot" :problem="problemOf(item.id)" :read-only="readOnly" :edit="edit" />
        </li>
      </ul>
    </div>
  </section>
  <AppSheet v-model:open="editOpen" :title="$t('intakes.attribute.editTitle')" :locked="formBusy" initial-focus="#attribute-name">
    <div class="mt-4">
      <AttributeForm
        v-if="editing"
        v-model:busy="formBusy"
        :attribute="editingAttribute"
        draft
        :clash="clash"
        @draft="saveAttribute"
        @use-existing="useExistingAttribute"
      />
    </div>
  </AppSheet>
</template>

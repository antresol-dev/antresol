<script setup lang="ts">
import { isUploadcareCdnBase } from '@graymatter/files-uploadcare'
import { Eye, EyeOff } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessageKey } from '~/lib/errors'
import { canSaveSource, checkConnectionString, createNeonDriver, photoStoreProblem, type SourceProbe } from '~/lib/sources'
import type { PhotoStore, SourceConfig } from '~/lib/types'

const props = defineProps<{ source?: SourceConfig }>()

const { t } = useI18n()
const workspace = useWorkspace()
const router = useRouter()
const driver = createNeonDriver()

const name = ref(props.source?.name ?? t('sourceForm.defaultName'))
const connectionString = ref(props.source?.connectionString ?? '')
const PHOTO_STORES: readonly PhotoStore[] = ['uploadcare', 'cloudinary', 'imgur']
const KEY_LINKS: Record<PhotoStore, string> = {
  uploadcare: 'https://app.uploadcare.com/',
  cloudinary: 'https://console.cloudinary.com/settings/upload/presets',
  imgur: 'https://api.imgur.com/oauth2/addclient',
}
function keyLink(p: PhotoStore): string {
  return KEY_LINKS[p]
}
const photoStore = ref<PhotoStore>(props.source?.photoStore ?? 'uploadcare')
const cloudinaryCloud = ref(props.source?.cloudinaryCloudName ?? '')
const cloudinaryPreset = ref(props.source?.cloudinaryUploadPreset ?? '')
const imgurClientId = ref(props.source?.imgurClientId ?? '')
const uploadcareKey = ref(props.source?.uploadcarePublicKey ?? '')
const uploadcareCdn = ref(props.source?.uploadcareCdnBase ?? '')
const cdnProblem = ref(false)
const storeProblem = ref<ReturnType<typeof photoStoreProblem>>(null)
const reveal = ref(false)
const problem = ref<ReturnType<typeof checkConnectionString>>(null)
const probe = ref<SourceProbe | null>(null)
const checking = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const checkError = ref<string | null>(null)

/** Trimmed, without trailing slashes; null when empty. Must be an Uploadcare delivery host (see isUploadcareCdnBase). */
function cdnBase(): string | null {
  return uploadcareCdn.value.trim().replace(/\/+$/, '') || null
}

function cdnValid(): boolean {
  if (photoStore.value !== 'uploadcare') return true
  const v = cdnBase()
  return v === null || isUploadcareCdnBase(v)
}

const draft = (): Omit<SourceConfig, 'id' | 'createdAt'> => ({
  kind: 'neon',
  name: name.value.trim() || t('sourceForm.defaultName'),
  connectionString: connectionString.value.trim(),
  photoStore: photoStore.value,
  uploadcarePublicKey: uploadcareKey.value.trim() || null,
  uploadcareCdnBase: cdnBase(),
  cloudinaryCloudName: cloudinaryCloud.value.trim() || null,
  cloudinaryUploadPreset: cloudinaryPreset.value.trim() || null,
  imgurClientId: imgurClientId.value.trim() || null,
})

watch(uploadcareCdn, () => {
  cdnProblem.value = false
})
watch([photoStore, cloudinaryCloud, cloudinaryPreset], () => {
  storeProblem.value = null
})

/** Both checks of the photo settings; true when they pass. */
function photoSettingsOk(): boolean {
  cdnProblem.value = !cdnValid()
  storeProblem.value = photoStoreProblem(draft())
  return !cdnProblem.value && storeProblem.value === null
}

watch(connectionString, () => {
  probe.value = null
  problem.value = null
  saveError.value = null
  checkError.value = null
})

async function check(): Promise<void> {
  if (!photoSettingsOk()) return
  problem.value = checkConnectionString(connectionString.value)
  probe.value = null
  checkError.value = null
  if (problem.value) return
  checking.value = true
  try {
    probe.value = await driver.probe({ ...draft(), id: props.source?.id ?? '', createdAt: '' })
  } catch (e) {
    checkError.value = errorMessageKey(e)
  } finally {
    checking.value = false
  }
}

const inspection = computed(() => (probe.value?.ok ? probe.value.inspection : null))
/** A database the source cannot use (foreign, or made by a pre-release build): reported as a problem, nothing to save. */
const unusable = computed(() => inspection.value !== null && !canSaveSource(inspection.value))
const resultKey = computed(() => {
  if (!probe.value) return null
  return probe.value.ok ? `sourceForm.result.${probe.value.inspection.state}` : errorMessageKey(probe.value)
})
const saveKey = computed(() =>
  inspection.value && !unusable.value ? `sourceForm.save.${inspection.value.state}` : null,
)

async function save(): Promise<void> {
  if (!photoSettingsOk()) return
  saving.value = true
  saveError.value = null
  try {
    if (props.source) await workspace.updateSource(props.source.id, draft())
    else await workspace.addSource(draft())
    await router.push('/')
  } catch (e) {
    saveError.value = errorMessageKey(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="grid gap-3.5" novalidate @submit.prevent="check">
    <div class="grid gap-1.5">
      <Label for="source-name">{{ $t('sourceForm.name') }}</Label>
      <Input id="source-name" v-model="name" autocomplete="off" class="h-11" />
    </div>

    <div class="grid gap-1.5">
      <Label for="source-cs">{{ $t('sourceForm.connectionString') }}</Label>
      <div class="flex gap-2">
        <Input
          id="source-cs"
          v-model="connectionString"
          :type="reveal ? 'text' : 'password'"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :aria-invalid="problem ? true : undefined"
          aria-describedby="source-cs-hint source-cs-problem"
          class="h-11"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="size-11 shrink-0"
          :aria-label="$t(reveal ? 'sourceForm.hide' : 'sourceForm.show')"
          :aria-pressed="reveal"
          @click="reveal = !reveal"
        >
          <EyeOff v-if="reveal" />
          <Eye v-else />
        </Button>
      </div>
      <p id="source-cs-hint" class="text-sm text-subtle-foreground">{{ $t('sourceForm.connectionStringHint') }}</p>
      <p id="source-cs-problem" role="alert" class="text-sm text-destructive">
        <template v-if="problem">{{ $t(`sourceForm.problem.${problem}`) }}</template>
      </p>
    </div>

    <fieldset class="grid gap-1.5">
      <legend class="mb-1.5 text-sm font-medium">{{ $t('sourceForm.photoStore') }}</legend>
      <div class="flex gap-2" role="group" :aria-label="$t('sourceForm.photoStore')">
        <Button
          v-for="p in PHOTO_STORES"
          :key="p"
          type="button"
          size="sm"
          :variant="photoStore === p ? 'default' : 'outline'"
          :aria-pressed="photoStore === p"
          class="h-9 flex-1 rounded-field"
          @click="photoStore = p"
        >{{ $t(`sourceForm.store.${p}`) }}</Button>
      </div>
      <p class="text-sm text-subtle-foreground">{{ $t('sourceForm.photoStoreHint') }}</p>
    </fieldset>

    <template v-if="photoStore === 'uploadcare'">
    <div class="grid gap-1.5">
      <Label for="source-key">
        {{ $t('sourceForm.uploadcareKey') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('sourceForm.optional') }}</span>
      </Label>
      <Input id="source-key" v-model="uploadcareKey" autocomplete="off" class="h-11" />
      <p class="text-sm text-subtle-foreground">
        {{ $t('sourceForm.uploadcareKeyHint') }}
        <a
          :href="keyLink('uploadcare')"
          target="_blank"
          rel="noopener noreferrer"
          class="underline underline-offset-2"
        >{{ $t('sourceForm.uploadcareKeyLink') }}</a>
      </p>
    </div>

    <div class="grid gap-1.5">
      <Label for="source-cdn">
        {{ $t('sourceForm.uploadcareCdn') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('sourceForm.optional') }}</span>
      </Label>
      <Input
        id="source-cdn"
        v-model="uploadcareCdn"
        type="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="https://abc123.ucarecd.net"
        :aria-invalid="cdnProblem ? true : undefined"
        aria-describedby="source-cdn-problem"
        class="h-11"
      />
      <p class="text-sm text-subtle-foreground">{{ $t('sourceForm.uploadcareCdnHint') }}</p>
      <p id="source-cdn-problem" role="alert" class="text-sm text-destructive">
        <template v-if="cdnProblem">{{ $t('sourceForm.problem.cdn') }}</template>
      </p>
    </div>

    </template>

    <template v-else-if="photoStore === 'cloudinary'">
      <div class="grid gap-1.5">
        <Label for="source-cloud">
          {{ $t('sourceForm.cloudinaryCloud') }}
          <span class="font-normal text-subtle-foreground">· {{ $t('sourceForm.optional') }}</span>
        </Label>
        <Input
          id="source-cloud"
          v-model="cloudinaryCloud"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :aria-invalid="storeProblem === 'cloudinaryCloud' || storeProblem === 'cloudinaryCloudFormat' ? true : undefined"
          aria-describedby="source-store-problem"
          class="h-11"
        />
      </div>
      <div class="grid gap-1.5">
        <Label for="source-preset">
          {{ $t('sourceForm.cloudinaryPreset') }}
          <span class="font-normal text-subtle-foreground">· {{ $t('sourceForm.optional') }}</span>
        </Label>
        <Input
          id="source-preset"
          v-model="cloudinaryPreset"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :aria-invalid="storeProblem === 'cloudinaryPreset' ? true : undefined"
          aria-describedby="source-store-problem"
          class="h-11"
        />
        <p id="source-store-problem" role="alert" class="text-sm text-destructive">
          <template v-if="storeProblem">{{ $t(`sourceForm.problem.${storeProblem}`) }}</template>
        </p>
        <p class="text-sm text-subtle-foreground">
          {{ $t('sourceForm.cloudinaryHint') }}
          <a
            :href="keyLink('cloudinary')"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2"
          >{{ $t('sourceForm.cloudinaryLink') }}</a>
        </p>
      </div>
    </template>

    <div v-else class="grid gap-1.5">
      <Label for="source-imgur">
        {{ $t('sourceForm.imgurClientId') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('sourceForm.optional') }}</span>
      </Label>
      <Input
        id="source-imgur"
        v-model="imgurClientId"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        class="h-11"
      />
      <p class="text-sm text-subtle-foreground">
        {{ $t('sourceForm.imgurHint') }}
        <a
          :href="keyLink('imgur')"
          target="_blank"
          rel="noopener noreferrer"
          class="underline underline-offset-2"
        >{{ $t('sourceForm.imgurLink') }}</a>
      </p>
    </div>

    <Button type="submit" variant="outline" class="h-11" :disabled="checking || saving">
      {{ $t(checking ? 'sourceForm.checking' : 'sourceForm.check') }}
    </Button>

    <div v-if="resultKey && probe?.ok && !unusable" role="status" class="grid gap-1 text-sm">
      <p>{{ $t(resultKey) }}</p>
    </div>
    <!-- A database the source cannot use, or a failed check, is a problem: announced at once. -->
    <div v-else-if="resultKey" role="alert" class="grid gap-1 text-sm text-destructive">
      <p>{{ $t(resultKey) }}</p>
    </div>
    <p v-if="checkError" role="alert" class="text-sm text-destructive">{{ $t(checkError) }}</p>

    <p v-if="saveError" role="alert" class="text-sm text-destructive">{{ $t(saveError) }}</p>

    <Button v-if="saveKey" type="button" class="h-11 rounded-field" :disabled="saving" @click="save">
      {{ $t(saving ? 'sourceForm.saving' : saveKey) }}
    </Button>
  </form>
</template>

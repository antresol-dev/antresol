<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessageKey } from '~/lib/errors'
import { checkConnectionString, createNeonDriver, type SourceProbe } from '~/lib/sources'
import type { SourceConfig } from '~/lib/types'

const props = defineProps<{ source?: SourceConfig }>()

const { t } = useI18n()
const workspace = useWorkspace()
const router = useRouter()
const driver = createNeonDriver()

const name = ref(props.source?.name ?? t('sourceForm.defaultName'))
const connectionString = ref(props.source?.connectionString ?? '')
const uploadcareKey = ref(props.source?.uploadcarePublicKey ?? '')
const uploadcareCdn = ref(props.source?.uploadcareCdnBase ?? '')
const reveal = ref(false)
const problem = ref<ReturnType<typeof checkConnectionString>>(null)
const probe = ref<SourceProbe | null>(null)
const checking = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const checkError = ref<string | null>(null)

const draft = (): Omit<SourceConfig, 'id' | 'createdAt'> => ({
  kind: 'neon',
  name: name.value.trim() || t('sourceForm.defaultName'),
  connectionString: connectionString.value.trim(),
  uploadcarePublicKey: uploadcareKey.value.trim() || null,
  uploadcareCdnBase: uploadcareCdn.value.trim() || null,
})

watch(connectionString, () => {
  probe.value = null
  problem.value = null
  saveError.value = null
  checkError.value = null
})

async function check(): Promise<void> {
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

const inspection = computed(() => (probe.value?.ok ? probe.value.inspection.state : null))
const resultKey = computed(() => {
  if (!probe.value) return null
  return probe.value.ok ? `sourceForm.result.${probe.value.inspection.state}` : errorMessageKey(probe.value)
})
const saveKey = computed(() =>
  inspection.value && inspection.value !== 'foreign' ? `sourceForm.save.${inspection.value}` : null,
)

async function save(): Promise<void> {
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
      <Input id="source-name" v-model="name" autocomplete="off" class="h-11 rounded-field bg-surface" />
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
          class="h-11 rounded-field bg-surface"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="size-11 shrink-0 rounded-field bg-surface"
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

    <div class="grid gap-1.5">
      <Label for="source-key">
        {{ $t('sourceForm.uploadcareKey') }}
        <span class="font-normal text-subtle-foreground">· {{ $t('sourceForm.optional') }}</span>
      </Label>
      <Input id="source-key" v-model="uploadcareKey" autocomplete="off" class="h-11 rounded-field bg-surface" />
      <p class="text-sm text-subtle-foreground">{{ $t('sourceForm.uploadcareKeyHint') }}</p>
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
        class="h-11 rounded-field bg-surface"
      />
      <p class="text-sm text-subtle-foreground">{{ $t('sourceForm.uploadcareCdnHint') }}</p>
    </div>

    <Button type="submit" variant="outline" class="h-11 rounded-field bg-surface" :disabled="checking || saving">
      {{ $t(checking ? 'sourceForm.checking' : 'sourceForm.check') }}
    </Button>

    <div v-if="resultKey && probe?.ok && inspection !== 'foreign'" role="status" class="grid gap-1 text-sm">
      <p>{{ $t(resultKey) }}</p>
    </div>
    <!-- A database that is not GrayMatter's, or a failed check, is a problem: announced at once. -->
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

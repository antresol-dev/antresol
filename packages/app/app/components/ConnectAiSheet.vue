<script setup lang="ts">
import { encodeConnectionKey } from '@antresol/kit'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { connectionSettingsOf } from '~/lib/connection-share'
import type { SourceConfig } from '~/lib/types'

// Settings → a source → "Connect AI": copies the source's connection key for the local MCP server. The key is a
// secret: it goes to the clipboard and is never shown here or logged.
const props = defineProps<{ source: SourceConfig | null }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

// The last source stays while the sheet animates out.
const shown = shallowRef<SourceConfig | null>(props.source)
watch(
  () => props.source,
  (s) => {
    if (s) shown.value = s
  },
)

async function copy(): Promise<void> {
  if (!shown.value) return
  try {
    await navigator.clipboard.writeText(encodeConnectionKey(connectionSettingsOf(shown.value)))
    toast.success(t('connectAi.copied'))
  } catch {
    toast.error(t('connectAi.copyFailed'))
  }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="$t('connectAi.title')" :summary="shown?.name">
    <div class="grid gap-3.5 pt-2">
      <p class="text-sm text-subtle-foreground">{{ $t('connectAi.intro') }}</p>
      <Button type="button" class="h-11 rounded-field" data-primary @click="copy">{{ $t('connectAi.copy') }}</Button>
      <p class="text-sm text-subtle-foreground">{{ $t('connectAi.warning') }}</p>
      <a
        href="https://github.com/antresol-dev/antresol/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex min-h-11 items-center rounded-chip text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
      >
        {{ $t('connectAi.setup') }}
      </a>
    </div>
  </AppSheet>
</template>

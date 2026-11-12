<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { clearErrors, formatErrors, readErrors, type DiagnosticEntry } from '~/lib/diagnostics'

// Settings → Diagnostics: the last errors this device saw (no connection strings, no keys), to copy or share.
const { t } = useI18n()
const entries = ref<DiagnosticEntry[]>([])
const text = computed(() => formatErrors(entries.value))
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

async function load(): Promise<void> {
  entries.value = await readErrors()
}
onMounted(load)

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    toast.success(t('diagnostics.copied'))
  } catch {
    toast.error(t('diagnostics.copyFailed'))
  }
}

async function share(): Promise<void> {
  try {
    await navigator.share({ title: 'Antresol diagnostics', text: text.value })
  } catch {
    // Cancelled by the person, or not possible: nothing to report.
  }
}

async function clear(): Promise<void> {
  await clearErrors()
  await load()
}

const time = (iso: string): string => new Date(iso).toLocaleString()
</script>

<template>
  <section class="grid gap-2" aria-labelledby="settings-diagnostics">
    <h2 id="settings-diagnostics" class="section-label text-sm">{{ $t('diagnostics.title') }}</h2>
    <div class="raised-card grid gap-2 p-4.5">
      <p class="text-sm text-subtle-foreground">{{ $t('diagnostics.hint') }}</p>
      <p v-if="!entries.length" class="text-sm">{{ $t('diagnostics.empty') }}</p>
      <ul v-else class="max-h-64 divide-y divide-divider overflow-y-auto rounded-field border border-input bg-field" :aria-label="$t('diagnostics.title')">
        <li v-for="(e, i) in entries" :key="i" class="grid gap-0.5 px-3 py-2 text-[13px]">
          <span class="text-subtle-foreground">{{ time(e.at) }} · {{ e.where }} · {{ e.code }}</span>
          <span class="break-words">{{ e.message }}</span>
        </li>
      </ul>
      <div class="-mx-2 flex flex-wrap">
        <Button variant="ghost" class="h-11 text-accent-ink" :disabled="!entries.length" @click="copy">
          {{ $t('diagnostics.copy') }}
        </Button>
        <Button v-if="canShare" variant="ghost" class="h-11 text-accent-ink" :disabled="!entries.length" @click="share">
          {{ $t('diagnostics.share') }}
        </Button>
        <Button variant="ghost" class="h-11 text-destructive" :disabled="!entries.length" @click="clear">
          {{ $t('diagnostics.clear') }}
        </Button>
      </div>
    </div>
  </section>
</template>

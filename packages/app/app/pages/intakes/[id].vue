<script setup lang="ts">
import { Pencil } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { intakeTitle } from '~/lib/intake-list'

definePageMeta({ layout: 'default' })

const { t } = useI18n()
const route = useRoute('intakes-id')
const id = computed(() => String(route.params.id))
const { state } = useWorkspace()
const { list, loading, failureKey, reload } = useIntakeList()

const snapshot = computed(() => {
  const s = state.snapshot
  return s && s.inventory.id === state.current?.inventoryId ? s : null
})
const intake = computed(() => list.value?.find((i) => i.id === id.value) ?? null)
const shops = computed(() => [...new Set((list.value ?? []).map((i) => i.header.shop?.trim()).filter((x): x is string => !!x))].sort())

const editing = ref(false)
const crumbs = computed(() => [{ name: t('intakes.title'), to: '/intakes' }])
const title = computed(() => (intake.value ? intakeTitle(intake.value.header) : t('intakes.title')))
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="title" :crumbs="crumbs" wrap-title>
      <template v-if="intake?.status === 'committed'" #actions="{ compact }">
        <Button v-if="compact" variant="ghost" size="icon" class="size-11 disabled:opacity-35" :aria-label="$t('intakes.edit')" :disabled="!!state.readOnly" @click="editing = true">
          <Pencil class="size-5" aria-hidden="true" />
        </Button>
        <Button v-else variant="outline" class="h-9 rounded-field" :disabled="!!state.readOnly" @click="editing = true">
          <Pencil class="size-4" aria-hidden="true" />
          {{ $t('intakes.edit') }}
        </Button>
      </template>
    </ScreenHeader>
    <ScreenBody>
      <div v-if="loading || (snapshot === null && !failureKey)" class="grid grid-cols-1 gap-3.5" aria-hidden="true">
        <Skeleton class="h-40 rounded-card" />
      </div>
      <EmptyState v-else-if="failureKey" :text="$t(failureKey)">
        <Button variant="outline" class="h-11" @click="reload">{{ $t('status.retry') }}</Button>
      </EmptyState>
      <template v-else-if="snapshot">
        <template v-if="intake?.status === 'committed'">
          <IntakeRecord :intake="intake" :snapshot="snapshot" />
          <IntakeHeaderSheet v-model:open="editing" :intake-id="intake.id" :header="intake.header" :shops="shops" @saved="reload" />
        </template>
        <!-- The draft screen is Task 6's; a draft (or an intake not in the database yet) shows a placeholder. -->
        <EmptyState v-else :text="$t('intakes.draftSoon')" />
      </template>
    </ScreenBody>
  </main>
</template>

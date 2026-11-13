<script setup lang="ts">
import { newId } from '@antresol/core'
import { Plus, Search } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessageKey } from '~/lib/errors'
import { canCreateIntake, intakeRows, searchIntakes } from '~/lib/intake-list'

definePageMeta({ layout: 'default' })

const { t } = useI18n()
const { state } = useWorkspace()
const intakes = useIntakes()
const { list, loading, failureKey, offlineList, reload } = useIntakeList()
/** The database's list with this device's drafts; offline, the drafts this device holds. */
const shown = computed(() => list.value ?? offlineList.value)

// The current inventory's snapshot only: never another inventory's paired with the current ref.
const snapshot = computed(() => {
  const s = state.snapshot
  return s && s.inventory.id === state.current?.inventoryId ? s : null
})

const query = ref('')
const rows = computed(() => {
  const s = snapshot.value
  if (!s || !shown.value) return []
  return intakeRows(searchIntakes(shown.value, s, query.value), s)
})
const empty = computed(() => shown.value !== null && shown.value.length === 0)
const noMatch = computed(() => shown.value !== null && shown.value.length > 0 && rows.value.length === 0)

const creating = ref(false)
const canCreate = computed(() => canCreateIntake(state.readOnly))
// A new intake lives on this device until its first edit (offline too); the screen opens it by its id.
async function create(): Promise<void> {
  if (creating.value || !canCreate.value) return
  creating.value = true
  try {
    const id = newId()
    await intakes.drafts.load(id, null)
    await navigateTo(`/intakes/${id}`)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="$t('intakes.title')">
      <template #actions="{ compact }">
        <Button v-if="compact" variant="ghost" size="icon" class="size-11 disabled:opacity-35" :aria-label="$t('intakes.new')" :disabled="creating || !canCreate" @click="create">
          <Plus class="size-5" aria-hidden="true" />
        </Button>
        <Button v-else class="h-9 rounded-field" :disabled="creating || !canCreate" @click="create">
          <Plus class="size-4" aria-hidden="true" />
          {{ $t('intakes.new') }}
        </Button>
      </template>
    </ScreenHeader>
    <ScreenBody>
      <div v-if="loading || (snapshot === null && state.current !== null && !failureKey)" class="grid grid-cols-1 gap-3.5" aria-hidden="true">
        <Skeleton class="h-11 rounded-field" />
        <Skeleton class="h-40 rounded-card" />
      </div>
      <EmptyState v-else-if="failureKey && (!offlineList || empty)" :text="$t(offlineList ? 'intakes.offlineList' : failureKey)">
        <Button variant="outline" class="h-11" @click="reload">{{ $t('status.retry') }}</Button>
      </EmptyState>
      <EmptyState v-else-if="empty" :text="$t('intakes.empty')" />
      <template v-else>
        <div class="relative">
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon" aria-hidden="true" />
          <Input
            v-model="query"
            type="search"
            autocomplete="off"
            :aria-label="$t('intakes.search')"
            :placeholder="$t('intakes.search')"
            class="h-11 pl-9"
          />
        </div>
        <p v-if="offlineList" class="text-[13px] text-muted-foreground">{{ $t('intakes.offlineList') }}</p>
        <EmptyState v-if="noMatch" :text="$t('intakes.noMatch')" />
        <IntakeList v-else :rows="rows" />
      </template>
    </ScreenBody>
  </main>
</template>

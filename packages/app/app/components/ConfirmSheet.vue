<script setup lang="ts">
import { Button } from '@/components/ui/button'

defineProps<{
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  destructive?: boolean
}>()
defineEmits<{ confirm: [] }>()
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <AppSheet v-model:open="open" :title="title" :description="description">
    <template #footer>
      <Button
        type="button"
        :variant="destructive ? 'destructive' : 'default'"
        class="h-11 rounded-field"
        :disabled="busy"
        @click="$emit('confirm')"
      >
        {{ confirmLabel }}
      </Button>
      <Button type="button" variant="outline" class="h-11 rounded-field bg-surface" :disabled="busy" @click="open = false">
        {{ $t('ui.cancel') }}
      </Button>
    </template>
  </AppSheet>
</template>

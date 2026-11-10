<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

defineProps<{ title: string; description?: string }>()
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close-button="false"
      class="top-auto bottom-0 left-0 max-w-full translate-x-0 translate-y-0 rounded-b-none rounded-t-card border-x-0 border-b-0 bg-surface p-4 pb-6 sm:max-w-full md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-[480px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border md:pb-4"
    >
      <DialogHeader class="text-left">
        <DialogTitle class="text-lg font-bold tracking-[-0.02em]">{{ title }}</DialogTitle>
        <DialogDescription :class="description ? 'text-subtle-foreground' : 'sr-only'">
          {{ description ?? title }}
        </DialogDescription>
      </DialogHeader>
      <slot />
      <DialogFooter v-if="$slots.footer" class="gap-2">
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

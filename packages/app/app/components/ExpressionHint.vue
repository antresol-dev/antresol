<script setup lang="ts">
import type { ExpressionPreview } from '~/lib/amounts'

// The line under an amount or price field that holds an expression: "= 3.7 m", or what is wrong with it.
defineProps<{ preview: ExpressionPreview | null }>()
</script>

<template>
  <p v-if="preview" class="field-text text-xs tabular-nums" :class="'errorKey' in preview ? 'text-destructive' : 'text-muted-foreground'" aria-live="polite">
    {{ 'errorKey' in preview ? $t(preview.errorKey) : $t('expression.result', { value: preview.text }) }}
  </p>
</template>

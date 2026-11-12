<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "cn"
import { TooltipArrow, TooltipContent, TooltipPortal, useForwardPropsEmits } from "reka-ui"

// The tooltips repeat their trigger's name for sighted users (TooltipTrigger drops the description), so the pane is
// hidden from screen readers too: they hear the name once, from the trigger. Pop-in/out are main.css's animations.

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<TooltipContentProps & { class?: HTMLAttributes["class"] }>(), {
  sideOffset: 4,
})

const emits = defineEmits<TooltipContentEmits>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      aria-hidden="true"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="cn('surface-tip motion-safe:animate-pop-in motion-safe:data-[state=closed]:animate-pop-out motion-reduce:animate-fade-in motion-reduce:data-[state=closed]:animate-fade-out z-50 w-fit origin-(--reka-tooltip-content-transform-origin) rounded-chip px-3 py-1.5 text-xs text-balance', props.class)"
    >
      <slot />

      <TooltipArrow class="bg-(--st-tip) fill-(--st-tip) z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-xs" />
    </TooltipContent>
  </TooltipPortal>
</template>

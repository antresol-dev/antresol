<script lang="ts">
import type { TooltipTriggerProps } from "reka-ui"
import type { PropType, VNode } from "vue"
// Aliased: Nuxt rewrites a bare TooltipTrigger in a render function to this very component (shadcn-nuxt registers it).
import { TooltipTrigger as RekaTooltipTrigger } from "reka-ui"
import { cloneVNode, defineComponent, Fragment, h } from "vue"

/*
 * The app's tooltips show an icon button's own name (its aria-label) to sighted users. Reka points the trigger's
 * aria-describedby at a hidden copy of the tooltip text, so a screen reader would read the name twice ("Back, Back"):
 * the trigger opts out. Reka's as-child merges its attributes under the child's own props, so an explicit undefined on
 * the child wins.
 */
function withoutDescription(nodes: VNode[]): VNode[] {
  return nodes.map((node) => {
    if (node.type === Fragment && Array.isArray(node.children)) return h(Fragment, withoutDescription(node.children as VNode[]))
    return typeof node.type === "symbol" ? node : cloneVNode(node, { "aria-describedby": undefined })
  })
}

export default defineComponent({
  name: "TooltipTrigger",
  props: {
    as: { type: [String, Object, Function] as PropType<TooltipTriggerProps["as"]>, default: "button" },
    asChild: { type: Boolean, default: false },
    reference: { type: Object as PropType<TooltipTriggerProps["reference"]>, default: undefined },
  },
  setup(props, { slots }) {
    return () => h(RekaTooltipTrigger, { "data-slot": "tooltip-trigger", ...props }, { default: () => withoutDescription(slots.default?.() ?? []) })
  },
})
</script>

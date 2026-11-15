<!-- The content column of a screen. pb-28 leaves room for the phone's bottom bar (Task 6). -->
<template>
  <div
    class="mx-auto grid w-full max-w-[720px] min-w-0 grid-cols-1 content-start gap-4 px-4 pt-4 pb-28 lg:max-w-[760px] lg:px-8 lg:pb-8"
  >
    <slot />
  </div>
</template>

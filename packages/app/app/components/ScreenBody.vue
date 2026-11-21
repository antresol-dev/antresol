<!-- The content column of a screen. pb-28 leaves room for the phone's bottom bar (Task 6). -->
<template>
  <div
    class="mx-auto grid w-full max-w-[720px] min-w-0 grid-cols-1 content-start gap-3 px-4 pt-3 pb-28 lg:max-w-[760px] lg:px-5 lg:pb-6"
  >
    <slot />
  </div>
</template>

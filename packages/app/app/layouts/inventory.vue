<template>
  <div class="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
    <aside class="hidden border-r border-border lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-y-auto">
      <FolderTree />
    </aside>
    <div class="mx-auto grid w-full min-w-0 max-w-[720px] grid-cols-1 content-start gap-3.5 px-4 pt-2.5 pb-6">
      <FolderHeader />
      <AppStatus />
      <slot />
    </div>
  </div>
</template>

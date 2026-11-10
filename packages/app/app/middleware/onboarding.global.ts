export default defineNuxtRouteMiddleware(async (to) => {
  await useWorkspaceReady()
  const noSources = useWorkspace().state.sources.length === 0
  const open = to.path === '/welcome' || to.path === '/settings' || to.path.startsWith('/settings/')
  if (noSources && !open) return navigateTo('/welcome')
})

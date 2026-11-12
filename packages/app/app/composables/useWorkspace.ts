import type { Workspace } from '~/lib/workspace'

export function useWorkspace(): Workspace {
  return useNuxtApp().$workspace
}

/** Resolves once device data and the cached snapshot are loaded (not after the network refresh). */
export function useWorkspaceReady(): Promise<void> {
  return useNuxtApp().$workspaceReady
}

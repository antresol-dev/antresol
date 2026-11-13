import type { Id, IntakeHeader } from '@antresol/core'
import { createIntakeCommitSender, type IntakeCommitSender, type IntakeDraftSync } from '~/lib/intake-drafts'
import type { Workspace } from '~/lib/workspace'

export interface Intakes {
  /** The app's one draft sync (the workspace's): edits go to the device at once and to the database after a pause. */
  drafts: IntakeDraftSync
  list: Workspace['listIntakes']
  deleteDraft: Workspace['deleteIntakeDraft']
  updateHeader(id: Id, header: IntakeHeader): Promise<void>
  uploadPhoto: Workspace['uploadPhoto']
  recentFolders: Workspace['recentFolders']
  /** A commit with the unknown outcome handled (the draft freezes until Retry); one per screen. */
  commitSender(): IntakeCommitSender
}

/** Intakes of the current inventory, for the intake screens. */
export function useIntakes(): Intakes {
  const workspace = useWorkspace()
  return {
    drafts: workspace.intakeDrafts,
    list: () => workspace.listIntakes(),
    deleteDraft: (id) => workspace.deleteIntakeDraft(id),
    updateHeader: (id, header) => workspace.updateIntakeHeader(id, header),
    uploadPhoto: (file) => workspace.uploadPhoto(file),
    recentFolders: () => workspace.recentFolders(),
    // After an unknown outcome the source is marked unreachable; the sync each commit starts with tries it again.
    commitSender: () => createIntakeCommitSender((id) => workspace.commitIntake(id)),
  }
}

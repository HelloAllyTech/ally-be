/**
 * How a roleplay_spec_versions snapshot came to exist. Every mutation of the
 * working draft produces a snapshot so the SSE `spec_patch`/`done` events can
 * carry a stable `specVersionId` and the client can time-travel.
 */
export enum RoleplaySpecVersionSource {
  // Trainer saved the draft through PUT /specs/:id/draft.
  MANUAL_EDIT = 'manual_edit',
  // The copilot applied an RFC-6902 patch via the update_spec tool.
  COPILOT_PATCH = 'copilot_patch',
  // Explicit checkpoint via POST /specs/:id/versions.
  SNAPSHOT = 'snapshot',
  // An auto-improve round folded critique proposals into a scratch version
  // (versions-only lineage — the working draft is never touched mid-run).
  AUTO_IMPROVE = 'auto_improve',
  // Trainer accepted an auto-improve result: best version copied to the draft.
  AUTO_IMPROVE_ACCEPTED = 'auto_improve_accepted',
}

export enum ScenarioVersionStatus {
  // Editable working copy. Many drafts can coexist per scenario.
  DRAFT = 'DRAFT',
  // The single version currently materialised into the live `scenarios` row.
  // At most one PUBLISHED version per scenario at any time.
  PUBLISHED = 'PUBLISHED',
  // A previously-published version, kept immutable for rollback/history.
  ARCHIVED = 'ARCHIVED',
}

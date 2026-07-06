export enum RoleplaySpecVersionStatus {
  // An immutable snapshot of the draft document, not yet published.
  DRAFT = 'DRAFT',
  // The single version currently materialised into the live scenario.
  // At most one PUBLISHED version per spec at any time.
  PUBLISHED = 'PUBLISHED',
  // A previously-published version, kept immutable for rollback/history.
  ARCHIVED = 'ARCHIVED',
}

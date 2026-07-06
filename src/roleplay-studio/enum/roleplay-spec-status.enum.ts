export enum RoleplaySpecStatus {
  // The spec has never had a version published; its thin scenarios row is
  // still DRAFT and invisible to learners.
  DRAFT = 'DRAFT',
  // At least one version is published and materialised into the live
  // scenarios row (scenario status ACTIVE).
  PUBLISHED = 'PUBLISHED',
  // Retired from the catalog; kept for history.
  ARCHIVED = 'ARCHIVED',
}

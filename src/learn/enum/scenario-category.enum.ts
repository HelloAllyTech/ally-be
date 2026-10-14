/**
 * Editorial category of a scenario, used to organise the Simulation Studio
 * list (filterable). Stored as a plain varchar (repo convention — no native
 * PG enum), so adding values here needs no migration.
 */
export enum ScenarioCategory {
  ORIGINALS = 'ORIGINALS',
  DEMO = 'DEMO',
  PARTNER_SIM = 'PARTNER_SIM',
  OTHER = 'OTHER',
  // Roleplays Course Copilot generated for a course. Their own category so
  // the library can filter them out (or in) without a provenance column.
  COURSE_COPILOT = 'COURSE_COPILOT',
}

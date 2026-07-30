/**
 * Shape of roadmap_saved_views.state — a snapshot of the board's filter and sort controls.
 *
 * This is stored jsonb and is written by the frontend, so it is intentionally permissive:
 * unknown keys survive a round-trip, and every field is optional. Two things are load-bearing
 * and must not be "cleaned up":
 *
 * 1. `goalFilter` and `ownerFilter` hold NAMES, not ids. That is why roadmap_opportunities
 *    keeps text foreign keys by name with ON UPDATE CASCADE — a rename propagates and
 *    migrated views keep working. Switching either side to uuids silently breaks all of them.
 *
 * 2. Key ORDER is not preserved by Postgres jsonb, so a view's dirty check must compare a
 *    canonically key-ordered serialisation. Comparing raw JSON.stringify output makes every
 *    saved view look permanently dirty. The frontend owns that serializer
 *    (apps/ally-admin-dashboard/src/pages/ProductRoadmap/utils/views.ts).
 */
export interface RoadmapSavedViewState {
  searchQuery?: string;

  /** RoadmapOpportunityType values. */
  typeFilter?: string[];
  /** RoadmapOpportunityStage values. */
  stageFilter?: string[];
  /** Product goal NAMES — see note 1 above. */
  goalFilter?: string[];
  /** Owner NAMES — see note 1 above. */
  ownerFilter?: string[];
  /** Creator identifiers as the frontend records them. */
  creatorFilter?: string[];

  dateFrom?: string;
  dateTo?: string;
  releasedFrom?: string;
  releasedTo?: string;

  priorityMin?: string | number;
  priorityMax?: string | number;

  sort?: { field?: string; dir?: 'asc' | 'desc' };

  /** Forward-compatibility: unrecognised keys are preserved verbatim. */
  [key: string]: unknown;
}

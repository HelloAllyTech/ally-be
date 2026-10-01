/** Vocabulary shared by the entity, the model's output contract and the API. */

export const UPDATE_KINDS = ['new', 'improved', 'fixed'] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];

/**
 * Who may read an update.
 *
 *  - `public` — the default (decided 2026-10-01): anything of value to anyone,
 *    customers or Ally's own team, including staff tools, reliability and bug
 *    fixes. On the public changelog as soon as every change in it is live.
 *  - `internal` — only work of no value to anyone (tidying, refactors nobody
 *    can notice). Reaches the team digest, never the public page.
 *
 * Deliberately two values, not a review workflow: publishing is fully
 * automatic (decided 2026-09-30), and a wrong call is corrected afterwards by
 * editing or hiding the update.
 */
export const UPDATE_AUDIENCES = ['public', 'internal'] as const;
export type UpdateAudience = (typeof UPDATE_AUDIENCES)[number];

/** Where an update shows up — what the public page filters on. */
export const UPDATE_SURFACES = [
  'web_app',
  'mobile_app',
  'admin_console',
  'whatsapp',
] as const;
export type UpdateSurface = (typeof UPDATE_SURFACES)[number];

/**
 * What an update is about — a label for the digest and the page, from a fixed
 * list so the model cannot coin a new product area.
 */
export const UPDATE_AREAS = [
  'Roleplays',
  'Courses and tracks',
  'Debriefs and feedback',
  'Progress and XP',
  'Scribe',
  'Characters',
  'Authoring',
  'People and organisations',
  'Statistics',
  'WhatsApp assistant',
  'Sign-in and accounts',
  'Languages',
  'Reliability',
  'Accessibility',
  'Staff tools',
] as const;
export type UpdateArea = (typeof UPDATE_AREAS)[number];

/** Fields a person can edit. Once edited, the consolidation job never overwrites them. */
export const EDITABLE_UPDATE_FIELDS = [
  'title',
  'summary',
  'teamNotes',
  'kind',
  'audience',
  'surfaces',
  'area',
] as const;
export type EditableUpdateField = (typeof EDITABLE_UPDATE_FIELDS)[number];

export const TITLE_MAX = 90;
export const SUMMARY_MAX = 320;
export const TEAM_NOTES_MAX = 2000;

/** Below this the digest lists an update under "worth a look". */
export const LOW_CONFIDENCE = 0.6;

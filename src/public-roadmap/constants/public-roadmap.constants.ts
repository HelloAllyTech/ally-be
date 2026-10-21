/**
 * The public roadmap's two axes. Both are fixed in code on purpose: the page
 * is a grid of categories × stages, and its column headings, stage
 * descriptions and category blurbs are written in the frontend. Only the cards
 * that sit in the grid are edited from the admin console.
 *
 * Order matters — it is the order the page draws rows (categories) and
 * columns (stages, least to most mature).
 */
export const ROADMAP_CATEGORIES = ['prepare', 'perform'] as const;
export type RoadmapCategory = (typeof ROADMAP_CATEGORIES)[number];

export const ROADMAP_STAGES = [
  'idea',
  'lab',
  'beta',
  'released',
  'stable',
] as const;
export type RoadmapStage = (typeof ROADMAP_STAGES)[number];

/**
 * Card copy limits. A card is a title, two or three lines of description and
 * an optional one-line note ("Current priority", "Pilot in 3 months"); the
 * grid has five columns, so anything longer wraps into a wall of text.
 */
export const ROADMAP_TITLE_MAX_LENGTH = 60;
export const ROADMAP_DESCRIPTION_MAX_LENGTH = 200;
export const ROADMAP_NOTE_MAX_LENGTH = 40;

/**
 * The human rating programme: the check on the foundational-skills judge.
 *
 * Every number the Helping skills tab shows comes from one LLM judge. Two LLM
 * rulers agreeing with each other (EFF-80) says nothing about whether either is
 * right, so a fixed sample of cuts is rated by people against the same rubric
 * (docs/foundational-helping-skills.md §4 is the instrument) and the judge is
 * read against them (EFF-81, `GET /v1/analytics/foundational-skills/judge-agreement`).
 *
 * The sample is drawn per CALENDAR QUARTER of the cut's `closedSessionEndedAt`,
 * stratified by composite tercile × session language, so a quarter's ratings
 * cover the whole score range and every language that was practised rather
 * than whatever a rater happened to open first.
 */

/** Cuts drawn per calendar quarter (fewer when the quarter has fewer). */
export const HUMAN_RATING_SAMPLE_PER_QUARTER = 30;

/** Composite score bands the sample is stratified across. */
export const HUMAN_RATING_TERCILES = 3;

/**
 * The language stratum of a cut whose sessions carry no resolvable
 * `metadata.languageId`. Kept as its own stratum rather than assumed English:
 * the stratum is the subject here, and a guess would hide where it came from.
 */
export const HUMAN_RATING_UNKNOWN_LANGUAGE = 'unknown';

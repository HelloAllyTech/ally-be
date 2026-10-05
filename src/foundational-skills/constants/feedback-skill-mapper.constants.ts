/**
 * The FEEDBACK → SKILL mapping: each "area of growth" a session debrief names,
 * read once and filed under ONE foundational helping skill (or none), so the
 * Helping skills tab can ask "when the debrief tells a learner to work on X,
 * does X change?" (EFF-40, chart AAQ-221).
 *
 * The debrief is free text written by the evaluation call in ally-ai, in the
 * session's language. The rubric is fixed (`FHS_RUBRIC`). This file pins the
 * one small classification call that joins the two.
 *
 * ## Changing anything here
 *
 * The mapping is stored and read back by version, like a rubric judgement:
 * `session_feedback_skill_links` is keyed `(scenarioSessionId, mapperVersion)`
 * and the chart reads only {@link FEEDBACK_SKILL_MAPPER_VERSION}. Bump the
 * version on ANY change to the prompt, the model or the skill list; the
 * scheduler then maps every session again under the new version and leaves the
 * old rows in place. Two versions are never pooled.
 */

/** Keys every stored mapping. Bump on ANY change to prompt, model or skill list. */
export const FEEDBACK_SKILL_MAPPER_VERSION = 'v1';

/**
 * Pinned rather than tier-resolved, for the reason the FHS judge is: the
 * mapping is stored and compared across months, so a tier env change must not
 * quietly change which skill an improvement is filed under halfway through the
 * history. A short closed-set classification needs no reasoning tokens, so the
 * cheap non-reasoning model is the right one — and unlike the gpt-5 family it
 * accepts temperature 0. Changing this is a version bump.
 */
export const FEEDBACK_SKILL_MAPPER_MODEL = 'gpt-4o-mini';

/** AI-task-registry row id (src/llm/constants/ai-task-registry.constants.ts). */
export const FEEDBACK_SKILL_MAPPER_TASK_ID =
  'feedback-improvement-skill-mapping';

/**
 * Sessions mapped per scheduler tick. One call per session, so this is also
 * the per-tick call cap: at most 20 every 30 minutes (960 a day) while a
 * backlog clears, and afterwards one per new eligible session.
 */
export const FEEDBACK_SKILL_MAPPINGS_PER_TICK = 20;

/** Mapping calls in flight at once within one tick. */
export const FEEDBACK_SKILL_MAPPER_CONCURRENCY = 4;

/**
 * A debrief with more improvement items than this is stored SKIPPED with no
 * call. The evaluation writes a handful; anything past this is malformed data,
 * not a debrief a learner read.
 */
export const FEEDBACK_SKILL_MAPPER_MAX_ITEMS = 20;

/**
 * Each item's text is cut to this many characters before it is sent. An
 * improvement plus its recommendation is a sentence or two; the cap only
 * bounds the cost of an outlier.
 */
export const FEEDBACK_SKILL_MAPPER_MAX_ITEM_CHARS = 800;

/**
 * Env switch for the scheduled mapping. OFF unless set to `on`: the job makes
 * model calls on a schedule, so an environment opts in rather than finding it
 * on its bill. Read on every tick, so flipping it needs only an env reload.
 */
export const FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV =
  'FEEDBACK_SKILL_MAPPING_SCHEDULE';

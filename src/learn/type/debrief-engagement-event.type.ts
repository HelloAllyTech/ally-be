/**
 * Signals that a learner's debrief conversation has become substantive.
 *
 * Declared beside the emitter rather than in the progress module, so that module stays
 * a leaf: nothing in `src/progress` is imported by the code it reacts to. `TRACK_EVENTS`
 * follows the same pattern.
 */
export enum DebriefEngagementEvent {
  THREAD_QUALIFIED = 'DEBRIEF_THREAD_QUALIFIED',
}

export interface DebriefThreadQualifiedEventParams {
  userId: number;
  tenantId: string;
  scenarioSessionId: string;
}

/**
 * What makes a debrief conversation worth XP.
 *
 * Three replies rather than one, because a single "ok, thanks" is not a conversation;
 * and a character floor per reply, because three of those are not a conversation either.
 * Both are deliberately low — the aim is to exclude the reflex reply, not to grade
 * whether the learner reflected well. Judging that would mean an LLM marking sincerity,
 * which is neither cheap nor fair.
 */
export const DEBRIEF_MIN_SUBSTANTIVE_REPLIES = 3;
export const DEBRIEF_MIN_REPLY_CHARS = 25;

/** Whether one learner reply counts toward the floor. */
export const isSubstantiveDebriefReply = (content: string): boolean =>
  (content ?? '').trim().length >= DEBRIEF_MIN_REPLY_CHARS;

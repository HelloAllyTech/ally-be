import {
  SELF_EFFICACY_CADENCE,
  SELF_EFFICACY_MIN_HOURS_BETWEEN,
  SelfEfficacyInstrument,
} from '../constants/self-efficacy-instrument.constants';
import {
  SelfAssessmentDueReason,
  SelfAssessmentTrigger,
} from '../enum/self-assessment.enum';

/**
 * Whether a learner should be asked the self-efficacy instrument now, and why.
 * Pure, so every branch is tested without a database; the repository gathers
 * the facts and the service applies this to them on both the "is one due?"
 * read and the submit (which must agree, or a learner could be asked and then
 * refused).
 */

/** The learner's most recent answer, as far as the cadence cares. */
export interface LastSelfAssessment {
  answeredAt: Date;
  trigger: SelfAssessmentTrigger | string;
  /** The scored-cut count for CUTS, the trackId for COURSE, else null. */
  triggerRef: string | null;
}

export interface SelfAssessmentDueFacts {
  now: Date;
  /** Null when the learner has never answered (or dismissed). */
  last: LastSelfAssessment | null;
  /**
   * The learner's scored cuts now: pinned rubric version, `SCORED`, a
   * composite (at least one assessable skill).
   */
  scoredCuts: number;
  /**
   * The same count as it stood at `last.answeredAt` — scored cuts that had
   * closed by then. Used when the last answer was not a CUTS one, so its
   * `triggerRef` holds no count. 0 when there is no last answer.
   */
  scoredCutsAtLast: number;
  /**
   * The most recent course completion after `last.answeredAt` (any completion
   * at all when there is no last answer), or null.
   */
  courseCompletedSince: { trackId: string; completedAt: Date } | null;
}

export interface SelfAssessmentDue {
  due: boolean;
  trigger: SelfAssessmentTrigger | null;
  /** What `triggerRef` the answer will be stored with. Null when not due. */
  triggerRef: string | null;
  reason: SelfAssessmentDueReason;
  /** When TOO_SOON: the earliest moment the next answer is accepted. */
  nextEligibleAt: Date | null;
}

const HOUR_MS = 60 * 60 * 1000;

/** True when the answer recorded its scored-cut count in `triggerRef` (a CUTS answer). */
export function recordsCutCount(last: LastSelfAssessment | null): boolean {
  return (
    !!last &&
    last.trigger === SelfAssessmentTrigger.CUTS &&
    last.triggerRef !== null &&
    /^\d+$/.test(last.triggerRef)
  );
}

/**
 * The scored-cut count the last answer was given at. A CUTS answer recorded it
 * in `triggerRef`; any other answer is recounted from cut closure times
 * (`scoredCutsAtLast`), which is stable across a rubric re-score because a
 * cut's closure time never changes.
 */
export function cutsAtLastAnswer(facts: SelfAssessmentDueFacts): number {
  const { last } = facts;
  if (!last) return 0;
  return recordsCutCount(last)
    ? Number(last.triggerRef)
    : facts.scoredCutsAtLast;
}

/**
 * The due rule, in order:
 *
 *  1. Never answered → ONBOARDING (when `onOnboarding`; otherwise the learner
 *     falls through to the later rules from a count of 0).
 *  2. Answered within `SELF_EFFICACY_MIN_HOURS_BETWEEN` hours → not due, TOO_SOON.
 *  3. Scored cuts now ≥ the count at the last answer + `everyScoredCuts` → CUTS,
 *     stored with today's count.
 *  4. A course completed after the last answer → COURSE, stored with its trackId.
 *  5. Otherwise not due, NOTHING_NEW.
 */
export function selfAssessmentDue(
  facts: SelfAssessmentDueFacts,
  cadence: {
    everyScoredCuts: number;
    onCourseCompletion: boolean;
    onOnboarding: boolean;
  } = SELF_EFFICACY_CADENCE,
  minHoursBetween = SELF_EFFICACY_MIN_HOURS_BETWEEN,
): SelfAssessmentDue {
  const notDue = (
    reason: SelfAssessmentDueReason,
    nextEligibleAt: Date | null = null,
  ): SelfAssessmentDue => ({
    due: false,
    trigger: null,
    triggerRef: null,
    reason,
    nextEligibleAt,
  });

  const { last } = facts;
  if (!last && cadence.onOnboarding) {
    return {
      due: true,
      trigger: SelfAssessmentTrigger.ONBOARDING,
      triggerRef: null,
      reason: SelfAssessmentDueReason.NEVER_ANSWERED,
      nextEligibleAt: null,
    };
  }

  if (last) {
    const eligibleAt = new Date(
      last.answeredAt.getTime() + minHoursBetween * HOUR_MS,
    );
    if (facts.now.getTime() < eligibleAt.getTime()) {
      return notDue(SelfAssessmentDueReason.TOO_SOON, eligibleAt);
    }
  }

  if (facts.scoredCuts >= cutsAtLastAnswer(facts) + cadence.everyScoredCuts) {
    return {
      due: true,
      trigger: SelfAssessmentTrigger.CUTS,
      triggerRef: String(facts.scoredCuts),
      reason: SelfAssessmentDueReason.SCORED_CUTS,
      nextEligibleAt: null,
    };
  }

  if (cadence.onCourseCompletion && facts.courseCompletedSince) {
    return {
      due: true,
      trigger: SelfAssessmentTrigger.COURSE,
      triggerRef: facts.courseCompletedSince.trackId,
      reason: SelfAssessmentDueReason.COURSE_COMPLETED,
      nextEligibleAt: null,
    };
  }

  return notDue(SelfAssessmentDueReason.NOTHING_NEW);
}

/**
 * Check a submitted answer against the instrument and return what to store:
 * only the answered items, as integers. Every key must be an item of the
 * instrument and every value an integer on its scale. `null` is accepted as an
 * explicit skip and dropped (an absent key means the same). An empty result is
 * valid — it is a dismissed prompt. Returns the problems instead when there are
 * any, so the caller can name them all in one 400.
 */
export function validateSelfAssessmentResponses(
  instrument: SelfEfficacyInstrument,
  responses: unknown,
):
  | { ok: true; responses: Record<string, number> }
  | { ok: false; errors: string[] } {
  if (
    responses === null ||
    typeof responses !== 'object' ||
    Array.isArray(responses)
  ) {
    return {
      ok: false,
      errors: ['responses must be an object of { skillKey: rating }'],
    };
  }
  const allowed = new Set(instrument.items.map((i) => i.skill));
  const { min, max } = instrument.scale;
  const errors: string[] = [];
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(responses)) {
    if (!allowed.has(key)) {
      errors.push(
        `"${key}" is not an item of instrument ${instrument.version}`,
      );
      continue;
    }
    if (value === null) continue;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      errors.push(`"${key}" must be an integer from ${min} to ${max}`);
      continue;
    }
    clean[key] = value;
  }
  return errors.length ? { ok: false, errors } : { ok: true, responses: clean };
}

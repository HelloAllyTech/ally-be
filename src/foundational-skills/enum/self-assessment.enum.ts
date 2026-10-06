/**
 * Why a learner was asked the self-efficacy instrument
 * (`learner_self_assessments.trigger`). Stored, so never rename a value —
 * retire it and add a new one, and extend `CHK_learner_self_assessments_trigger`
 * in the same change.
 */
export enum SelfAssessmentTrigger {
  /** Their first answer ever: the baseline every later answer is compared with. */
  ONBOARDING = 'ONBOARDING',
  /** `SELF_EFFICACY_CADENCE.everyScoredCuts` more scored cuts since the last answer. */
  CUTS = 'CUTS',
  /** A course finished after the last answer. */
  COURSE = 'COURSE',
}

/** Why `GET /v1/self-assessment/due` answered the way it did. */
export enum SelfAssessmentDueReason {
  /** Never answered: due, trigger ONBOARDING. */
  NEVER_ANSWERED = 'NEVER_ANSWERED',
  /** Enough scored cuts since the last answer: due, trigger CUTS. */
  SCORED_CUTS = 'SCORED_CUTS',
  /** A course completed after the last answer: due, trigger COURSE. */
  COURSE_COMPLETED = 'COURSE_COMPLETED',
  /** Answered within the anti-spam interval: not due until `nextEligibleAt`. */
  TOO_SOON = 'TOO_SOON',
  /** Nothing has happened since the last answer that calls for another. */
  NOTHING_NEW = 'NOTHING_NEW',
}

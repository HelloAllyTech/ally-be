import { currentSelfEfficacyInstrument } from '../constants/self-efficacy-instrument.constants';
import {
  SelfAssessmentDueReason,
  SelfAssessmentTrigger,
} from '../enum/self-assessment.enum';
import {
  SelfAssessmentDueFacts,
  cutsAtLastAnswer,
  selfAssessmentDue,
  validateSelfAssessmentResponses,
} from '../util/self-assessment-due.util';

const NOW = new Date('2026-10-05T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

const facts = (
  over: Partial<SelfAssessmentDueFacts> = {},
): SelfAssessmentDueFacts => ({
  now: NOW,
  last: null,
  scoredCuts: 0,
  scoredCutsAtLast: 0,
  courseCompletedSince: null,
  ...over,
});

describe('selfAssessmentDue', () => {
  it('asks a learner who has never answered: ONBOARDING, no triggerRef', () => {
    expect(selfAssessmentDue(facts({ scoredCuts: 12 }))).toEqual({
      due: true,
      trigger: SelfAssessmentTrigger.ONBOARDING,
      triggerRef: null,
      reason: SelfAssessmentDueReason.NEVER_ANSWERED,
      nextEligibleAt: null,
    });
  });

  it('asks again three scored cuts after a CUTS answer, using the count it recorded', () => {
    const last = {
      answeredAt: hoursAgo(72),
      trigger: SelfAssessmentTrigger.CUTS,
      triggerRef: '6',
    };
    // The recount is ignored for a CUTS answer: its own count is the record.
    expect(
      selfAssessmentDue(facts({ last, scoredCuts: 8, scoredCutsAtLast: 0 })),
    ).toMatchObject({
      due: false,
      reason: SelfAssessmentDueReason.NOTHING_NEW,
    });
    expect(
      selfAssessmentDue(facts({ last, scoredCuts: 9, scoredCutsAtLast: 0 })),
    ).toEqual({
      due: true,
      trigger: SelfAssessmentTrigger.CUTS,
      triggerRef: '9',
      reason: SelfAssessmentDueReason.SCORED_CUTS,
      nextEligibleAt: null,
    });
  });

  it('recounts at the answer time when the last answer was not a CUTS one', () => {
    const last = {
      answeredAt: hoursAgo(72),
      trigger: SelfAssessmentTrigger.ONBOARDING,
      triggerRef: null,
    };
    // A learner who already had 10 cuts at onboarding is not asked again at 11.
    expect(
      selfAssessmentDue(facts({ last, scoredCuts: 12, scoredCutsAtLast: 10 })),
    ).toMatchObject({ due: false });
    expect(
      selfAssessmentDue(facts({ last, scoredCuts: 13, scoredCutsAtLast: 10 })),
    ).toMatchObject({
      due: true,
      trigger: SelfAssessmentTrigger.CUTS,
      triggerRef: '13',
    });
  });

  it('falls back to the recount when a CUTS answer carries no usable count', () => {
    expect(
      cutsAtLastAnswer(
        facts({
          last: {
            answeredAt: hoursAgo(48),
            trigger: SelfAssessmentTrigger.CUTS,
            triggerRef: 'garbled',
          },
          scoredCutsAtLast: 4,
        }),
      ),
    ).toBe(4);
  });

  it('asks after a course completed since the last answer, with its trackId', () => {
    const completedAt = hoursAgo(30);
    expect(
      selfAssessmentDue(
        facts({
          last: {
            answeredAt: hoursAgo(100),
            trigger: SelfAssessmentTrigger.ONBOARDING,
            triggerRef: null,
          },
          scoredCuts: 1,
          scoredCutsAtLast: 0,
          courseCompletedSince: { trackId: 'track-1', completedAt },
        }),
      ),
    ).toEqual({
      due: true,
      trigger: SelfAssessmentTrigger.COURSE,
      triggerRef: 'track-1',
      reason: SelfAssessmentDueReason.COURSE_COMPLETED,
      nextEligibleAt: null,
    });
  });

  it('prefers CUTS over COURSE when both are due (one answer covers both)', () => {
    expect(
      selfAssessmentDue(
        facts({
          last: {
            answeredAt: hoursAgo(100),
            trigger: SelfAssessmentTrigger.CUTS,
            triggerRef: '3',
          },
          scoredCuts: 6,
          courseCompletedSince: { trackId: 't', completedAt: hoursAgo(50) },
        }),
      ).trigger,
    ).toBe(SelfAssessmentTrigger.CUTS);
  });

  it('never asks twice within 24 hours, whatever fires, and says when it may', () => {
    const answeredAt = hoursAgo(23);
    const due = selfAssessmentDue(
      facts({
        last: {
          answeredAt,
          trigger: SelfAssessmentTrigger.ONBOARDING,
          triggerRef: null,
        },
        scoredCuts: 30,
        courseCompletedSince: { trackId: 't', completedAt: hoursAgo(1) },
      }),
    );
    expect(due).toEqual({
      due: false,
      trigger: null,
      triggerRef: null,
      reason: SelfAssessmentDueReason.TOO_SOON,
      nextEligibleAt: new Date(answeredAt.getTime() + 24 * 3600 * 1000),
    });
  });

  it('treats a dismissal like an answer for the 24-hour guard and the cadence', () => {
    // A dismissal is stored with the trigger it was due for; the same rules apply.
    const last = {
      answeredAt: hoursAgo(25),
      trigger: SelfAssessmentTrigger.COURSE,
      triggerRef: 'track-1',
    };
    expect(
      selfAssessmentDue(facts({ last, scoredCuts: 5, scoredCutsAtLast: 4 })),
    ).toMatchObject({
      due: false,
      reason: SelfAssessmentDueReason.NOTHING_NEW,
    });
  });

  it('is not due when nothing has happened since the last answer', () => {
    expect(
      selfAssessmentDue(
        facts({
          last: {
            answeredAt: hoursAgo(500),
            trigger: SelfAssessmentTrigger.CUTS,
            triggerRef: '9',
          },
          scoredCuts: 11,
        }),
      ),
    ).toEqual({
      due: false,
      trigger: null,
      triggerRef: null,
      reason: SelfAssessmentDueReason.NOTHING_NEW,
      nextEligibleAt: null,
    });
  });

  it('honours the cadence switches', () => {
    const cadence = {
      everyScoredCuts: 3,
      onCourseCompletion: false,
      onOnboarding: false,
    };
    // No onboarding prompt: a new learner is first asked after 3 scored cuts.
    expect(selfAssessmentDue(facts({ scoredCuts: 2 }), cadence).due).toBe(
      false,
    );
    expect(selfAssessmentDue(facts({ scoredCuts: 3 }), cadence).trigger).toBe(
      SelfAssessmentTrigger.CUTS,
    );
    // No course prompt.
    expect(
      selfAssessmentDue(
        facts({
          last: {
            answeredAt: hoursAgo(100),
            trigger: SelfAssessmentTrigger.CUTS,
            triggerRef: '3',
          },
          scoredCuts: 4,
          courseCompletedSince: { trackId: 't', completedAt: hoursAgo(2) },
        }),
        cadence,
      ).due,
    ).toBe(false);
  });
});

describe('validateSelfAssessmentResponses', () => {
  const instrument = currentSelfEfficacyInstrument();

  it('keeps a partial answer, as integers, and drops explicit skips', () => {
    expect(
      validateSelfAssessmentResponses(instrument, {
        verbal: 7,
        harm: 0,
        empathy: 10,
        goals: null,
      }),
    ).toEqual({ ok: true, responses: { verbal: 7, harm: 0, empathy: 10 } });
  });

  it('accepts an empty answer as a dismissal', () => {
    expect(validateSelfAssessmentResponses(instrument, {})).toEqual({
      ok: true,
      responses: {},
    });
  });

  it('names every problem: unknown keys, non-integers, out of range, text', () => {
    const result = validateSelfAssessmentResponses(instrument, {
      verbal: 7.5,
      harm: 11,
      empathy: -1,
      rapport: '8',
      notASkill: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(5);
    expect(result.errors.join(' ')).toContain('"notASkill" is not an item');
    expect(result.errors.join(' ')).toContain(
      '"verbal" must be an integer from 0 to 10',
    );
  });

  it.each([[null], [[]], ['text'], [5]])(
    'rejects a non-object body %p',
    (body) => {
      expect(validateSelfAssessmentResponses(instrument, body).ok).toBe(false);
    },
  );
});

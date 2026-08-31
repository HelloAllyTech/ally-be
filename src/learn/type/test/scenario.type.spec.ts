import {
  DEFAULT_FEEDBACK_TABS,
  feedbackTabsNeedEvaluation,
  resolveFeedbackTabs,
} from '../scenario.type';

/**
 * The post-session tab resolver. Worth its own spec because the surrounding
 * code renders tabs straight off its output, and because the 2026-08-31 change
 * that retired `enableFeedback` and `skills` altered what stored metadata
 * means — see migration 1944200000000.
 */
describe('resolveFeedbackTabs', () => {
  it('defaults both tabs on when metadata is absent entirely', () => {
    expect(resolveFeedbackTabs(undefined)).toEqual({
      debrief: true,
      transcript: true,
    });
    expect(resolveFeedbackTabs(null)).toEqual(DEFAULT_FEEDBACK_TABS);
  });

  it('defaults both tabs on for a roleplay authored before feedbackTabs existed', () => {
    expect(resolveFeedbackTabs({ name: 'Legacy roleplay' })).toEqual({
      debrief: true,
      transcript: true,
    });
  });

  it('treats a non-object feedbackTabs as absent rather than throwing', () => {
    expect(resolveFeedbackTabs({ feedbackTabs: 'yes' })).toEqual(
      DEFAULT_FEEDBACK_TABS,
    );
  });

  it('honours each tab independently', () => {
    expect(
      resolveFeedbackTabs({ feedbackTabs: { debrief: false } }),
    ).toEqual({ debrief: false, transcript: true });

    expect(
      resolveFeedbackTabs({ feedbackTabs: { transcript: false } }),
    ).toEqual({ debrief: true, transcript: false });
  });

  it('reads an omitted key as on, so a partial object never hides a tab', () => {
    expect(resolveFeedbackTabs({ feedbackTabs: {} })).toEqual({
      debrief: true,
      transcript: true,
    });
  });

  it('IGNORES the retired enableFeedback master switch', () => {
    // The regression this guards: enableFeedback used to short-circuit to
    // all-off. Migration 1944200000000 rewrote those rows as both tabs off, so
    // still reading the flag would double-gate — a roleplay could read as
    // "both on" in the authoring form while the learner saw nothing.
    expect(
      resolveFeedbackTabs({
        enableFeedback: false,
        feedbackTabs: { debrief: true, transcript: true },
      }),
    ).toEqual({ debrief: true, transcript: true });
  });

  it('expresses the wholesale opt-out as both tabs off', () => {
    expect(
      resolveFeedbackTabs({
        feedbackTabs: { debrief: false, transcript: false },
      }),
    ).toEqual({ debrief: false, transcript: false });
  });

  it('ignores a leftover skills key from before the tab was retired', () => {
    const resolved = resolveFeedbackTabs({
      feedbackTabs: { debrief: true, skills: true, transcript: true },
    });
    expect(resolved).toEqual({ debrief: true, transcript: true });
    expect(resolved).not.toHaveProperty('skills');
  });
});

describe('feedbackTabsNeedEvaluation', () => {
  it('needs the evaluation call when either tab is on', () => {
    expect(
      feedbackTabsNeedEvaluation({ debrief: true, transcript: false }),
    ).toBe(true);
    expect(
      feedbackTabsNeedEvaluation({ debrief: false, transcript: true }),
    ).toBe(true);
  });

  it('skips the evaluation call when a roleplay shows the learner nothing', () => {
    // The whole point: no surface can ever display it, so running a full
    // transcript analysis would be burnt tokens.
    expect(
      feedbackTabsNeedEvaluation({ debrief: false, transcript: false }),
    ).toBe(false);
  });
});

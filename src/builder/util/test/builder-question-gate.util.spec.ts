import {
  gatedRationale,
  looksLikeACodeQuestion,
  questionGateProblems,
} from '../builder-question-gate.util';

describe('the question gate', () => {
  const decision = {
    prompt:
      'Should learner ratings block a challenger from being promoted, or only weigh in?',
    questionType: 'behaviour',
    basis: 'P1 (reuse Auto-improve)',
    whyNotResearch:
      'Both are possible in the code; which one they want is their call.',
  };

  it('lets a decision through', () => {
    expect(questionGateProblems(decision)).toEqual([]);
  });

  it('holds a question to a type, a basis and a reason research cannot settle it', () => {
    expect(
      questionGateProblems({ prompt: 'Which one?', questionType: 'fact' }).map(
        (problem) => problem.key,
      ),
    ).toEqual(['question_type', 'question_basis', 'question_why']);
  });

  it.each([
    'Where is the debrief rating stored today?',
    'Which table stores the session feedback?',
    'How does the auto-improve loop currently work?',
    'Does the backend already track which prompt version wrote a debrief?',
    'Is there an existing endpoint for ratings?',
  ])('sends back a question about how the platform works: "%s"', (prompt) => {
    expect(looksLikeACodeQuestion(prompt)).toBe(true);
    expect(
      questionGateProblems({ ...decision, prompt }).map(
        (problem) => problem.key,
      ),
    ).toEqual(['code_question']);
  });

  it.each([
    decision.prompt,
    'Which thumbs-up rate counts as success for you?',
    'Do you want mobile in the first release, or web only?',
  ])('does not mistake a decision for a code question: "%s"', (prompt) => {
    expect(looksLikeACodeQuestion(prompt)).toBe(false);
  });

  it('puts the basis and the reason on the card, after any rationale', () => {
    expect(
      gatedRationale({ ...decision, rationale: 'You said mobile matters.' }),
    ).toBe(
      'You said mobile matters.\nBased on: P1 (reuse Auto-improve)\n' +
        'Yours to decide because: Both are possible in the code; which one they want is their call.',
    );
    expect(gatedRationale({})).toBe('');
  });
});

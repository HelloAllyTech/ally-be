import { TrackQuizLlmGraderService } from '../track-quiz-llm-grader.service';
import { LoggerService } from 'src/logger/logger.service';

const question = {
  id: 'q-1',
  prompt: 'What is reflective listening?',
  rubric: { maxScore: 10, guidance: 'Mentions mirroring', criteria: [] },
} as any;

const GOOD = '{"score": 7, "feedback": "Clear and specific."}';

function harness(arm: any) {
  const promptShared = {
    getPromptByCode: jest.fn(async () => 'OWN {{question}} {{answer}}'),
  };
  const llm = { complete: jest.fn(async () => ({ text: GOOD })) };
  const experiments = {
    assign: jest.fn(async () => arm),
    record: jest.fn(async () => undefined),
  };
  const service = new TrackQuizLlmGraderService(
    promptShared as any,
    llm as any,
    experiments as any,
  );
  return { service, promptShared, llm, experiments };
}

const variantArm = {
  experimentId: 'exp-1',
  variantId: 'v-1',
  promptCode: 'track_quiz_open_ended_grading_user',
  content: 'VARIANT {{question}} {{answer}}',
  isOriginal: false,
  record: true,
};

describe('TrackQuizLlmGraderService under a skill experiment', () => {
  beforeEach(() => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('grades on the skill text exactly as before when no experiment is live', async () => {
    const h = harness(null);
    const grading = await h.service.gradeOpenEndedAnswer(question, 'Mirroring');
    expect(grading).toEqual({ score: 7, feedback: 'Clear and specific.' });
    expect((h.llm.complete.mock.calls[0] as any)[0].prompt).toBe(
      'OWN What is reflective listening? Mirroring',
    );
  });

  it('grades on the arm text and records the raw reply', async () => {
    const h = harness(variantArm);
    await h.service.gradeOpenEndedAnswer(question, 'Mirroring');
    expect((h.llm.complete.mock.calls[0] as any)[0].prompt).toBe(
      'VARIANT What is reflective listening? Mirroring',
    );
    expect(h.promptShared.getPromptByCode).not.toHaveBeenCalled();
    expect(h.experiments.record).toHaveBeenCalledWith(
      variantArm,
      expect.objectContaining({
        output: GOOD,
        input: expect.objectContaining({ answer: 'Mirroring', maxScore: '10' }),
      }),
    );
  });

  it('records a challenger that broke the reply and regrades on the skill text', async () => {
    const h = harness(variantArm);
    h.llm.complete
      .mockResolvedValueOnce({ text: 'I would give this a 7.' })
      .mockResolvedValueOnce({ text: GOOD });

    const grading = await h.service.gradeOpenEndedAnswer(question, 'Mirroring');

    expect(grading.score).toBe(7);
    expect(h.experiments.record).toHaveBeenCalledWith(
      variantArm,
      expect.objectContaining({
        output: 'I would give this a 7.',
        error: expect.stringMatching(/no JSON object/),
      }),
    );
    expect((h.llm.complete.mock.calls[1] as any)[0].prompt).toMatch(/^OWN /);
  });

  it('rethrows when the original arm fails — the caller owns that fallback', async () => {
    const h = harness({ ...variantArm, isOriginal: true });
    h.llm.complete.mockResolvedValue({ text: 'no json' });
    await expect(
      h.service.gradeOpenEndedAnswer(question, 'Mirroring'),
    ).rejects.toThrow(/no JSON object/);
    expect(h.llm.complete).toHaveBeenCalledTimes(1);
  });
});

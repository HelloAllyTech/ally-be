import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  FHS_SKILL_KEYS,
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from '../constants/helping-skills-rubric.constants';
import { FhsAssessmentStatus } from '../enum/foundational-skills.enum';
import {
  FHS_JUDGE_TASK_ID,
  FoundationalSkillsJudgeService,
  buildJudgeSystemPrompt,
} from '../service/foundational-skills-judge.service';
import { FoundationalSkillsService } from '../service/foundational-skills.service';
import { EMPTY_BENCHMARK_TICK } from '../service/foundational-skills-benchmark.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTargetResolverService } from 'src/llm/service/llm-target-resolver.service';
import { callConfigForAiTask } from 'src/llm/constants/ai-task-registry.constants';

describe('FoundationalSkillsJudgeService', () => {
  const lines = [
    {
      id: 'C1',
      speaker: 'client' as const,
      text: 'I feel so alone.',
      scored: true,
    },
    {
      id: 'H1',
      speaker: 'helper' as const,
      text: 'What has been on your mind lately?',
      scored: true,
    },
  ];

  /** A complete reply: verbal ticked once, every other skill without opportunity. */
  const fullReply = (omit: string[] = []) =>
    JSON.stringify({
      skills: FHS_SKILL_KEYS.filter((k) => !omit.includes(k)).map((key) =>
        key === 'verbal'
          ? {
              skill: 'verbal',
              opportunity: true,
              observed: [
                {
                  code: 'verbal.b1',
                  line: 'H1',
                  quote: 'what has been on your mind',
                },
              ],
            }
          : { skill: key, opportunity: false, observed: [] },
      ),
    });

  it('calls the pinned model in JSON mode under its own task label', async () => {
    const complete = jest.fn().mockResolvedValue({
      text: fullReply(),
      model: FHS_JUDGE_MODEL,
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
    const service = new FoundationalSkillsJudgeService({ complete } as any);

    const outcome = await service.judge('transcript', lines, {
      cutId: 'c1',
      userId: 7,
      cutIndex: 1,
    });

    const request = complete.mock.calls[0][0];
    expect(request.taskId).toBe(FHS_JUDGE_TASK_ID);
    expect(request.task).toBe(LlmTask.FOUNDATIONAL_SKILLS_ASSESSMENT);
    expect(request.model).toBe(FHS_JUDGE_MODEL);
    expect(request.jsonMode).toBe(true);
    expect(request.usageMetadata.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    // A cut spans several sessions, so no single session owns its spend.
    expect(request.scenarioSessionId).toBeUndefined();
    expect(outcome.compositeScore).toBe(2);
    expect(outcome.hasUnhelpfulBehaviour).toBe(false);
    expect(outcome.stats.missingSkills).toBe(0);
  });

  it('fails the attempt when the reply omits any skill, rather than scoring it', async () => {
    const complete = jest.fn().mockResolvedValue({
      text: fullReply(['empathy']),
      model: FHS_JUDGE_MODEL,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const service = new FoundationalSkillsJudgeService({ complete } as any);
    await expect(
      service.judge('t', lines, { cutId: 'c', userId: 1, cutIndex: 1 }),
    ).rejects.toThrow(/omitted 1 of 14 skills/);
  });

  it('resolves through the real completion service and resolver to the pinned model, with no fallback', async () => {
    // The unit tests above stub LlmCompletionService, which is how a registry
    // row without a floor tier once made every real call throw in the
    // resolver. This one runs the real resolution chain.
    const streamed: { provider: string; model: string }[] = [];
    const factory = {
      create: (provider: string, model: string) => ({
        name: provider,
        stream: async function* () {
          streamed.push({ provider, model });
          const text = fullReply();
          yield {
            type: 'final',
            message: {
              content: [{ type: 'text', text }],
              stopReason: 'end_turn',
              usage: { inputTokens: 10, outputTokens: 5 },
            },
          };
        },
      }),
      isConfigured: () => true,
    };
    const resolver = new LlmTargetResolverService(
      {
        llmTiers: { fast: 'gpt-4o-mini', reasoning: 'some-other-model' },
      } as any,
      {} as any,
    );
    const completion = new LlmCompletionService(
      resolver,
      factory as any,
      { record: jest.fn() } as any,
    );
    const service = new FoundationalSkillsJudgeService(completion);

    const outcome = await service.judge('transcript', lines, {
      cutId: 'c1',
      userId: 7,
      cutIndex: 1,
    });

    expect(streamed).toEqual([{ provider: 'openai', model: FHS_JUDGE_MODEL }]);
    expect(outcome.model).toBe(FHS_JUDGE_MODEL);
    const target = await resolver.resolve({
      taskId: FHS_JUDGE_TASK_ID,
      ...callConfigForAiTask(FHS_JUDGE_TASK_ID, { modelIsExplicit: true }),
      model: FHS_JUDGE_MODEL,
    });
    expect(target.fallbackEnabled).toBe(false);
  });

  it('throws on a reply that is not the expected JSON, so the attempt is recorded', async () => {
    const complete = jest.fn().mockResolvedValue({
      text: 'I cannot help with that',
      model: FHS_JUDGE_MODEL,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const service = new FoundationalSkillsJudgeService({ complete } as any);
    await expect(
      service.judge('t', lines, { cutId: 'c', userId: 1, cutIndex: 1 }),
    ).rejects.toThrow(/JSON/);
  });

  it('puts every skill and behaviour code in the system prompt', () => {
    const prompt = buildJudgeSystemPrompt();
    for (const key of FHS_SKILL_KEYS)
      expect(prompt).toContain(`SKILL "${key}" —`);
    expect(prompt).toContain('harm.u1 [ABSENCE]');
    expect(prompt).toContain('feedback.b2 [CONDITIONAL]');
    expect(prompt).not.toMatch(/non-verbal/i);
  });
});

describe('FoundationalSkillsService', () => {
  /** The benchmark half, idle: these tests are about cuts. */
  const benchmark = () => ({
    tick: jest.fn().mockResolvedValue({ ...EMPTY_BENCHMARK_TICK }),
  });

  const repository = () => ({
    findLearnersReadyToCut: jest.fn(),
    findLastCut: jest.fn(),
    findPendingSessions: jest.fn(),
    findSessionHeaders: jest.fn().mockResolvedValue([]),
    loadTurns: jest.fn(),
    insertCuts: jest.fn(),
    findCutsToScore: jest.fn(),
    upsertAssessment: jest.fn().mockResolvedValue(undefined),
  });

  it('cuts a learner from their next index, continuing a carried tail', async () => {
    const repo = repository();
    repo.findLastCut.mockResolvedValue({
      cutIndex: 2,
      endSessionId: 's1',
      endMessageId: 2,
      endsMidSession: true,
    });
    repo.findSessionHeaders.mockResolvedValue([
      { sessionId: 's1', endedAt: new Date(), tenantId: 't' },
    ]);
    repo.findPendingSessions.mockResolvedValue([
      { sessionId: 's2', endedAt: new Date(), tenantId: 't' },
    ]);
    const half = 'x'.repeat(FHS_CUT_LEARNER_CHARS / 2);
    repo.loadTurns.mockResolvedValue(
      new Map([
        [
          's1',
          [
            { messageId: 1, speaker: 'helper', text: half },
            { messageId: 2, speaker: 'helper', text: half },
            { messageId: 3, speaker: 'helper', text: half },
          ],
        ],
        ['s2', [{ messageId: 9, speaker: 'helper', text: half }]],
      ]),
    );
    repo.insertCuts.mockResolvedValue(1);
    const service = new FoundationalSkillsService(
      repo as any,
      {} as any,
      benchmark() as any,
    );

    await expect(service.sealForLearner(42)).resolves.toBe(1);
    const [userId, firstIndex, cuts] = repo.insertCuts.mock.calls[0];
    expect(userId).toBe(42);
    expect(firstIndex).toBe(3);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].sessionIds).toEqual(['s1', 's2']);
    expect(cuts[0].startMessageId).toBe(3);
    expect(cuts[0].startsMidSession).toBe(true);
  });

  it('writes nothing when the pending speech cannot close a cut', async () => {
    const repo = repository();
    repo.findLastCut.mockResolvedValue(null);
    repo.findPendingSessions.mockResolvedValue([
      { sessionId: 's1', endedAt: new Date(), tenantId: 't' },
    ]);
    repo.loadTurns.mockResolvedValue(
      new Map([['s1', [{ messageId: 1, speaker: 'helper', text: 'short' }]]]),
    );
    const service = new FoundationalSkillsService(
      repo as any,
      {} as any,
      benchmark() as any,
    );
    await expect(service.sealForLearner(1)).resolves.toBe(0);
    expect(repo.insertCuts).not.toHaveBeenCalled();
  });

  const cut = {
    cutId: 'cut-1',
    userId: 5,
    cutIndex: 1,
    sessionIds: ['s1'],
    startSessionId: 's1',
    startMessageId: 1,
    endSessionId: 's1',
    endMessageId: 2,
    attempts: 0,
  };

  it('stores a scored assessment with levels keyed by skill', async () => {
    const repo = repository();
    repo.loadTurns.mockResolvedValue(
      new Map([
        [
          's1',
          [
            { messageId: 1, speaker: 'client', text: 'Hello' },
            { messageId: 2, speaker: 'helper', text: 'How are you feeling?' },
          ],
        ],
      ]),
    );
    const judge = {
      judge: jest.fn().mockResolvedValue({
        verdicts: [
          {
            skill: 'verbal',
            opportunity: true,
            observed: ['verbal.b1'],
            notApplicable: [],
            level: 2,
          },
          {
            skill: 'confidentiality',
            opportunity: false,
            observed: [],
            notApplicable: [],
            level: null,
          },
        ],
        compositeScore: 2,
        hasUnhelpfulBehaviour: false,
        stats: { droppedTicks: 1, missingSkills: 0 },
        model: FHS_JUDGE_MODEL,
        promptTokens: 10,
        completionTokens: 5,
      }),
    };
    const service = new FoundationalSkillsService(
      repo as any,
      judge as any,
      benchmark() as any,
    );

    await expect(service.scoreCut(cut)).resolves.toBe(true);
    const write = repo.upsertAssessment.mock.calls[0][0];
    expect(write.status).toBe(FhsAssessmentStatus.SCORED);
    expect(write.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    expect(write.skillLevels).toEqual({ verbal: 2 });
    expect(write.droppedTicks).toBe(1);
    expect(judge.judge.mock.calls[0][1].map((l: any) => l.id)).toEqual([
      'C1',
      'H1',
    ]);
  });

  it('records a FAILED attempt instead of throwing when the judge fails', async () => {
    const repo = repository();
    repo.loadTurns.mockResolvedValue(
      new Map([['s1', [{ messageId: 2, speaker: 'helper', text: 'Hi' }]]]),
    );
    const judge = { judge: jest.fn().mockRejectedValue(new Error('timeout')) };
    const service = new FoundationalSkillsService(
      repo as any,
      judge as any,
      benchmark() as any,
    );

    await expect(service.scoreCut(cut)).resolves.toBe(false);
    const write = repo.upsertAssessment.mock.calls[0][0];
    expect(write.status).toBe(FhsAssessmentStatus.FAILED);
    expect(write.error).toBe('timeout');
  });

  it('scores a queue with bounded concurrency and reports the tally', async () => {
    const repo = repository();
    repo.findLearnersReadyToCut.mockResolvedValue([]);
    repo.findCutsToScore.mockResolvedValue([
      cut,
      { ...cut, cutId: 'cut-2' },
      { ...cut, cutId: 'cut-3' },
    ]);
    const service = new FoundationalSkillsService(
      repo as any,
      {} as any,
      benchmark() as any,
    );
    const scoreCut = jest
      .spyOn(service, 'scoreCut')
      .mockImplementation(async (c) => c.cutId !== 'cut-2');

    const summary = await service.tick();
    expect(scoreCut).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({
      learnersCut: 0,
      cutsSealed: 0,
      cutsScored: 2,
      cutsFailed: 1,
      ...EMPTY_BENCHMARK_TICK,
    });
  });

  it('runs the benchmark half between sealing and cut scoring, and carries its tally', async () => {
    const repo = repository();
    const order: string[] = [];
    repo.findLearnersReadyToCut.mockImplementation(async () => {
      order.push('seal');
      return [];
    });
    repo.findCutsToScore.mockImplementation(async () => {
      order.push('score-cuts');
      return [];
    });
    const bench = {
      tick: jest.fn().mockImplementation(async () => {
        order.push('benchmark');
        return {
          benchmarksScored: 2,
          benchmarksSkipped: 1,
          benchmarksFailed: 0,
          cutsBeforeRefreshed: 3,
        };
      }),
    };
    const service = new FoundationalSkillsService(
      repo as any,
      {} as any,
      bench as any,
    );

    const summary = await service.tick();
    expect(order).toEqual(['seal', 'benchmark', 'score-cuts']);
    expect(summary.benchmarksScored).toBe(2);
    expect(summary.benchmarksSkipped).toBe(1);
    expect(summary.cutsBeforeRefreshed).toBe(3);
  });

  it('still scores cuts when the benchmark half throws', async () => {
    const repo = repository();
    repo.findLearnersReadyToCut.mockResolvedValue([]);
    repo.findCutsToScore.mockResolvedValue([cut]);
    const bench = { tick: jest.fn().mockRejectedValue(new Error('db down')) };
    const service = new FoundationalSkillsService(
      repo as any,
      {} as any,
      bench as any,
    );
    jest.spyOn(service, 'scoreCut').mockResolvedValue(true);

    const summary = await service.tick();
    expect(summary.cutsScored).toBe(1);
    expect(summary.benchmarksScored).toBe(0);
  });
});

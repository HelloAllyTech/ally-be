import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  FHS_JUDGE_MODEL,
  FHS_MAX_ATTEMPTS,
  FHS_RUBRIC_VERSION,
  FHS_SKILL_KEYS,
} from '../constants/helping-skills-rubric.constants';
import {
  FHS_BENCHMARK_MIN_LEARNER_CHARS,
  FHS_BENCHMARKS_PER_TICK,
} from '../constants/fhs-benchmark.constants';
import { FhsBenchmarkStatus } from '../enum/foundational-skills.enum';
import { FoundationalSkillsBenchmarkService } from '../service/foundational-skills-benchmark.service';
import {
  FHS_BENCHMARK_JUDGE_TASK_ID,
  FoundationalSkillsJudgeService,
  buildJudgeSystemPrompt,
} from '../service/foundational-skills-judge.service';
import { learnerCharsOf, renderSession } from '../util/transcript-window.util';

describe('FoundationalSkillsBenchmarkService', () => {
  const target = {
    sessionId: 'sess-1',
    userId: 42,
    scenarioId: 7,
    tenantId: 'tenant-a',
    endedAt: new Date('2026-09-01T10:00:00Z'),
    cutsBefore: 4,
    attempts: 0,
  };

  const repository = () => ({
    loadTurns: jest.fn(),
    upsertBenchmarkAssessment: jest.fn().mockResolvedValue(undefined),
    refreshBenchmarkCutsBefore: jest.fn().mockResolvedValue(0),
    findBenchmarkSessionsToScore: jest.fn().mockResolvedValue([]),
  });

  /** `prefix` padded to exactly `length` code points. */
  const padded = (prefix: string, length: number) =>
    prefix + 'x'.repeat(length - Array.from(prefix).length);

  /** A session whose helper turns add up to exactly `helperChars` code points. */
  const turnsWithHelperChars = (helperChars: number) => {
    const half = Math.floor(helperChars / 2);
    return [
      { messageId: 1, speaker: 'client', text: 'I have not been sleeping.' },
      {
        messageId: 2,
        speaker: 'helper',
        text: padded('What has been keeping you awake? ', half),
      },
      { messageId: 3, speaker: 'client', text: 'Work, mostly. And home.' },
      {
        messageId: 4,
        speaker: 'helper',
        text: padded(
          'So work and home are both weighing on you. ',
          helperChars - half,
        ),
      },
    ];
  };

  it('stores SKIPPED, with the reason and no model call, below the speech floor', async () => {
    const repo = repository();
    const turns = turnsWithHelperChars(FHS_BENCHMARK_MIN_LEARNER_CHARS - 1);
    repo.loadTurns.mockResolvedValue(new Map([['sess-1', turns]]));
    const judge = { judgeBenchmark: jest.fn() };
    const service = new FoundationalSkillsBenchmarkService(
      repo as any,
      judge as any,
    );

    await expect(service.scoreSession(target)).resolves.toBe(
      FhsBenchmarkStatus.SKIPPED,
    );
    expect(judge.judgeBenchmark).not.toHaveBeenCalled();
    const write = repo.upsertBenchmarkAssessment.mock.calls[0][0];
    expect(write).toMatchObject({
      sessionId: 'sess-1',
      userId: 42,
      scenarioId: 7,
      tenantId: 'tenant-a',
      sessionEndedAt: target.endedAt,
      rubricVersion: FHS_RUBRIC_VERSION,
      status: FhsBenchmarkStatus.SKIPPED,
      learnerChars: FHS_BENCHMARK_MIN_LEARNER_CHARS - 1,
      cutsBefore: 4,
      compositeScore: null,
      skillLevels: {},
      verdicts: [],
      model: null,
    });
    expect(write.error).toContain(String(FHS_BENCHMARK_MIN_LEARNER_CHARS - 1));
    expect(write.error).toContain(String(FHS_BENCHMARK_MIN_LEARNER_CHARS));
  });

  it('counts only the learner, in code points, against the floor', () => {
    // Devanagari: each grapheme here is one or two code points; the floor is
    // in code points, the same unit as cuts and Postgres char_length.
    const session = {
      sessionId: 's',
      endedAt: new Date(),
      tenantId: null,
      turns: [
        { messageId: 1, speaker: 'client' as const, text: 'x'.repeat(5000) },
        { messageId: 2, speaker: 'helper' as const, text: 'नमस्ते' },
      ],
    };
    expect(learnerCharsOf(session)).toBe(Array.from('नमस्ते').length);
  });

  it('scores AT the floor and renders the whole session as one window', async () => {
    const repo = repository();
    const turns = turnsWithHelperChars(FHS_BENCHMARK_MIN_LEARNER_CHARS);
    repo.loadTurns.mockResolvedValue(new Map([['sess-1', turns]]));
    const judge = {
      judgeBenchmark: jest.fn().mockResolvedValue({
        verdicts: [],
        compositeScore: null,
        hasUnhelpfulBehaviour: null,
        stats: { droppedTicks: 0, missingSkills: 0 },
        model: FHS_JUDGE_MODEL,
        promptTokens: 1,
        completionTokens: 1,
      }),
    };
    const service = new FoundationalSkillsBenchmarkService(
      repo as any,
      judge as any,
    );

    await expect(service.scoreSession(target)).resolves.toBe(
      FhsBenchmarkStatus.SCORED,
    );
    const [text, lines, meta] = judge.judgeBenchmark.mock.calls[0];
    expect(lines.map((l: any) => l.id)).toEqual(['C1', 'H1', 'C2', 'H2']);
    expect(lines.every((l: any) => l.scored)).toBe(true);
    expect(text).toContain('starts here (its opening IS in this window)');
    expect(text).toContain('--- Session A: ends here ---');
    expect(text).not.toContain('### CONTEXT');
    expect(meta).toEqual({ sessionId: 'sess-1', userId: 42, scenarioId: 7 });
  });

  it('derives levels exactly as the cut pipeline does, through the real judge', async () => {
    // verbal: both required basics ticked, plus an advanced tick whose quote
    // is not in the line. Every other skill had no opportunity.
    const reply = {
      skills: FHS_SKILL_KEYS.map((key) =>
        key === 'verbal'
          ? {
              skill: 'verbal',
              opportunity: true,
              observed: [
                {
                  code: 'verbal.b1',
                  line: 'H1',
                  quote: 'what has been keeping you awake',
                },
                {
                  code: 'verbal.b2',
                  line: 'H2',
                  quote: 'work and home are both weighing on you',
                },
                {
                  code: 'verbal.a2',
                  line: 'H2',
                  quote: 'a quote that is not in the line',
                },
              ],
            }
          : { skill: key, opportunity: false, observed: [] },
      ),
    };
    const complete = jest.fn().mockResolvedValue({
      text: JSON.stringify(reply),
      model: FHS_JUDGE_MODEL,
      usage: { inputTokens: 900, outputTokens: 400 },
    });
    const judge = new FoundationalSkillsJudgeService({ complete } as any);
    const repo = repository();
    repo.loadTurns.mockResolvedValue(
      new Map([
        ['sess-1', turnsWithHelperChars(FHS_BENCHMARK_MIN_LEARNER_CHARS + 50)],
      ]),
    );
    const service = new FoundationalSkillsBenchmarkService(repo as any, judge);

    await expect(service.scoreSession(target)).resolves.toBe(
      FhsBenchmarkStatus.SCORED,
    );

    // Tagged as the benchmark, on the same prompt and pinned model.
    const request = complete.mock.calls[0][0];
    expect(request.taskId).toBe(FHS_BENCHMARK_JUDGE_TASK_ID);
    expect(request.task).toBe(LlmTask.FOUNDATIONAL_SKILLS_BENCHMARK_JUDGE);
    expect(request.model).toBe(FHS_JUDGE_MODEL);
    expect(request.system).toBe(buildJudgeSystemPrompt());
    expect(request.usageMetadata).toEqual({
      rubricVersion: FHS_RUBRIC_VERSION,
      sessionId: 'sess-1',
      scenarioId: 7,
    });

    const write = repo.upsertBenchmarkAssessment.mock.calls[0][0];
    // The fabricated advanced quote is dropped, so verbal is a 3, not a 4.
    expect(write.skillLevels).toEqual({ verbal: 3 });
    expect(write.compositeScore).toBe(3);
    expect(write.droppedTicks).toBe(1);
    expect(write.hasUnhelpfulBehaviour).toBe(false);
    expect(write.verdicts).toHaveLength(FHS_SKILL_KEYS.length);
    expect(write.verdicts.find((v: any) => v.skill === 'verbal')).toEqual({
      skill: 'verbal',
      opportunity: true,
      level: 3,
      observed: ['verbal.b1', 'verbal.b2'],
      notApplicable: [],
    });
    expect(write.promptTokens).toBe(900);
    expect(write.completionTokens).toBe(400);
    expect(write.learnerChars).toBe(FHS_BENCHMARK_MIN_LEARNER_CHARS + 50);
    expect(write.error).toBeNull();
    // Nothing stored carries transcript text.
    expect(JSON.stringify(write)).not.toContain('keeping you awake');
  });

  it('applies the one-unhelpful-behaviour rule: any unhelpful tick makes the skill a 1', async () => {
    const reply = {
      skills: FHS_SKILL_KEYS.map((key) =>
        key === 'verbal'
          ? {
              skill: 'verbal',
              opportunity: true,
              observed: [
                {
                  code: 'verbal.b1',
                  line: 'H1',
                  quote: 'what has been keeping you awake',
                },
                {
                  code: 'verbal.b2',
                  line: 'H2',
                  quote: 'work and home are both weighing on you',
                },
                {
                  code: 'verbal.u2',
                  line: 'H2',
                  quote: 'so work and home',
                },
              ],
            }
          : { skill: key, opportunity: false, observed: [] },
      ),
    };
    const complete = jest.fn().mockResolvedValue({
      text: JSON.stringify(reply),
      model: FHS_JUDGE_MODEL,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const repo = repository();
    repo.loadTurns.mockResolvedValue(
      new Map([
        ['sess-1', turnsWithHelperChars(FHS_BENCHMARK_MIN_LEARNER_CHARS + 50)],
      ]),
    );
    const service = new FoundationalSkillsBenchmarkService(
      repo as any,
      new FoundationalSkillsJudgeService({ complete } as any),
    );

    await service.scoreSession(target);
    const write = repo.upsertBenchmarkAssessment.mock.calls[0][0];
    expect(write.skillLevels).toEqual({ verbal: 1 });
    expect(write.hasUnhelpfulBehaviour).toBe(true);
  });

  it('records a FAILED attempt, keeping the dose and speech length, when the judge throws', async () => {
    const repo = repository();
    repo.loadTurns.mockResolvedValue(
      new Map([
        ['sess-1', turnsWithHelperChars(FHS_BENCHMARK_MIN_LEARNER_CHARS + 10)],
      ]),
    );
    const judge = {
      judgeBenchmark: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const service = new FoundationalSkillsBenchmarkService(
      repo as any,
      judge as any,
    );

    await expect(
      service.scoreSession({ ...target, attempts: 1 }),
    ).resolves.toBe(FhsBenchmarkStatus.FAILED);
    const write = repo.upsertBenchmarkAssessment.mock.calls[0][0];
    expect(write.status).toBe(FhsBenchmarkStatus.FAILED);
    expect(write.error).toBe('timeout');
    expect(write.compositeScore).toBeNull();
    expect(write.cutsBefore).toBe(4);
    expect(write.learnerChars).toBe(FHS_BENCHMARK_MIN_LEARNER_CHARS + 10);
  });

  it('refreshes doses first, then scores a bounded batch and tallies outcomes', async () => {
    const repo = repository();
    const order: string[] = [];
    repo.refreshBenchmarkCutsBefore.mockImplementation(async () => {
      order.push('refresh');
      return 2;
    });
    repo.findBenchmarkSessionsToScore.mockImplementation(async () => {
      order.push('find');
      return [
        target,
        { ...target, sessionId: 'sess-2' },
        { ...target, sessionId: 'sess-3' },
      ];
    });
    const service = new FoundationalSkillsBenchmarkService(
      repo as any,
      {} as any,
    );
    jest
      .spyOn(service, 'scoreSession')
      .mockImplementation(async (s) =>
        s.sessionId === 'sess-1'
          ? FhsBenchmarkStatus.SCORED
          : s.sessionId === 'sess-2'
            ? FhsBenchmarkStatus.SKIPPED
            : FhsBenchmarkStatus.FAILED,
      );

    await expect(service.tick()).resolves.toEqual({
      benchmarksScored: 1,
      benchmarksSkipped: 1,
      benchmarksFailed: 1,
      cutsBeforeRefreshed: 2,
    });
    expect(order).toEqual(['refresh', 'find']);
    expect(repo.findBenchmarkSessionsToScore).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      FHS_MAX_ATTEMPTS,
      FHS_BENCHMARKS_PER_TICK,
    );
  });
});

describe('renderSession', () => {
  it('returns null for a session with no turns', () => {
    expect(
      renderSession({
        sessionId: 's',
        endedAt: new Date(),
        tenantId: null,
        turns: [],
      }),
    ).toBeNull();
  });
});

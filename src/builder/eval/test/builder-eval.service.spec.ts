import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BuilderEvalService,
  compareSuites,
  summariseSuite,
} from '../service/builder-eval.service';
import { BUILDER_EVAL_GATED_PROMPT_CODES } from '../../constants/builder-eval-gate.constants';
import { BUILDER_PROMPTS } from '../../constants/builder.constants';

const fixture = (id: string, kind: 'interview' | 'prd_review' = 'interview') =>
  ({ id, name: id, kind }) as any;
const run = (
  fixtureId: string,
  status: string,
  overrides: Record<string, any> = {},
) =>
  ({
    fixtureId,
    status,
    gates: {
      unseenFailures: 0,
      askedBeforeReading: 0,
      unrepairedEditFailures: 0,
      falseUpdateClaims: 0,
      consistent: true,
      evidenceCited: true,
    },
    metrics: { corrections: 0, costUsd: 1 },
    judge: { score: 1, total: 3 },
    ...overrides,
  }) as any;

describe('BuilderEvalService', () => {
  it('keeps the gated prompt codes in step with BUILDER_PROMPTS', () => {
    expect([...BUILDER_EVAL_GATED_PROMPT_CODES].sort()).toEqual(
      [
        BUILDER_PROMPTS.INTERVIEWER_SYSTEM,
        BUILDER_PROMPTS.PLATFORM_RULES,
      ].sort(),
    );
  });

  describe('summariseSuite', () => {
    it('rolls runs up per fixture and overall', () => {
      const summary = summariseSuite(
        [fixture('debrief'), fixture('seeded', 'prd_review')],
        [
          run('debrief', 'failed', {
            gates: {
              ...run('x', 'x').gates,
              unseenFailures: 2,
              consistent: false,
            },
            metrics: { corrections: 3, costUsd: 2.5 },
            judge: { score: 0.5, total: 4 },
          }),
          run('debrief', 'passed'),
          run('seeded', 'passed', { gates: null, judge: null }),
          run('seeded', 'errored', { gates: null, judge: null, metrics: null }),
        ],
      );

      expect(summary.fixtures[0]).toEqual(
        expect.objectContaining({
          runs: 2,
          passed: 1,
          gateViolations: 3,
          corrections: 3,
          judgeScore: 0.75,
        }),
      );
      expect(summary).toEqual(
        expect.objectContaining({
          runs: 4,
          passed: 2,
          errored: 1,
          gateViolations: 3,
          corrections: 3,
          costUsd: 4.5,
        }),
      );
    });
  });

  describe('compareSuites', () => {
    const summary = (
      rows: Record<string, any>[],
      extra: Record<string, any> = {},
    ) => ({
      fixtures: rows.map((row) => ({
        fixtureId: row.id,
        name: row.id,
        kind: row.kind ?? 'interview',
        runs: 3,
        passed: row.passed ?? 0,
        gateViolations: row.gates ?? 0,
        corrections: row.corrections ?? 0,
        judgeScore: row.judge ?? null,
      })),
      runs: rows.length * 3,
      passed: 0,
      errored: 0,
      gateViolations: rows.reduce((sum, row) => sum + (row.gates ?? 0), 0),
      corrections: rows.reduce((sum, row) => sum + (row.corrections ?? 0), 0),
      judgeScore: rows.length
        ? rows.reduce((sum, row) => sum + (row.judge ?? 0), 0) / rows.length
        : null,
      costUsd: 0,
      ...extra,
    });

    /** Today's interviewer fails these fixtures; an improvement must still be able to pass. */
    it('passes a candidate that is better than a failing baseline', () => {
      const verdict = compareSuites(
        summary([{ id: 'debrief', gates: 2, corrections: 1, judge: 0.8 }]),
        summary([{ id: 'debrief', gates: 9, corrections: 9, judge: 0.4 }]),
        'base-1',
      );

      expect(verdict.pass).toBe(true);
      expect(verdict.baselineSuiteId).toBe('base-1');
    });

    it('fails a candidate that makes anything measurably worse', () => {
      const base = summary([
        { id: 'debrief', gates: 2, corrections: 1, judge: 0.8 },
      ]);

      expect(
        compareSuites(
          summary([{ id: 'debrief', gates: 3, corrections: 1, judge: 0.8 }]),
          base,
          'b',
        ).pass,
      ).toBe(false);
      expect(
        compareSuites(
          summary([{ id: 'debrief', gates: 2, corrections: 2, judge: 0.8 }]),
          base,
          'b',
        ).pass,
      ).toBe(false);
      const judged = compareSuites(
        summary([{ id: 'debrief', gates: 2, corrections: 1, judge: 0.7 }]),
        base,
        'b',
      );
      expect(judged.pass).toBe(false);
      expect(judged.reasons.join(' ')).toContain('Checklist score fell');
    });

    it('compares only the fixtures the candidate ran, and refuses a partial run', () => {
      const base = summary([
        { id: 'debrief', gates: 1 },
        { id: 'other', gates: 50 },
      ]);
      expect(
        compareSuites(summary([{ id: 'debrief', gates: 2 }]), base, 'b').pass,
      ).toBe(false);
      expect(
        compareSuites(
          summary([{ id: 'debrief', gates: 0 }], { errored: 1 }),
          base,
          'b',
        ).pass,
      ).toBe(false);
    });

    it('fails a candidate that lets the critic miss more seeded defects', () => {
      expect(
        compareSuites(
          summary([{ id: 'seeded', kind: 'prd_review', passed: 2 }]),
          summary([{ id: 'seeded', kind: 'prd_review', passed: 3 }]),
          'b',
        ).pass,
      ).toBe(false);
    });
  });

  describe('submitting a prompt candidate', () => {
    const build = () => {
      const suites = {
        count: jest.fn().mockResolvedValue(0),
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
        })),
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((row) => row),
        save: jest.fn(async (row) => ({ id: 'suite-1', ...row })),
        update: jest.fn(),
        findOneOrFail: jest.fn(),
      };
      const runs = {
        create: jest.fn((row) => row),
        save: jest.fn(),
        find: jest.fn().mockResolvedValue([]),
      };
      const dataSource = {
        getRepository: jest.fn((entity: any) =>
          entity?.name === 'BuilderEvalSuite' ? suites : runs,
        ),
      };
      const fixtures = {
        listActive: jest.fn().mockResolvedValue([fixture('debrief')]),
        findMany: jest.fn(),
      };
      const service = new BuilderEvalService(
        dataSource as any,
        fixtures as any,
        { run: jest.fn() } as any,
        {} as any,
        { get: jest.fn().mockResolvedValue({ validatedTurns: true }) } as any,
      );
      // The background execution is not under test here.
      jest.spyOn(service as any, 'execute').mockResolvedValue(undefined);
      return { service, suites, runs };
    };

    it('refuses a prompt the gate does not cover', async () => {
      const { service } = build();
      await expect(
        service.submitPromptCandidate(
          { promptCode: 'debrief_chat', content: 'x' },
          7,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a candidate with nothing in it', async () => {
      const { service } = build();
      await expect(
        service.submitPromptCandidate(
          { promptCode: 'builder_interviewer_system', content: '  ' },
          7,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('starts a prompt-gate suite carrying the candidate as overrides', async () => {
      const { service, suites, runs } = build();

      await service.submitPromptCandidate(
        {
          promptCode: 'builder_interviewer_system',
          content: 'New interviewer.',
          model: 'gpt-5',
        },
        7,
        { repetitions: 2 },
      );

      expect(suites.save).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'prompt_gate',
          repetitions: 2,
          fixtureIds: ['debrief'],
          overrides: {
            prompts: { builder_interviewer_system: 'New interviewer.' },
            llmConfig: { builder_interviewer_system: { model: 'gpt-5' } },
            // The loop it ran is part of the record — the live one here:
            // validated, without the interview protocol (the stub has no
            // situationBrief, which reads as off).
            validatedTurns: true,
            situationBrief: false,
          },
          candidate: expect.objectContaining({
            content: 'New interviewer.',
            model: 'gpt-5',
          }),
        }),
      );
      expect(runs.save.mock.calls[0][0]).toHaveLength(2);
    });

    it('refuses a second candidate for a prompt already under evaluation', async () => {
      const { service, suites } = build();
      suites.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
      } as any);

      await expect(
        service.submitPromptCandidate(
          { promptCode: 'builder_platform_rules', content: 'x' },
          7,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('caps how many suites run at once', async () => {
      const { service, suites } = build();
      suites.count.mockResolvedValue(2);

      await expect(
        service.startSuite({ trigger: 'manual', userId: 7 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('publishes a passed candidate through the prompts service, marked eval-approved', async () => {
    const promptsService = {
      findIdByCode: jest.fn().mockResolvedValue('prompt-1'),
      updatePrompt: jest.fn().mockResolvedValue(true),
    };
    const suites = { update: jest.fn() };
    const service = new BuilderEvalService(
      { getRepository: () => suites } as any,
      {} as any,
      {} as any,
      promptsService as any,
      { get: jest.fn().mockResolvedValue({ validatedTurns: true }) } as any,
    );

    await (service as any).publish({
      id: 'suite-1',
      createdBy: 7,
      candidate: {
        promptCode: 'builder_interviewer_system',
        content: 'New interviewer.',
      },
    });

    expect(promptsService.updatePrompt).toHaveBeenCalledWith(
      'prompt-1',
      { prompt: 'New interviewer.', useDashboardOverride: true },
      { evalApproved: true },
    );
    expect(suites.update).toHaveBeenCalledWith(
      { id: 'suite-1' },
      { publishedAt: expect.any(Date) },
    );
  });

  it('publishes a cleared temperature as a cleared override', async () => {
    const promptsService = {
      findIdByCode: jest.fn().mockResolvedValue('prompt-1'),
      updatePrompt: jest.fn().mockResolvedValue(true),
    };
    const service = new BuilderEvalService(
      { getRepository: () => ({ update: jest.fn() }) } as any,
      {} as any,
      {} as any,
      promptsService as any,
      { get: jest.fn().mockResolvedValue({ validatedTurns: true }) } as any,
    );

    await (service as any).publish({
      id: 'suite-2',
      createdBy: 7,
      candidate: {
        promptCode: 'builder_interviewer_system',
        temperature: null,
      },
    });

    expect(promptsService.updatePrompt).toHaveBeenCalledWith(
      'prompt-1',
      { temperature: null },
      { evalApproved: true },
    );
  });

  describe('choosing a baseline for a prompt gate', () => {
    const completed = (id: string, overrides: any) => ({
      id,
      trigger: 'manual',
      status: 'completed',
      completedAt: new Date(),
      overrides,
      summary: { runs: 3 },
      fixtureIds: ['debrief'],
      repetitions: 3,
    });
    const build = (recent: any[]) => {
      const suites = { find: jest.fn().mockResolvedValue(recent) };
      const service = new BuilderEvalService(
        { getRepository: () => suites } as any,
        {} as any,
        {} as any,
        {} as any,
        { get: jest.fn().mockResolvedValue({ validatedTurns: true }) } as any,
      );
      const startSuite = jest
        .spyOn(service, 'startSuite')
        .mockResolvedValue(null as any);
      return { service, startSuite };
    };
    const gate = (validatedTurns: boolean) => ({
      id: 'gate-1',
      fixtureIds: ['debrief'],
      repetitions: 3,
      createdBy: 7,
      overrides: {
        prompts: { builder_interviewer_system: 'x' },
        validatedTurns,
      },
    });

    it('reuses only a baseline that ran the same interview loop', async () => {
      // Newest first: a legacy-loop suite from before the switch, then a
      // validated one. A validated candidate must be compared with the second.
      const legacy = completed('legacy-1', null);
      const validated = completed('validated-1', { validatedTurns: true });
      const { service } = build([legacy, validated]);

      await expect((service as any).resolveBaseline(gate(true))).resolves.toBe(
        validated,
      );
      await expect((service as any).resolveBaseline(gate(false))).resolves.toBe(
        legacy,
      );
    });

    it('never reuses a suite that overrode a prompt or a model', async () => {
      const { service, startSuite } = build([
        completed('cand-1', {
          prompts: { builder_interviewer_system: 'y' },
          validatedTurns: true,
        }),
      ]);

      await (service as any).resolveBaseline(gate(true));

      expect(startSuite).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'baseline',
          overrides: { validatedTurns: true, situationBrief: false },
        }),
      );
    });
  });
});

/**
 * A deploy replaces every task, and a suite is hours of runs: the first
 * production baseline was cut off after 5 of 63 runs. A silent suite is now
 * claimed by exactly one process and resumed.
 */
describe('BuilderEvalService — resuming a suite a deploy cut off', () => {
  const stalledSuite = {
    id: 'suite-9',
    status: 'running',
    fixtureIds: ['debrief'],
    repetitions: 3,
    trigger: 'manual',
  };

  const build = (claim: unknown[]) => {
    const suites = {
      find: jest.fn().mockResolvedValue([stalledSuite]),
      update: jest.fn(),
    };
    const runs = { update: jest.fn() };
    const dataSource = {
      getRepository: (entity: any) =>
        entity?.name === 'BuilderEvalSuite' ? suites : runs,
      query: jest.fn().mockResolvedValue(claim),
    };
    const fixtures = {
      findMany: jest.fn().mockResolvedValue([{ id: 'debrief' }]),
    };
    const service = new BuilderEvalService(
      dataSource as any,
      fixtures as any,
      { run: jest.fn() } as any,
      {} as any,
      { get: jest.fn().mockResolvedValue({ validatedTurns: true }) } as any,
    );
    const execute = jest
      .spyOn(service as any, 'execute')
      .mockResolvedValue(undefined);
    return { service, suites, runs, dataSource, execute };
  };

  it('claims it, requeues the half-done runs and carries on here', async () => {
    const { service, runs, dataSource, execute } = build([
      [{ resumeCount: 1 }],
      1,
    ]);

    await service.resumeStalled();

    // The claim is the atomic part: only a process whose UPDATE matched resumes.
    expect(dataSource.query.mock.calls[0][0]).toContain(
      '"resumeCount" = "resumeCount" + 1',
    );
    expect(runs.update).toHaveBeenCalledWith(
      { suiteId: 'suite-9', status: 'running' },
      { status: 'queued', startedAt: null },
    );
    expect(execute).toHaveBeenCalledWith('suite-9', [{ id: 'debrief' }]);
  });

  it('leaves it alone when another process claimed it first', async () => {
    const { service, runs, execute } = build([[], 0]);

    await service.resumeStalled();

    expect(runs.update).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('gives up after the resume limit instead of looping', async () => {
    const { service, suites, runs, execute } = build([[{ resumeCount: 4 }], 1]);

    await service.resumeStalled();

    expect(execute).not.toHaveBeenCalled();
    expect(suites.update).toHaveBeenCalledWith(
      { id: 'suite-9' },
      expect.objectContaining({ status: 'errored' }),
    );
    expect(runs.update).toHaveBeenCalledWith(
      expect.objectContaining({ suiteId: 'suite-9' }),
      expect.objectContaining({ status: 'errored' }),
    );
  });
});

/** Two duplicate baselines started minutes apart both ran to the end: nothing could stop one. */
describe('BuilderEvalService — cancelling a suite', () => {
  const build = (affected: number) => {
    const suites = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'suite-1', status: 'running' }),
      findOneOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'suite-1', status: 'cancelled' }),
      update: jest.fn().mockResolvedValue({ affected }),
    };
    const runs = { update: jest.fn() };
    const service = new BuilderEvalService(
      {
        getRepository: (entity: any) =>
          entity?.name === 'BuilderEvalSuite' ? suites : runs,
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, suites, runs };
  };

  it('cancels a running suite and its unstarted runs', async () => {
    const { service, suites, runs } = build(1);

    const suite = await service.cancelSuite('suite-1', 7);

    expect(suites.update).toHaveBeenCalledWith(
      { id: 'suite-1', status: 'running' },
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(runs.update).toHaveBeenCalledWith(
      { suiteId: 'suite-1', status: 'queued' },
      { status: 'cancelled' },
    );
    expect(suite.status).toBe('cancelled');
  });

  it('refuses a suite that is not running', async () => {
    const { service, runs } = build(0);

    await expect(service.cancelSuite('suite-1', 7)).rejects.toThrow(
      /nothing to cancel/,
    );
    expect(runs.update).not.toHaveBeenCalled();
  });

  it('takes no more runs once the suite is no longer running', async () => {
    const runner = { run: jest.fn() };
    const suites = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'suite-1', status: 'cancelled' }),
      update: jest.fn(),
    };
    const runs = {
      find: jest.fn().mockResolvedValue([
        { id: 'r1', fixtureId: 'f1', repetition: 1 },
        { id: 'r2', fixtureId: 'f1', repetition: 2 },
      ]),
      update: jest.fn(),
    };
    const service = new BuilderEvalService(
      {
        getRepository: (entity: any) =>
          entity?.name === 'BuilderEvalSuite' ? suites : runs,
      } as any,
      {} as any,
      runner as any,
      {} as any,
      {} as any,
    );

    await (service as any).runQueued({ id: 'suite-1', createdBy: 7 }, [
      { id: 'f1' },
    ]);

    expect(runner.run).not.toHaveBeenCalled();
  });

  it('never completes or publishes a suite that was cancelled meanwhile', async () => {
    const promptsService = { findIdByCode: jest.fn(), updatePrompt: jest.fn() };
    const suites = {
      findOneOrFail: jest.fn().mockResolvedValue({
        id: 'gate-1',
        trigger: 'manual',
        candidate: { promptCode: 'builder_interviewer_system', content: 'x' },
      }),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const runs = { find: jest.fn().mockResolvedValue([]) };
    const service = new BuilderEvalService(
      {
        getRepository: (entity: any) =>
          entity?.name === 'BuilderEvalSuite' ? suites : runs,
      } as any,
      {} as any,
      {} as any,
      promptsService as any,
      {} as any,
    );
    jest.spyOn(service as any, 'runQueued').mockResolvedValue(undefined);

    await (service as any).execute('gate-1', []);

    // The completion write is conditional on still running, and it matched nothing.
    expect(suites.update).toHaveBeenCalledWith(
      { id: 'gate-1', status: 'running' },
      expect.objectContaining({ status: 'completed' }),
    );
    expect(promptsService.updatePrompt).not.toHaveBeenCalled();
  });
});

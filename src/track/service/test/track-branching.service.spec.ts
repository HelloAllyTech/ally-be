import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { TrackBranchingService } from '../track-branching.service';
import { TrackItemType } from '../../type/track.type';
import {
  BRANCHING_ROUND_COOLDOWN_MS,
  BranchingScenarioContent,
  resolveBranchingRound,
} from '../../type/branching.type';

function content(
  settings: BranchingScenarioContent['settings'],
): BranchingScenarioContent {
  return {
    startNodeId: 'start',
    settings,
    nodes: [
      {
        id: 'start',
        text: 'Scene',
        choices: [
          { id: 'good', text: 'Reflect', nextNodeId: 'win' },
          { id: 'bad', text: 'Advise', nextNodeId: 'lose' },
        ],
      },
      { id: 'win', text: 'Opens up', outcome: 'POSITIVE' as any },
      { id: 'lose', text: 'Defensive', outcome: 'NEGATIVE' as any },
    ],
  };
}

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

const run = (hAgo: number, endingNodeId = 'lose', score = 0) => ({
  endingNodeId,
  score,
  at: hoursAgo(hAgo),
});

function build(
  scenario: BranchingScenarioContent,
  progress: Record<string, unknown> = {},
) {
  const row = {
    id: 'p1',
    trackEnrollmentId: 'e1',
    status: SessionItemStatus.UNLOCKED,
    meta: undefined,
    ...progress,
  };
  const repo = { update: jest.fn(), findOne: jest.fn().mockResolvedValue(row) };
  const enrollment = {
    getPermittedItemProgress: jest.fn().mockResolvedValue({
      item: { type: TrackItemType.BRANCHING_SCENARIO, content: scenario },
      progress: row,
    }),
  };
  const progressService = {
    completeItem: jest.fn().mockResolvedValue({ completed: true }),
  };
  const rows: Record<string, unknown> = {
    TrackItem: {
      id: 'i1',
      type: TrackItemType.BRANCHING_SCENARIO,
    },
    TrackEnrollment: { id: 'e1', tenantId: 'tenant-a' },
  };
  const dataSource = {
    getRepository: (entity: { name: string }) => ({
      findOne: jest.fn().mockResolvedValue(rows[entity.name] ?? null),
    }),
  };
  const service = new TrackBranchingService(
    dataSource as any,
    repo as any,
    enrollment as any,
    progressService as any,
  );
  return { service, repo, progressService, rows };
}

describe('TrackBranchingService.recordResult', () => {
  it('completes on a passing run', async () => {
    const { service, progressService, repo } = build(
      content({ passScore: 70 }),
    );
    const result = await service.recordResult('i1', ['good']);
    expect(result).toMatchObject({
      score: 100,
      passed: true,
      itemCompleted: true,
    });
    expect(progressService.completeItem).toHaveBeenCalledWith('p1', {});
    expect(repo.update).toHaveBeenCalled();
  });

  it('does not complete on a run below the pass mark, but counts the attempt', async () => {
    const { service, progressService, repo } = build(
      content({ passScore: 70, maxAttempts: 3 }),
    );
    const result = await service.recordResult('i1', ['bad']);
    expect(result).toMatchObject({
      score: 0,
      passed: false,
      itemCompleted: false,
      attemptsUsed: 1,
      attemptsLeft: 2,
      exhausted: false,
    });
    expect(progressService.completeItem).not.toHaveBeenCalled();
    expect(repo.update.mock.calls[0][1].meta.branchingRoundRuns).toHaveLength(
      1,
    );
  });

  it('completes on any ending when there is no pass mark', async () => {
    const { service, progressService } = build(content(undefined));
    const result = await service.recordResult('i1', ['bad']);
    expect(result.passed).toBe(true);
    expect(progressService.completeItem).toHaveBeenCalled();
  });

  it('rejects a path that is not a walk to an ending', async () => {
    const { service } = build(content({ passScore: 70 }));
    await expect(service.recordResult('i1', ['nope'])).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('TrackBranchingService attempt rounds', () => {
  const gated = () => content({ passScore: 70, maxAttempts: 2 });

  it('the last failed attempt returns the recap and when the next round opens', async () => {
    const { service } = build(gated(), {
      meta: { branchingRoundRuns: [run(1, 'quiet', 50)] },
    });
    const result = await service.recordResult('i1', ['bad']);
    expect(result).toMatchObject({
      passed: false,
      attemptsLeft: 0,
      exhausted: true,
    });
    expect(result.recap).toHaveLength(2);
    const opensAt = new Date(result.nextRoundAt!).getTime();
    expect(opensAt - Date.now()).toBeGreaterThan(
      BRANCHING_ROUND_COOLDOWN_MS - 5000,
    );
  });

  it('blocks a run while the round is exhausted and says when it reopens', async () => {
    const { service } = build(gated(), {
      meta: { branchingRoundRuns: [run(3), run(2)] },
    });
    await expect(service.recordResult('i1', ['good'])).rejects.toMatchObject({
      response: {
        message: expect.stringMatching(/used all attempts/),
        nextRoundAt: expect.any(String),
      },
    });
  });

  it('opens a fresh round once the cooldown has passed', async () => {
    const { service, repo } = build(gated(), {
      meta: { branchingRoundRuns: [run(30), run(25)] },
    });
    const result = await service.recordResult('i1', ['bad']);
    expect(result).toMatchObject({ attemptsUsed: 1, attemptsLeft: 1 });
    // The stale round is replaced, not appended to.
    expect(repo.update.mock.calls[0][1].meta.branchingRoundRuns).toHaveLength(
      1,
    );
  });

  it('lets a completed item be replayed past the attempt limit', async () => {
    const { service } = build(gated(), {
      status: SessionItemStatus.COMPLETED,
      meta: { branchingRoundRuns: [run(3), run(2)] },
    });
    const result = await service.recordResult('i1', ['bad']);
    expect(result.itemCompleted).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it('an unlimited scenario is never exhausted', async () => {
    const { service } = build(content({ passScore: 70 }), {
      meta: { branchingRoundRuns: [run(1), run(1), run(1), run(1)] },
    });
    const result = await service.recordResult('i1', ['bad']);
    expect(result.exhausted).toBe(false);
    expect(result.attemptsLeft).toBeNull();
  });
});

describe('resolveBranchingRound', () => {
  const now = new Date();

  it('counts runs in the round and is not exhausted below the limit', () => {
    expect(resolveBranchingRound([run(1)], 3, false, now)).toMatchObject({
      attemptsUsed: 1,
      exhausted: false,
      nextRoundAt: null,
    });
  });

  it('is exhausted at the limit, 24h after the last run', () => {
    const state = resolveBranchingRound([run(5), run(2)], 2, false, now);
    expect(state.exhausted).toBe(true);
    expect(new Date(state.nextRoundAt!).getTime()).toBeCloseTo(
      new Date(run(2).at).getTime() + BRANCHING_ROUND_COOLDOWN_MS,
      -3,
    );
  });

  it('starts over once the cooldown has passed', () => {
    expect(
      resolveBranchingRound([run(40), run(30)], 2, false, now),
    ).toMatchObject({ attemptsUsed: 0, exhausted: false, runs: [] });
  });

  it('treats a scenario with no stored runs as a fresh round', () => {
    expect(resolveBranchingRound(undefined, 2, false, now)).toMatchObject({
      attemptsUsed: 0,
      exhausted: false,
    });
  });
});

describe('TrackBranchingService.resetAttempts', () => {
  afterEach(() => jest.restoreAllMocks());

  it('clears only the current round for a learner in the caller’s organisation', async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-a');
    const { service, repo } = build(content({ maxAttempts: 2 }), {
      meta: {
        branchingRoundRuns: [run(3), run(2)],
        branchingBestScore: 50,
        branchingRunCount: 2,
      },
    });
    await expect(service.resetAttempts('i1', 7)).resolves.toEqual({
      success: true,
    });
    const meta = repo.update.mock.calls[0][1].meta;
    expect(meta.branchingRoundRuns).toEqual([]);
    expect(meta.branchingBestScore).toBe(50);
    expect(meta.branchingRunCount).toBe(2);
  });

  it('answers not-found for a learner in another organisation', async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-b');
    const { service, repo } = build(content({ maxAttempts: 2 }));
    await expect(service.resetAttempts('i1', 7)).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('answers not-found when the item is not a scenario quiz', async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-a');
    const { service, rows } = build(content({ maxAttempts: 2 }));
    rows.TrackItem = { id: 'i1', type: TrackItemType.ARTICLE };
    await expect(service.resetAttempts('i1', 7)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('TrackBranchingService.listLearnerAttempts', () => {
  afterEach(() => jest.restoreAllMocks());

  const row = (over: Record<string, unknown>) => ({
    trackId: 't1',
    trackTitle: 'Course',
    trackItemId: 'i1',
    title: 'Scenario',
    content: content({ passScore: 70, maxAttempts: 2 }),
    status: SessionItemStatus.UNLOCKED,
    meta: null,
    ...over,
  });

  const serviceWith = (rows: unknown[]) => {
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    return {
      dataSource,
      service: new TrackBranchingService(
        dataSource as any,
        {} as any,
        {} as any,
        {} as any,
      ),
    };
  };

  it('lists a paused scenario with when it reopens, scoped to the caller’s tenant', async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-a');
    const { service, dataSource } = serviceWith([
      row({
        meta: { branchingRoundRuns: [run(3), run(2)], branchingBestScore: 50 },
      }),
    ]);
    const result = await service.listLearnerAttempts(7);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      trackItemId: 'i1',
      attemptsUsed: 2,
      maxAttempts: 2,
      exhausted: true,
      bestScore: 50,
    });
    expect(result[0].nextRoundAt).toEqual(expect.any(String));
    expect(dataSource.query.mock.calls[0][1].slice(0, 2)).toEqual([
      7,
      'tenant-a',
    ]);
  });

  it('leaves out completed items and ones with no attempts this round', async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-a');
    const { service } = serviceWith([
      row({
        status: SessionItemStatus.COMPLETED,
        meta: { branchingRoundRuns: [run(1)] },
      }),
      row({ trackItemId: 'i2', meta: null }),
      row({
        trackItemId: 'i3',
        meta: { branchingRoundRuns: [run(40), run(30)] },
      }),
    ]);
    // i3's round used every attempt but the pause has passed, so it is a fresh round.
    await expect(service.listLearnerAttempts(7)).resolves.toEqual([]);
  });

  it('has nothing to show without a tenant in context', async () => {
    jest
      .spyOn(ExecutionManager, 'getTenantId')
      .mockReturnValue(undefined as any);
    const { service } = serviceWith([]);
    await expect(service.listLearnerAttempts(7)).rejects.toThrow(
      NotFoundException,
    );
  });
});

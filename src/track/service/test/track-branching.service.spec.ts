import { BadRequestException } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackBranchingService } from '../track-branching.service';
import { TrackItemType } from '../../type/track.type';
import { BranchingScenarioContent } from '../../type/branching.type';

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

function build(
  scenario: BranchingScenarioContent,
  progress: Record<string, unknown> = {},
) {
  const row = {
    id: 'p1',
    status: SessionItemStatus.UNLOCKED,
    meta: undefined,
    ...progress,
  };
  const repo = { update: jest.fn() };
  const enrollment = {
    getPermittedItemProgress: jest.fn().mockResolvedValue({
      item: { type: TrackItemType.BRANCHING_SCENARIO, content: scenario },
      progress: row,
    }),
  };
  const progressService = {
    completeItem: jest.fn().mockResolvedValue({ completed: true }),
  };
  const service = new TrackBranchingService(
    repo as any,
    enrollment as any,
    progressService as any,
  );
  return { service, repo, progressService };
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
    });
    expect(progressService.completeItem).not.toHaveBeenCalled();
    expect(repo.update.mock.calls[0][1].meta.branchingRunCount).toBe(1);
  });

  it('completes on any ending when there is no pass mark', async () => {
    const { service, progressService } = build(content(undefined));
    const result = await service.recordResult('i1', ['bad']);
    expect(result.passed).toBe(true);
    expect(progressService.completeItem).toHaveBeenCalled();
  });

  it('blocks a further run once attempts are used up', async () => {
    const { service } = build(content({ passScore: 70, maxAttempts: 2 }), {
      meta: { branchingRunCount: 2 },
    });
    await expect(service.recordResult('i1', ['good'])).rejects.toThrow(
      /used all attempts/,
    );
  });

  it('lets a completed item be replayed past the attempt limit', async () => {
    const { service } = build(content({ passScore: 70, maxAttempts: 1 }), {
      status: SessionItemStatus.COMPLETED,
      meta: { branchingRunCount: 1 },
    });
    const result = await service.recordResult('i1', ['bad']);
    expect(result.itemCompleted).toBe(true);
  });

  it('rejects a path that is not a walk to an ending', async () => {
    const { service } = build(content({ passScore: 70 }));
    await expect(service.recordResult('i1', ['nope'])).rejects.toThrow(
      BadRequestException,
    );
  });
});

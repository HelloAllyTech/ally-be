import { ImprovementNarrationService } from '../improvement-narration.service';
import { CopilotMessageRepository } from '../../repository/copilot-message.repository';
import { ImprovementRoundRepository } from '../../repository/improvement-round.repository';
import { ImprovementRun } from '../../entity/improvement-run.entity';
import { ImprovementRound } from '../../entity/improvement-round.entity';
import { ImprovementRunOutcome } from '../../enum/improvement-run.enum';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const run = (overrides: Record<string, any> = {}): ImprovementRun =>
  ({
    id: RUN_ID,
    specId: 'spec-1',
    baseVersionId: 'v-base',
    bestVersionId: 'v-best',
    acceptedVersionId: 'v-accepted',
    outcome: null,
    config: { copilotSessionId: SESSION_ID },
    createdBy: 7,
    ...overrides,
  }) as unknown as ImprovementRun;

const round = (overrides: Record<string, any> = {}): ImprovementRound =>
  ({
    id: 'round-1',
    improvementRunId: RUN_ID,
    roundNumber: 2,
    kind: 'ITERATION',
    candidateVersionId: 'v-best',
    scores: {
      overall: 74,
      test_counts: { passed: 3, failed: 1, inconclusive: 0 },
    },
    ...overrides,
  }) as unknown as ImprovementRound;

describe('ImprovementNarrationService', () => {
  let appendMessage: jest.Mock;
  let listByRun: jest.Mock;
  let service: ImprovementNarrationService;

  beforeEach(() => {
    appendMessage = jest.fn().mockResolvedValue({ seq: 1 });
    listByRun = jest.fn().mockResolvedValue([
      round({
        roundNumber: 1,
        kind: 'BASELINE',
        candidateVersionId: 'v-base',
      }),
      round(),
    ]);
    service = new ImprovementNarrationService(
      { appendMessage } as unknown as CopilotMessageRepository,
      { listByRun } as unknown as ImprovementRoundRepository,
    );
  });

  it('posts a round_scored assistant row with score + delta metadata', async () => {
    await service.postRoundScored(run(), round(), {
      vsPrevious: { overall: { before: 68, after: 74, delta: 6 } } as any,
      vsBaseline: { overall: { before: 65, after: 74, delta: 9 } } as any,
    });

    expect(appendMessage).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('Round 2'),
        metadata: expect.objectContaining({
          kind: 'improvement_update',
          subkind: 'round_scored',
          improvementRunId: RUN_ID,
          roundNumber: 2,
          scores: {
            overall: 74,
            testCounts: { passed: 3, failed: 1, inconclusive: 0 },
          },
          deltas: { overallVsPrevious: 6, overallVsBaseline: 9 },
        }),
        createdBy: 7,
      }),
    );
    expect(appendMessage.mock.calls[0][1].content).toContain('+6');
  });

  it('posts the ready row with best/accepted version ids', async () => {
    await service.postReady(run());

    const [, payload] = appendMessage.mock.calls[0];
    expect(payload.metadata).toEqual(
      expect.objectContaining({
        kind: 'improvement_ready',
        improvementRunId: RUN_ID,
        bestVersionId: 'v-best',
        acceptedVersionId: 'v-accepted',
      }),
    );
    expect(payload.content).toContain('applied to your draft');
  });

  it('postFinished on a weaker outcome asks the accept/keep/iterate question', async () => {
    await service.postFinished(run(), ImprovementRunOutcome.MAX_ROUNDS);

    const [, payload] = appendMessage.mock.calls[0];
    expect(payload.metadata.subkind).toBe('finished');
    expect(payload.metadata.outcome).toBe(ImprovementRunOutcome.MAX_ROUNDS);
    expect(payload.metadata.trajectory).toHaveLength(2);
    expect(payload.content).toContain('accept the best version');
  });

  it('no-ops when the run has no copilotSessionId', async () => {
    await service.postReady(run({ config: {} }));
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it('swallows append failures — narration never throws', async () => {
    appendMessage.mockRejectedValue(new Error('db down'));
    await expect(service.postFailed(run(), 'boom')).resolves.toBeUndefined();
  });

  it('swallows trajectory lookup failures', async () => {
    listByRun.mockRejectedValue(new Error('db down'));
    await expect(
      service.postFinished(run(), ImprovementRunOutcome.NO_PROPOSALS),
    ).resolves.toBeUndefined();
    expect(appendMessage).toHaveBeenCalled(); // still posts, with empty trajectory
  });
});

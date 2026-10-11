import { BugHunterScoreboardService } from '../bug-hunter-scoreboard.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';

const f = (overrides: Partial<BugFinding>): BugFinding =>
  ({
    id: Math.random().toString(36).slice(2),
    repo: 'ally-web',
    source: BugFindingSource.CODE_REVIEW,
    status: BugFindingStatus.NEW,
    runId: 'run-g',
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  }) as BugFinding;

describe('BugHunterScoreboardService', () => {
  it('folds findings by sense and by the model that ran their run, counting accepted, declined and pending', async () => {
    const findings = [
      f({ status: BugFindingStatus.MERGED }),
      f({
        status: BugFindingStatus.NEW,
        metadata: { independentVerification: 'confirmed' },
      }),
      f({
        status: BugFindingStatus.DISMISSED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
      }),
      f({
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.WONT_FIX,
      }), // not a finder error
      f({ status: BugFindingStatus.PENDING_APPROVAL }),
      f({
        source: BugFindingSource.TEST_FAILURE,
        status: BugFindingStatus.RELEASED,
        runId: 'run-c',
      }),
      f({
        source: BugFindingSource.LINT_ERROR,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.DUPLICATE,
        runId: 'run-c',
      }),
      f({
        source: BugFindingSource.REPORTED_BUG,
        status: BugFindingStatus.NEW,
        runId: null,
      }),
      f({
        source: BugFindingSource.UX_SIGNAL,
        status: BugFindingStatus.MERGED,
      }), // no sense → not counted
    ];
    const service = new BugHunterScoreboardService(
      { find: jest.fn().mockResolvedValue(findings) } as never,
      {
        find: jest.fn().mockResolvedValue([
          { id: 'run-g', engine: 'gemini', model: 'gemini-2.5-pro' },
          { id: 'run-c', engine: 'claude-code', model: 'claude-sonnet-5' },
        ]),
      } as never,
    );

    const board = await service.forRepo('ally-web', 30);

    expect(board.bySense.code_review).toEqual({
      filed: 5,
      accepted: 2,
      declined: 1,
      pending: 1,
    });
    expect(board.bySense.tests).toEqual({
      filed: 2,
      accepted: 1,
      declined: 1,
      pending: 0,
    });
    expect(board.bySense.reported_bugs).toEqual({
      filed: 1,
      accepted: 0,
      declined: 0,
      pending: 1,
    });
    expect(board.byModel['gemini-2.5-pro'].filed).toBe(5);
    expect(board.byModel['claude-sonnet-5']).toEqual({
      filed: 2,
      accepted: 1,
      declined: 1,
      pending: 0,
    });
    const cell = board.rows.find(
      (r) => r.sense === 'code_review' && r.model === 'gemini-2.5-pro',
    );
    expect(cell).toMatchObject({ filed: 5, accepted: 2, declined: 1 });
    expect(board.days).toBe(30);
  });
});

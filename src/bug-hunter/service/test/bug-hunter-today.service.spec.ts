import {
  BugHunterTodayService,
  dateIn,
  startOfDayIn,
} from '../bug-hunter-today.service';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../../enum/bug-hunt-run.enum';

describe('startOfDayIn', () => {
  it('finds local midnight in India for an instant that is still yesterday in UTC', () => {
    // 2026-10-07 02:30 IST is 2026-10-06 21:00 UTC; the Indian day started at 2026-10-06 18:30 UTC.
    const now = new Date('2026-10-06T21:00:00Z');
    expect(dateIn('Asia/Kolkata', now)).toBe('2026-10-07');
    expect(startOfDayIn('Asia/Kolkata', now).toISOString()).toBe(
      '2026-10-06T18:30:00.000Z',
    );
    expect(startOfDayIn('UTC', now).toISOString()).toBe(
      '2026-10-06T00:00:00.000Z',
    );
  });
});

describe('BugHunterTodayService', () => {
  const now = new Date('2026-10-07T04:00:00Z');
  const run = (over: Record<string, unknown>) => ({
    id: 'r',
    repo: 'ally-web',
    trigger: BugHuntTrigger.SCHEDULED,
    status: BugHuntRunStatus.COMPLETED,
    totalTokenCostUsd: '1.5000',
    metadata: {},
    createdAt: now,
    ...over,
  });
  const ev = (over: Record<string, unknown>) => ({
    id: 'e',
    repo: 'ally-web',
    stage: BugHuntEventStage.VERIFY,
    payload: {},
    findingId: 'f',
    createdAt: now,
    ...over,
  });

  it('folds runs, findings and events into one row per repo, with totals', async () => {
    const service = new BugHunterTodayService(
      {
        find: jest.fn().mockResolvedValue([
          run({}),
          run({ status: BugHuntRunStatus.FAILED }),
          run({
            repo: 'ally-be',
            status: BugHuntRunStatus.SKIPPED_QUIET,
            totalTokenCostUsd: '0',
          }),
          run({
            trigger: BugHuntTrigger.FIX_SESSION,
            status: BugHuntRunStatus.RUNNING,
            metadata: { cliReportedCostUsd: 2.25 },
            totalTokenCostUsd: '0.1',
          }),
          run({
            trigger: BugHuntTrigger.VERIFY_FIX,
            totalTokenCostUsd: '0.75',
          }),
        ]),
      } as never,
      {
        find: jest
          .fn()
          .mockResolvedValueOnce([
            { id: '1', repo: 'ally-web' },
            { id: '2', repo: 'ally-web' },
            { id: '3', repo: 'ally-be' },
          ])
          .mockResolvedValueOnce([{ id: '4', repo: 'ally-web' }]),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          ev({
            stage: BugHuntEventStage.SESSION_DISPATCHED,
            payload: { startedBy: 136 },
          }),
          ev({
            stage: BugHuntEventStage.SESSION_DISPATCHED,
            payload: { startedBy: 'verifier' },
          }),
          ev({ stage: BugHuntEventStage.STEP_STARTED, repo: 'ally-be' }),
          ev({
            payload: { kind: 'finding', verdict: { verdict: 'confirmed' } },
          }),
          ev({ payload: { kind: 'finding', verdict: { verdict: 'refuted' } } }),
          ev({ payload: { kind: 'fix', verdict: { verdict: 'pass' } } }),
          ev({ stage: BugHuntEventStage.MERGED }),
          ev({ stage: BugHuntEventStage.MERGED, findingId: null }), // the sweep's bare stage, not a merge
          ev({ stage: BugHuntEventStage.RELEASED, repo: 'ally-be' }),
        ]),
      } as never,
    );

    const board = await service.today('Asia/Kolkata', now);

    expect(board.date).toBe('2026-10-07');
    expect(board.since).toBe('2026-10-06T18:30:00.000Z');
    const web = board.repos.find((r) => r.repo === 'ally-web')!;
    expect(web).toMatchObject({
      sweeps: { completed: 1, failed: 1, skipped: 0, running: 0 },
      found: 2,
      verified: 1,
      refuted: 1,
      fixSessions: { byPerson: 1, byAgent: 1, running: 1, failed: 0 },
      fixesPassed: 1,
      fixesFailed: 0,
      prsOpen: 1,
      merged: 1,
      released: 0,
      spendUsd: 6, // 1.5 + 1.5 + 2.25 (CLI figure beats the estimate) + 0.75
    });
    const be = board.repos.find((r) => r.repo === 'ally-be')!;
    expect(be).toMatchObject({
      sweeps: { skipped: 1 },
      found: 1,
      fixSessions: { byAgent: 1 },
      released: 1,
    });
    expect(board.totals).toMatchObject({
      found: 3,
      merged: 1,
      released: 1,
      prsOpen: 1,
      spendUsd: 6,
    });
    // every configured repo has a row even on a quiet day
    expect(board.repos.map((r) => r.repo)).toEqual(
      expect.arrayContaining(['ally-ai', 'ally-ai-learn', 'ally-mobile']),
    );
  });
});

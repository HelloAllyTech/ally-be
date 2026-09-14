import { LoggerService } from 'src/logger/logger.service';

import { checkForAndRecordReversals } from '../check-for-reversals.util';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingRepository } from '../../repository/bug-finding.repository';
import { BugHunterService } from '../../service/bug-hunter.service';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';

const finding = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'shipping-1',
    repo: 'ally-be',
    dedupeKey: 'dedupe-1',
    status: BugFindingStatus.MERGED,
    releasedAt: null,
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    ...over,
  }) as BugFinding;

const dismissed = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'dismissed-1',
    decisionReason: 'duplicate',
    ...over,
  }) as BugFinding;

const findingRepository = (
  over: Partial<{
    findReversibleFinderErrors: jest.Mock;
    update: jest.Mock;
  }> = {},
) =>
  ({
    findReversibleFinderErrors: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    ...over,
  }) as unknown as BugFindingRepository;

const bugHunterService = (
  over: Partial<{ appendFindingEvent: jest.Mock }> = {},
) =>
  ({
    appendFindingEvent: jest.fn().mockResolvedValue(undefined),
    ...over,
  }) as unknown as BugHunterService;

const logger = { warn: jest.fn() } as unknown as LoggerService;

describe('checkForAndRecordReversals', () => {
  it('is a no-op for a status other than MERGED/RELEASED', async () => {
    const repo = findingRepository();
    await checkForAndRecordReversals(
      repo,
      bugHunterService(),
      finding({ status: BugFindingStatus.PR_OPENED }),
      logger,
    );
    expect(repo.findReversibleFinderErrors).not.toHaveBeenCalled();
  });

  it('is a no-op without a repo or dedupeKey', async () => {
    const repo = findingRepository();
    await checkForAndRecordReversals(
      repo,
      bugHunterService(),
      finding({ dedupeKey: null }),
      logger,
    );
    expect(repo.findReversibleFinderErrors).not.toHaveBeenCalled();
  });

  it('passes the shipping moment so the query can guard against retroactive reversal', async () => {
    const repo = findingRepository();
    const shippedFinding = finding({
      releasedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    await checkForAndRecordReversals(
      repo,
      bugHunterService(),
      shippedFinding,
      logger,
    );

    expect(repo.findReversibleFinderErrors).toHaveBeenCalledWith(
      'ally-be',
      'dedupe-1',
      'shipping-1',
      new Date('2026-02-01T00:00:00.000Z'),
    );
  });

  it('falls back to updatedAt for the shipping moment when releasedAt is unset (a MERGED-but-unreleased fix)', async () => {
    const repo = findingRepository();

    await checkForAndRecordReversals(
      repo,
      bugHunterService(),
      finding(),
      logger,
    );

    expect(repo.findReversibleFinderErrors).toHaveBeenCalledWith(
      'ally-be',
      'dedupe-1',
      'shipping-1',
      new Date('2026-01-15T00:00:00.000Z'),
    );
  });

  it('marks every reversible dismissal reversed and appends an event on its own timeline', async () => {
    const hits = [dismissed({ id: 'd1' }), dismissed({ id: 'd2' })];
    const repo = findingRepository({
      findReversibleFinderErrors: jest.fn().mockResolvedValue(hits),
    });
    const hunter = bugHunterService();

    await checkForAndRecordReversals(repo, hunter, finding(), logger);

    expect(repo.update).toHaveBeenCalledWith('d1', {
      reversedAt: expect.any(Date),
      reversedByFindingId: 'shipping-1',
    });
    expect(repo.update).toHaveBeenCalledWith('d2', {
      reversedAt: expect.any(Date),
      reversedByFindingId: 'shipping-1',
    });
    expect(hunter.appendFindingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: 'd1',
        stage: BugHuntEventStage.REVERSED,
        payload: expect.objectContaining({ reversedByFindingId: 'shipping-1' }),
      }),
    );
    expect(hunter.appendFindingEvent).toHaveBeenCalledTimes(2);
  });

  it('never throws — a failed reversal check must not undo the merge it piggybacks on', async () => {
    const repo = findingRepository({
      findReversibleFinderErrors: jest
        .fn()
        .mockRejectedValue(new Error('db blip')),
    });

    await expect(
      checkForAndRecordReversals(repo, bugHunterService(), finding(), logger),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

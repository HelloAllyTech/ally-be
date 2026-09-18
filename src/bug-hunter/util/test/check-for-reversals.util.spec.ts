import { LoggerService } from 'src/logger/logger.service';

import { checkForAndRecordReversals } from '../check-for-reversals.util';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingRepository } from '../../repository/bug-finding.repository';
import { BugHunterService } from '../../service/bug-hunter.service';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';

const SHIPPED_AT = new Date('2026-02-01T00:00:00.000Z');

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
      SHIPPED_AT,
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
      SHIPPED_AT,
    );
    expect(repo.findReversibleFinderErrors).not.toHaveBeenCalled();
  });

  it('passes the caller-supplied shipping moment through to the query', async () => {
    const repo = findingRepository();

    await checkForAndRecordReversals(
      repo,
      bugHunterService(),
      finding(),
      logger,
      SHIPPED_AT,
    );

    expect(repo.findReversibleFinderErrors).toHaveBeenCalledWith(
      'ally-be',
      'dedupe-1',
      'shipping-1',
      SHIPPED_AT,
    );
  });

  it('marks every reversible dismissal reversed in one bulk write and appends an event per finding', async () => {
    const hits = [dismissed({ id: 'd1' }), dismissed({ id: 'd2' })];
    const repo = findingRepository({
      findReversibleFinderErrors: jest.fn().mockResolvedValue(hits),
    });
    const hunter = bugHunterService();

    await checkForAndRecordReversals(
      repo,
      hunter,
      finding(),
      logger,
      SHIPPED_AT,
    );

    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(['d1', 'd2'], {
      reversedAt: expect.any(Date),
      reversedByFindingId: 'shipping-1',
    });
    expect(hunter.appendFindingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: 'd1',
        stage: BugHuntEventStage.REVERSED,
        summary: expect.stringContaining(
          'the original duplicate dismissal was mistaken — the finder was right',
        ),
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
      checkForAndRecordReversals(
        repo,
        bugHunterService(),
        finding(),
        logger,
        SHIPPED_AT,
      ),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('still marks the other dismissals reversed when one event append fails', async () => {
    const hits = [dismissed({ id: 'd1' }), dismissed({ id: 'd2' })];
    const repo = findingRepository({
      findReversibleFinderErrors: jest.fn().mockResolvedValue(hits),
    });
    const hunter = bugHunterService({
      appendFindingEvent: jest
        .fn()
        .mockRejectedValueOnce(new Error('events table rejected payload'))
        .mockResolvedValueOnce(undefined),
    });

    await checkForAndRecordReversals(
      repo,
      hunter,
      finding(),
      logger,
      SHIPPED_AT,
    );

    expect(repo.update).toHaveBeenCalledWith(['d1', 'd2'], {
      reversedAt: expect.any(Date),
      reversedByFindingId: 'shipping-1',
    });
    expect(hunter.appendFindingEvent).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
  });
});

import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollment } from '../../entity/track-enrollment.entity';
import { TrackItemProgress } from '../../entity/track-item-progress.entity';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackSection } from '../../entity/track-section.entity';
import { TrackItemType } from '../../type/track.type';
import { TrackProgressService } from '../track-progress.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

/**
 * Regression cover for the "minimum score 0 locks the learner out" bug: a
 * designer leaves the roleplay's Minimum score at its default 0, the learner
 * finishes the first simulation on a negative total score (an ordinary outcome
 * — event scores carry penalties and the score meter runs -100..100), and the
 * second simulation stayed LOCKED forever.
 */
describe('TrackProgressService.handleRoleplayEnd — minScore gate', () => {
  const SECTION_ID = 'sec-1';
  const FIRST_ITEM_ID = 'item-1';
  const SECOND_ITEM_ID = 'item-2';
  const FIRST_PROGRESS_ID = 'tip-1';
  const SECOND_PROGRESS_ID = 'tip-2';

  const trackItemProgressRepository = { findOne: jest.fn(), update: jest.fn() };
  const trackItemRepository = { findOne: jest.fn() };

  // Repos handed out inside the completeItem() transaction.
  const txProgressRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const txEnrollmentRepo = { findOne: jest.fn(), update: jest.fn() };
  const txItemRepo = { findOne: jest.fn(), find: jest.fn() };
  const txSectionRepo = { find: jest.fn() };

  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === TrackItemProgress) return txProgressRepo;
      if (entity === TrackEnrollment) return txEnrollmentRepo;
      if (entity === TrackItem) return txItemRepo;
      if (entity === TrackSection) return txSectionRepo;
      throw new Error('Unexpected entity requested in transaction');
    }),
  };

  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    getRepository: jest.fn(),
  };

  // No global minimum duration, so each test isolates the score gate.
  const configService = {
    simulationPath: { simulationPathItemMinDurationForCompletion: 0 },
  };

  const service = new TrackProgressService(
    dataSource as any,
    configService as any,
    { emit: jest.fn() } as any,
    trackItemProgressRepository as any,
    trackItemRepository as any,
  );

  const roleplayItem = (id: string, order: number, minScore?: number) => ({
    id,
    trackId: 'track-1',
    trackSectionId: SECTION_ID,
    order,
    type: TrackItemType.ROLEPLAY,
    completionCriteria: minScore === undefined ? {} : { minScore },
  });

  /**
   * Two-roleplay track. The learner is finishing the first item; the second is
   * still LOCKED.
   */
  const arrange = ({ minScore }: { minScore?: number }) => {
    const firstItem = roleplayItem(FIRST_ITEM_ID, 1, minScore);
    const secondItem = roleplayItem(SECOND_ITEM_ID, 2);
    const firstProgress = {
      id: FIRST_PROGRESS_ID,
      trackItemId: FIRST_ITEM_ID,
      trackEnrollmentId: 'enr-1',
      userId: 7,
      status: SessionItemStatus.UNLOCKED,
      attemptCount: 0,
      meta: {},
    };
    const secondProgress = {
      id: SECOND_PROGRESS_ID,
      trackItemId: SECOND_ITEM_ID,
      trackEnrollmentId: 'enr-1',
      userId: 7,
      status: SessionItemStatus.LOCKED,
      attemptCount: 0,
      meta: {},
    };

    trackItemProgressRepository.findOne.mockResolvedValue(firstProgress);
    trackItemRepository.findOne.mockResolvedValue(firstItem);

    txProgressRepo.findOne.mockResolvedValue(firstProgress);
    txProgressRepo.find.mockResolvedValue([firstProgress, secondProgress]);
    txEnrollmentRepo.findOne.mockResolvedValue({
      id: 'enr-1',
      userId: 7,
      tenantId: 'tenant-1',
      completedItems: 0,
    });
    txItemRepo.findOne.mockResolvedValue(firstItem);
    txItemRepo.find.mockResolvedValue([firstItem, secondItem]);
    txSectionRepo.find.mockResolvedValue([{ id: SECTION_ID, order: 1 }]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    dataSource.transaction.mockImplementation(
      (cb: (m: typeof manager) => unknown) => cb(manager),
    );
    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === TrackItemProgress) return txProgressRepo;
      if (entity === TrackEnrollment) return txEnrollmentRepo;
      if (entity === TrackItem) return txItemRepo;
      if (entity === TrackSection) return txSectionRepo;
      throw new Error('Unexpected entity requested in transaction');
    });
  });

  const endRoleplay = (score?: number) =>
    service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score,
      // 5 minutes — comfortably past any duration gate.
      callDuration: 300_000,
    });

  it('unlocks the next simulation when minScore is 0 and the score is negative', async () => {
    arrange({ minScore: 0 });

    const result = await endRoleplay(-25);

    expect(result.completed).toBe(true);
    expect(result.unlockedItemIds).toEqual([SECOND_ITEM_ID]);
    expect(txProgressRepo.update).toHaveBeenCalledWith(SECOND_PROGRESS_ID, {
      status: SessionItemStatus.UNLOCKED,
    });
  });

  it('unlocks the next simulation when minScore is 0 and the score is exactly 0', async () => {
    arrange({ minScore: 0 });

    const result = await endRoleplay(0);

    expect(result.completed).toBe(true);
    expect(result.unlockedItemIds).toEqual([SECOND_ITEM_ID]);
  });

  it('unlocks the next simulation when minScore is 0 and no score was produced', async () => {
    arrange({ minScore: 0 });

    const result = await endRoleplay(undefined);

    expect(result.completed).toBe(true);
    expect(result.unlockedItemIds).toEqual([SECOND_ITEM_ID]);
  });

  it('unlocks the next simulation when no minScore was configured at all', async () => {
    arrange({ minScore: undefined });

    const result = await endRoleplay(-25);

    expect(result.completed).toBe(true);
    expect(result.unlockedItemIds).toEqual([SECOND_ITEM_ID]);
  });

  it('still blocks a score below an explicitly configured non-zero minScore', async () => {
    arrange({ minScore: 70 });

    const result = await endRoleplay(50);

    expect(result.completed).toBe(false);
    expect(result.unlockedItemIds).toEqual([]);
    // The item stays as it was, so the learner can retry.
    expect(txProgressRepo.update).not.toHaveBeenCalled();
  });

  it('unlocks once the learner reaches an explicitly configured non-zero minScore', async () => {
    arrange({ minScore: 70 });

    const result = await endRoleplay(70);

    expect(result.completed).toBe(true);
    expect(result.unlockedItemIds).toEqual([SECOND_ITEM_ID]);
  });

  it('still blocks a non-zero minScore when the session produced no score', async () => {
    arrange({ minScore: 70 });

    const result = await endRoleplay(undefined);

    expect(result.completed).toBe(false);
    expect(result.unlockedItemIds).toEqual([]);
  });

  it('still enforces the minimum duration gate independently of minScore 0', async () => {
    arrange({ minScore: 0 });
    trackItemRepository.findOne.mockResolvedValue({
      ...roleplayItem(FIRST_ITEM_ID, 1, 0),
      completionCriteria: { minScore: 0, minDurationSeconds: 180 },
    });

    const result = await service.handleRoleplayEnd({
      trackItemProgressId: FIRST_PROGRESS_ID,
      score: 90,
      callDuration: 30_000, // 30s, short of the 180s rule
    });

    expect(result.completed).toBe(false);
    expect(result.unlockedItemIds).toEqual([]);
  });
});

import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollmentService } from '../track-enrollment.service';
import { TrackItemType } from '../../type/track.type';
import { TrackGameKey } from '../../type/game.type';

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

describe('TrackEnrollmentService — Breathing Exercise', () => {
  const ITEM_ID = 'item-1';
  const PROGRESS_ID = 'progress-1';

  const trackItemProgressRepository = { update: jest.fn() };
  const trackProgressService = { completeItem: jest.fn() };

  const service = new TrackEnrollmentService(
    {} as any, // dataSource
    {} as any, // trackRepository
    {} as any, // trackTenantRepository
    {} as any, // trackEnrollmentRepository
    trackItemProgressRepository as any,
    {} as any, // trackJournalEntryRepository
    {} as any, // trackQuizAttemptRepository
    {} as any, // trackAnnotationAttemptRepository
    {} as any, // trackSharedService
    trackProgressService as any,
    {} as any, // caseSessionService
    {} as any, // scenarioSharedService
    {} as any, // trackLocalizationService
    {} as any, // cohortVisibilityService
  );

  const breathingExerciseItem = {
    id: ITEM_ID,
    type: TrackItemType.GAME,
    content: {
      gameKey: TrackGameKey.BREATHING_EXERCISE,
      breathingExercise: {
        inhale: 4,
        holdIn: 4,
        exhale: 4,
        holdOut: 4,
        cycles: 4,
        inhaleText: 'Inhale',
        holdInText: 'Hold',
        exhaleText: 'Exhale',
        holdOutText: 'Hold',
      },
    },
  };

  const stubPermittedItemProgress = (item: unknown, progress: unknown) => {
    jest.spyOn(service, 'getPermittedItemProgress').mockResolvedValue({
      item: item as any,
      sourceItem: item as any,
      progress: progress as any,
      enrollment: { id: 'enr-1' } as any,
      languageCode: null,
    });
  };

  const mockTouchEnrollment = () => {
    // touchEnrollment is private, but it's called by startItem.
    // It updates the trackEnrollmentRepository.
    (service as any).trackEnrollmentRepository.update = jest.fn();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTouchEnrollment();
    trackProgressService.completeItem.mockResolvedValue({
      completed: true,
      unlockedItemIds: ['item-2'],
      sectionCompleted: false,
      trackCompleted: false,
    });
  });

  it('R2 — marks the breathing exercise as complete as soon as it is opened (started)', async () => {
    stubPermittedItemProgress(breathingExerciseItem, {
      id: PROGRESS_ID,
      trackEnrollmentId: 'enr-1',
      status: SessionItemStatus.UNLOCKED,
    });

    const result: any = await service.startItem(ITEM_ID);

    expect(trackProgressService.completeItem).toHaveBeenCalledWith(
      PROGRESS_ID,
      {},
    );
    expect(result.completion).toMatchObject({ completed: true });
    expect(result.gameKey).toBe(TrackGameKey.BREATHING_EXERCISE);
  });

  it('sends the breathing exercise configuration to the client', async () => {
    stubPermittedItemProgress(breathingExerciseItem, {
      id: PROGRESS_ID,
      trackEnrollmentId: 'enr-1',
      status: SessionItemStatus.UNLOCKED,
    });

    const result: any = await service.startItem(ITEM_ID);

    expect(result.breathingExercise).toEqual(
      breathingExerciseItem.content.breathingExercise,
    );
  });

  it('does not add a breathingExercise key to other games', async () => {
    stubPermittedItemProgress(
      {
        id: ITEM_ID,
        type: TrackItemType.GAME,
        content: { gameKey: TrackGameKey.SNAKE },
      },
      {
        id: PROGRESS_ID,
        trackEnrollmentId: 'enr-1',
        status: SessionItemStatus.UNLOCKED,
      },
    );

    const result: any = await service.startItem(ITEM_ID);

    expect(result).not.toHaveProperty('breathingExercise');
  });
});

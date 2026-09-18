import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TrackEnrollmentService } from '../track-enrollment.service';
import {
  TrackItemType,
  VideoContent,
  VideoSource,
} from '../../type/track.type';
import { McqSingleQuestion, QuizQuestionType } from '../../type/quiz.type';

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
 * Scoped to `submitInterjectionAnswer` only — not a full-coverage suite for
 * TrackEnrollmentService (see `getPermittedItemProgress`'s many other
 * callers). `getPermittedItemProgress` is a public method on the service, so
 * it is stubbed directly via `jest.spyOn` rather than reconstructing the
 * dataSource/repository chain it normally runs through; every other
 * constructor dependency is an inert `{}` since this method never touches
 * them.
 */
describe('TrackEnrollmentService.submitInterjectionAnswer', () => {
  const ITEM_ID = 'item-1';
  const INTERJECTION_ID = 'int-1';
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

  const mcqQuestion: McqSingleQuestion = {
    id: 'q1',
    type: QuizQuestionType.MCQ_SINGLE,
    prompt: 'Pick the right one',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctOptionIds: ['a'],
  };

  const videoContent: VideoContent = {
    source: VideoSource.S3,
    url: 'https://example.com/video.mp4',
    interjections: [
      { id: INTERJECTION_ID, timestampSeconds: 10, question: mcqQuestion },
    ],
  };

  const videoItem = {
    id: ITEM_ID,
    type: TrackItemType.VIDEO,
    content: videoContent,
  };

  /** Pre-existing progress meta the update must merge into, not clobber. */
  const baseProgress = {
    id: PROGRESS_ID,
    meta: { maxWatchedPct: 42 },
  };

  const stubPermittedItemProgress = (
    item: unknown,
    progress: unknown = baseProgress,
  ) => {
    jest.spyOn(service, 'getPermittedItemProgress').mockResolvedValue({
      item: item as any,
      sourceItem: item as any,
      progress: progress as any,
      enrollment: {} as any,
      languageCode: null,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('grades a correct answer, returns correct: true and merges the result into meta without clobbering other keys', async () => {
    stubPermittedItemProgress(videoItem);

    const result = await service.submitInterjectionAnswer(
      ITEM_ID,
      INTERJECTION_ID,
      { questionId: 'q1', selectedOptionIds: ['a'] },
    );

    expect(result.correct).toBe(true);
    expect(result.grading).toMatchObject({
      questionId: 'q1',
      correct: true,
      pointsAwarded: 1,
    });
    expect(trackItemProgressRepository.update).toHaveBeenCalledWith(
      PROGRESS_ID,
      {
        meta: {
          maxWatchedPct: 42,
          answeredInterjections: {
            [INTERJECTION_ID]: { passed: true, pointsAwarded: 1 },
          },
        },
      },
    );
    // Interjections only gate playback; they never complete the item.
    expect(trackProgressService.completeItem).not.toHaveBeenCalled();
  });

  it('grades an incorrect answer, returns correct: false and persists passed: false', async () => {
    stubPermittedItemProgress(videoItem);

    const result = await service.submitInterjectionAnswer(
      ITEM_ID,
      INTERJECTION_ID,
      { questionId: 'q1', selectedOptionIds: ['b'] },
    );

    expect(result.correct).toBe(false);
    expect(trackItemProgressRepository.update).toHaveBeenCalledWith(
      PROGRESS_ID,
      {
        meta: {
          maxWatchedPct: 42,
          answeredInterjections: {
            [INTERJECTION_ID]: { passed: false, pointsAwarded: 0 },
          },
        },
      },
    );
    expect(trackProgressService.completeItem).not.toHaveBeenCalled();
  });

  it('merges into existing answeredInterjections rather than replacing them', async () => {
    stubPermittedItemProgress(videoItem, {
      id: PROGRESS_ID,
      meta: {
        maxWatchedPct: 42,
        answeredInterjections: {
          'other-int': { passed: true, pointsAwarded: 1 },
        },
      },
    });

    await service.submitInterjectionAnswer(ITEM_ID, INTERJECTION_ID, {
      questionId: 'q1',
      selectedOptionIds: ['a'],
    });

    expect(trackItemProgressRepository.update).toHaveBeenCalledWith(
      PROGRESS_ID,
      {
        meta: {
          maxWatchedPct: 42,
          answeredInterjections: {
            'other-int': { passed: true, pointsAwarded: 1 },
            [INTERJECTION_ID]: { passed: true, pointsAwarded: 1 },
          },
        },
      },
    );
  });

  it('throws BadRequestException when the item is not a video', async () => {
    stubPermittedItemProgress({
      id: ITEM_ID,
      type: TrackItemType.ARTICLE,
      content: {},
    });

    await expect(
      service.submitInterjectionAnswer(ITEM_ID, INTERJECTION_ID, {
        questionId: 'q1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(trackItemProgressRepository.update).not.toHaveBeenCalled();
    expect(trackProgressService.completeItem).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the interjectionId does not match any interjection on the item', async () => {
    stubPermittedItemProgress(videoItem);

    await expect(
      service.submitInterjectionAnswer(ITEM_ID, 'does-not-exist', {
        questionId: 'q1',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(trackItemProgressRepository.update).not.toHaveBeenCalled();
    expect(trackProgressService.completeItem).not.toHaveBeenCalled();
  });
});

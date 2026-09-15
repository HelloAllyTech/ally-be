import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollmentService } from '../track-enrollment.service';
import { ArticleContent, TrackItemType } from '../../type/track.type';
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
 * Scoped to the inline-article-question path — `submitArticleQuestionAnswer`
 * and the gate it puts in front of `markArticleRead`. Follows the same
 * stubbing shape as the interjection suite: `getPermittedItemProgress` is
 * spied on directly rather than reconstructing the repository chain, and
 * every dependency this path never touches is an inert `{}`.
 */
describe('TrackEnrollmentService — inline article questions', () => {
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

  const question = (id: string, correct: string): McqSingleQuestion => ({
    id,
    type: QuizQuestionType.MCQ_SINGLE,
    prompt: `Prompt ${id}`,
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctOptionIds: [correct],
  });

  const marker = (id: string) => `<div data-ally-question="${id}"></div>`;

  const articleWith = (questions: McqSingleQuestion[]): ArticleContent => ({
    html: `<p>Intro</p>${questions.map((q) => marker(q.id)).join('<p>More</p>')}`,
    questions,
  });

  const articleItem = (
    questions: McqSingleQuestion[],
    completionCriteria?: { minReadSeconds?: number },
  ) => ({
    id: ITEM_ID,
    type: TrackItemType.ARTICLE,
    content: articleWith(questions),
    completionCriteria,
  });

  const stubPermittedItemProgress = (item: unknown, progress: unknown) => {
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
    trackProgressService.completeItem.mockResolvedValue({
      completed: true,
      unlockedItemIds: ['item-2'],
      sectionCompleted: false,
      trackCompleted: false,
    });
  });

  describe('submitArticleQuestionAnswer', () => {
    it('grades a correct answer and records it without clobbering other meta', async () => {
      stubPermittedItemProgress(articleItem([question('q1', 'a')]), {
        id: PROGRESS_ID,
        status: SessionItemStatus.UNLOCKED,
        meta: { articleFirstOpenedAt: '2026-09-15T10:00:00.000Z' },
      });

      const result = await service.submitArticleQuestionAnswer(
        ITEM_ID,
        'q1',
        'a',
      );

      expect(result.correct).toBe(true);
      expect(result.correctOptionId).toBe('a');
      expect(result.answeredQuestionCount).toBe(1);
      expect(result.totalQuestionCount).toBe(1);

      const [, patch] = trackItemProgressRepository.update.mock.calls[0];
      expect(patch.meta.articleFirstOpenedAt).toBe('2026-09-15T10:00:00.000Z');
      expect(patch.meta.answeredArticleQuestions.q1).toMatchObject({
        selectedOptionId: 'a',
        correct: true,
      });
    });

    it('returns the correct option even when the learner was wrong, so the reader can be shown it', async () => {
      stubPermittedItemProgress(articleItem([question('q1', 'a')]), {
        id: PROGRESS_ID,
        status: SessionItemStatus.UNLOCKED,
        meta: {},
      });

      const result = await service.submitArticleQuestionAnswer(
        ITEM_ID,
        'q1',
        'b',
      );

      expect(result.correct).toBe(false);
      expect(result.selectedOptionId).toBe('b');
      expect(result.correctOptionId).toBe('a');
    });

    it('completes the article when the last unanswered question is answered', async () => {
      stubPermittedItemProgress(
        articleItem([question('q1', 'a'), question('q2', 'b')]),
        {
          id: PROGRESS_ID,
          status: SessionItemStatus.UNLOCKED,
          meta: {
            answeredArticleQuestions: {
              q1: {
                selectedOptionId: 'a',
                correct: true,
                answeredAt: '2026-09-15T10:00:00.000Z',
              },
            },
          },
        },
      );

      const result = await service.submitArticleQuestionAnswer(
        ITEM_ID,
        'q2',
        'b',
      );

      expect(trackProgressService.completeItem).toHaveBeenCalledWith(
        PROGRESS_ID,
        expect.objectContaining({
          meta: expect.objectContaining({
            articleReadAt: expect.any(String),
          }),
        }),
      );
      expect(result.completion).toMatchObject({ completed: true });
    });

    it('does not complete while questions remain unanswered', async () => {
      stubPermittedItemProgress(
        articleItem([question('q1', 'a'), question('q2', 'b')]),
        { id: PROGRESS_ID, status: SessionItemStatus.UNLOCKED, meta: {} },
      );

      const result = await service.submitArticleQuestionAnswer(
        ITEM_ID,
        'q1',
        'a',
      );

      expect(trackProgressService.completeItem).not.toHaveBeenCalled();
      expect(result.completion).toBeNull();
      expect(result.answeredQuestionCount).toBe(1);
      expect(result.totalQuestionCount).toBe(2);
    });

    it('does not complete when the minReadSeconds dwell rule has not been met yet', async () => {
      stubPermittedItemProgress(
        articleItem([question('q1', 'a')], { minReadSeconds: 120 }),
        {
          id: PROGRESS_ID,
          status: SessionItemStatus.UNLOCKED,
          meta: { articleFirstOpenedAt: new Date().toISOString() },
        },
      );

      const result = await service.submitArticleQuestionAnswer(
        ITEM_ID,
        'q1',
        'a',
      );

      expect(trackProgressService.completeItem).not.toHaveBeenCalled();
      expect(result.completion).toBeNull();
    });

    it('refuses a second answer to a question that is already spent', async () => {
      stubPermittedItemProgress(articleItem([question('q1', 'a')]), {
        id: PROGRESS_ID,
        status: SessionItemStatus.UNLOCKED,
        meta: {
          answeredArticleQuestions: {
            q1: {
              selectedOptionId: 'b',
              correct: false,
              answeredAt: '2026-09-15T10:00:00.000Z',
            },
          },
        },
      });

      await expect(
        service.submitArticleQuestionAnswer(ITEM_ID, 'q1', 'a'),
      ).rejects.toThrow(BadRequestException);
      expect(trackItemProgressRepository.update).not.toHaveBeenCalled();
    });

    it('refuses an option that does not belong to the question', async () => {
      stubPermittedItemProgress(articleItem([question('q1', 'a')]), {
        id: PROGRESS_ID,
        status: SessionItemStatus.UNLOCKED,
        meta: {},
      });

      await expect(
        service.submitArticleQuestionAnswer(ITEM_ID, 'q1', 'not-an-option'),
      ).rejects.toThrow(BadRequestException);
      expect(trackItemProgressRepository.update).not.toHaveBeenCalled();
    });

    it('404s an unknown question id', async () => {
      stubPermittedItemProgress(articleItem([question('q1', 'a')]), {
        id: PROGRESS_ID,
        status: SessionItemStatus.UNLOCKED,
        meta: {},
      });

      await expect(
        service.submitArticleQuestionAnswer(ITEM_ID, 'nope', 'a'),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * Knowledge of the correct response tells the learner *which* answer was
     * right; the author's line tells them why the one they picked was wrong,
     * which is the half that teaches. It rides back with the verdict.
     */
    it("returns the author's explanation with the verdict", async () => {
      const q1 = question('q1', 'a');
      q1.explanation = 'B is the tempting one because it sounds active.';
      stubPermittedItemProgress(articleItem([q1]), {
        id: PROGRESS_ID,
        status: SessionItemStatus.UNLOCKED,
        meta: {},
      });

      const result = await service.submitArticleQuestionAnswer(
        ITEM_ID,
        'q1',
        'b',
      );

      expect(result.explanation).toBe(
        'B is the tempting one because it sounds active.',
      );
    });

    it('returns a null explanation when the author wrote none', async () => {
      stubPermittedItemProgress(articleItem([question('q1', 'a')]), {
        id: PROGRESS_ID,
        status: SessionItemStatus.UNLOCKED,
        meta: {},
      });

      const result = await service.submitArticleQuestionAnswer(
        ITEM_ID,
        'q1',
        'a',
      );

      expect(result.explanation).toBeNull();
    });

    it('400s when the component is not an article', async () => {
      stubPermittedItemProgress(
        { id: ITEM_ID, type: TrackItemType.VIDEO, content: {} },
        { id: PROGRESS_ID, meta: {} },
      );

      await expect(
        service.submitArticleQuestionAnswer(ITEM_ID, 'q1', 'a'),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * A translated body whose placeholder did not survive the translator must
     * lose the question, not strand the learner behind a question that never
     * renders.
     */
    it('ignores a question whose placeholder is missing from the served HTML', async () => {
      const q1 = question('q1', 'a');
      const q2 = question('q2', 'b');
      stubPermittedItemProgress(
        {
          id: ITEM_ID,
          type: TrackItemType.ARTICLE,
          // Only q1 is anchored; q2's placeholder was lost.
          content: { html: `<p>Hi</p>${marker('q1')}`, questions: [q1, q2] },
        },
        { id: PROGRESS_ID, status: SessionItemStatus.UNLOCKED, meta: {} },
      );

      const result = await service.submitArticleQuestionAnswer(
        ITEM_ID,
        'q1',
        'a',
      );

      expect(result.totalQuestionCount).toBe(1);
      expect(trackProgressService.completeItem).toHaveBeenCalled();

      await expect(
        service.submitArticleQuestionAnswer(ITEM_ID, 'q2', 'b'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('markArticleRead', () => {
    it('refuses to complete an article that still has unanswered questions', async () => {
      stubPermittedItemProgress(
        articleItem([question('q1', 'a'), question('q2', 'b')]),
        { id: PROGRESS_ID, status: SessionItemStatus.UNLOCKED, meta: {} },
      );

      await expect(service.markArticleRead(ITEM_ID)).rejects.toThrow(
        /Answer the 2 questions/,
      );
      expect(trackProgressService.completeItem).not.toHaveBeenCalled();
    });

    it('completes once every question has been answered', async () => {
      stubPermittedItemProgress(articleItem([question('q1', 'a')]), {
        id: PROGRESS_ID,
        status: SessionItemStatus.UNLOCKED,
        meta: {
          answeredArticleQuestions: {
            q1: {
              selectedOptionId: 'a',
              correct: true,
              answeredAt: '2026-09-15T10:00:00.000Z',
            },
          },
        },
      });

      await service.markArticleRead(ITEM_ID);

      expect(trackProgressService.completeItem).toHaveBeenCalled();
    });

    it('is unchanged for an article with no questions', async () => {
      stubPermittedItemProgress(
        {
          id: ITEM_ID,
          type: TrackItemType.ARTICLE,
          content: { html: '<p>x</p>' },
        },
        { id: PROGRESS_ID, status: SessionItemStatus.UNLOCKED, meta: {} },
      );

      await service.markArticleRead(ITEM_ID);

      expect(trackProgressService.completeItem).toHaveBeenCalled();
    });
  });
});

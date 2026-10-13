import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { TrackEnrollmentService } from '../track-enrollment.service';
import {
  TrackAccessDenialReason,
  TrackItemType,
  TrackStatus,
} from '../../type/track.type';
import { QuizQuestionType } from '../../type/quiz.type';

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
 * The shared course link: the public outline (no login) and the access check
 * the landing page runs right after login. Also pins that `enroll` still
 * throws the same exceptions now that its access rules live in
 * `findAccessDenial`.
 */
describe('TrackEnrollmentService — shared course link', () => {
  const TRACK_ID = '7b0c3c52-2f7a-4c2a-9a55-0e4d6f1d2a11';
  const TENANT_ID = 'tenant-1';
  const USER_ID = 42;

  const trackRepository = { findOne: jest.fn() };
  const trackTenantRepository = { findOne: jest.fn() };
  const trackEnrollmentRepository = { findByTrackAndUser: jest.fn() };
  const trackSharedService = { getTrackWithStructure: jest.fn() };
  const cohortVisibilityService = { canAccess: jest.fn() };
  const trackLocalizationService = {
    resolveLearnerLanguage: jest.fn().mockResolvedValue('en'),
    resolvePublished: jest.fn().mockResolvedValue(null),
    localizeTrack: jest.fn((track) => track),
    localizeSection: jest.fn((section) => section),
    localizeItem: jest.fn((item) => item),
  };

  const service = new TrackEnrollmentService(
    {} as any, // dataSource
    trackRepository as any,
    trackTenantRepository as any,
    trackEnrollmentRepository as any,
    {} as any, // trackItemProgressRepository
    {} as any, // trackJournalEntryRepository
    {} as any, // trackQuizAttemptRepository
    {} as any, // trackAnnotationAttemptRepository
    trackSharedService as any,
    {} as any, // trackProgressService
    {} as any, // caseSessionService
    {} as any, // scenarioSharedService
    trackLocalizationService as any,
    cohortVisibilityService as any,
  );

  const quizItem = {
    id: 'item-quiz',
    type: TrackItemType.QUIZ,
    order: 1,
    title: 'Check your understanding',
    description: 'Five questions',
    scenarioId: null,
    caseId: 'case-internal',
    content: {
      questions: [
        {
          id: 'q1',
          type: QuizQuestionType.MCQ_SINGLE,
          prompt: 'Secret prompt',
          options: [{ id: 'a', text: 'A' }],
          correctOptionIds: ['a'],
        },
      ],
      settings: { passScore: 80 },
    },
  };
  const roleplayItem = {
    id: 'item-roleplay',
    type: TrackItemType.ROLEPLAY,
    order: 0,
    title: 'Practise opening the call',
    description: null,
    scenarioId: 17,
    caseId: null,
    content: null,
  };

  const structure = (overrides: Record<string, unknown> = {}) => ({
    id: TRACK_ID,
    title: 'Active listening',
    description: '<p>Learn to listen</p>',
    coverImageUrl: 'https://example.com/cover.png',
    status: TrackStatus.ACTIVE,
    isPublicView: true,
    totalItems: 2,
    estimatedDurationMinutes: 30,
    sections: [
      {
        id: 'section-1',
        title: 'Basics',
        description: null,
        order: 0,
        items: [roleplayItem, quizItem],
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(ExecutionManager, 'getUserId')
      .mockReturnValue(String(USER_ID) as any);
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(TENANT_ID);
    trackEnrollmentRepository.findByTrackAndUser.mockResolvedValue(null);
    trackTenantRepository.findOne.mockResolvedValue({ id: 'mapping' });
    cohortVisibilityService.canAccess.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getPublicTrackOutline', () => {
    it('returns the outline of a published course with public view on', async () => {
      trackSharedService.getTrackWithStructure.mockResolvedValue(structure());

      const outline = await service.getPublicTrackOutline(TRACK_ID, 'en');

      expect(outline).toMatchObject({
        id: TRACK_ID,
        title: 'Active listening',
        totalItems: 2,
        simulationsCount: 1,
        estimatedDurationMinutes: 30,
        languageCode: 'en',
      });
      expect(outline.sections[0].items.map((item) => item.id)).toEqual([
        'item-roleplay',
        'item-quiz',
      ]);
      expect(outline.sections[0].items[1].contentMeta).toEqual({
        questionCount: 1,
        passScore: 80,
      });
    });

    it('never exposes content, answer keys, progress or internal ids', async () => {
      trackSharedService.getTrackWithStructure.mockResolvedValue(structure());

      const outline = await service.getPublicTrackOutline(TRACK_ID);
      const serialised = JSON.stringify(outline);

      expect(serialised).not.toContain('Secret prompt');
      expect(serialised).not.toContain('correctOptionIds');
      expect(serialised).not.toContain('case-internal');
      for (const item of outline.sections[0].items) {
        expect(Object.keys(item).sort()).toEqual([
          'contentMeta',
          'description',
          'id',
          'order',
          'title',
          'type',
        ]);
      }
    });

    it.each([
      ['public view is off', { isPublicView: false }],
      ['the course is a draft', { status: TrackStatus.DRAFT }],
      ['the course is archived', { status: TrackStatus.ARCHIVED }],
    ])('404s when %s', async (_label, overrides) => {
      trackSharedService.getTrackWithStructure.mockResolvedValue(
        structure(overrides),
      );

      await expect(service.getPublicTrackOutline(TRACK_ID)).rejects.toThrow(
        new NotFoundException('This course is not available'),
      );
    });

    it('404s with the same message when the course does not exist', async () => {
      trackSharedService.getTrackWithStructure.mockRejectedValue(
        new NotFoundException('Track not found'),
      );

      await expect(service.getPublicTrackOutline(TRACK_ID)).rejects.toThrow(
        new NotFoundException('This course is not available'),
      );
    });

    it('needs no signed-in user', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);
      trackSharedService.getTrackWithStructure.mockResolvedValue(structure());

      await expect(
        service.getPublicTrackOutline(TRACK_ID),
      ).resolves.toMatchObject({ id: TRACK_ID });
    });
  });

  describe('getTrackAccess', () => {
    const publishedTrack = { id: TRACK_ID, status: TrackStatus.ACTIVE };

    it('grants access to a published course assigned to the org and group', async () => {
      trackRepository.findOne.mockResolvedValue(publishedTrack);

      await expect(service.getTrackAccess(TRACK_ID)).resolves.toEqual({
        hasAccess: true,
        enrolled: false,
        reason: null,
      });
      expect(cohortVisibilityService.canAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          contentId: TRACK_ID,
          tenantId: TENANT_ID,
          userId: USER_ID,
          alreadyStarted: false,
        }),
      );
    });

    it('does not depend on public view — the toggle shows the outline, it never grants access', async () => {
      trackRepository.findOne.mockResolvedValue({
        ...publishedTrack,
        isPublicView: true,
      });
      trackTenantRepository.findOne.mockResolvedValue(null);

      await expect(service.getTrackAccess(TRACK_ID)).resolves.toEqual({
        hasAccess: false,
        enrolled: false,
        reason: TrackAccessDenialReason.NOT_IN_ORGANIZATION,
      });
    });

    it('denies a learner whose group the course is restricted away from', async () => {
      trackRepository.findOne.mockResolvedValue(publishedTrack);
      cohortVisibilityService.canAccess.mockResolvedValue(false);

      await expect(service.getTrackAccess(TRACK_ID)).resolves.toMatchObject({
        hasAccess: false,
        reason: TrackAccessDenialReason.NOT_IN_GROUP,
      });
    });

    it('denies an account with no organisation instead of throwing', async () => {
      trackRepository.findOne.mockResolvedValue(publishedTrack);
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.getTrackAccess(TRACK_ID)).resolves.toMatchObject({
        hasAccess: false,
        reason: TrackAccessDenialReason.NO_ORGANIZATION,
      });
    });

    it.each([
      ['does not exist', null],
      ['is a draft', { id: TRACK_ID, status: TrackStatus.DRAFT }],
      ['is archived', { id: TRACK_ID, status: TrackStatus.ARCHIVED }],
    ])('reports NOT_AVAILABLE when the course %s', async (_label, track) => {
      trackRepository.findOne.mockResolvedValue(track);

      await expect(service.getTrackAccess(TRACK_ID)).resolves.toMatchObject({
        hasAccess: false,
        reason: TrackAccessDenialReason.NOT_AVAILABLE,
      });
    });

    it('keeps access for an enrolled learner, even on an archived course', async () => {
      trackRepository.findOne.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.ARCHIVED,
      });
      trackEnrollmentRepository.findByTrackAndUser.mockResolvedValue({
        id: 'enrollment-1',
      });
      trackTenantRepository.findOne.mockResolvedValue(null);

      await expect(service.getTrackAccess(TRACK_ID)).resolves.toEqual({
        hasAccess: true,
        enrolled: true,
        reason: null,
      });
    });
  });

  describe('enroll — access exceptions unchanged', () => {
    beforeEach(() => {
      trackSharedService.getTrackWithStructure.mockResolvedValue(
        structure({ isPublicView: false }),
      );
    });

    it('403s when the course is not assigned to the organisation', async () => {
      trackTenantRepository.findOne.mockResolvedValue(null);

      await expect(service.enroll(TRACK_ID)).rejects.toThrow(
        new ForbiddenException(
          'This track is not available for your organization',
        ),
      );
    });

    it('403s when the course is restricted away from the group', async () => {
      cohortVisibilityService.canAccess.mockResolvedValue(false);

      await expect(service.enroll(TRACK_ID)).rejects.toThrow(
        new ForbiddenException('This course is not available for your group'),
      );
    });

    it('401s when the account has no organisation', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.enroll(TRACK_ID)).rejects.toThrow(
        new UnauthorizedException('Tenant not found'),
      );
    });
  });
});

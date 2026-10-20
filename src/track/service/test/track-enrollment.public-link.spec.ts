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
import { StoryBeat } from '../../type/track-landing-page.type';

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

  const dataSource = { query: jest.fn() };
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
    dataSource as any,
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
    dataSource.query.mockResolvedValue([]);
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

    describe('story', () => {
      const landingPage = {
        version: 1,
        hero: {
          hook: 'Meera’s message arrives at 2am.',
          question: 'Will you know what to say?',
          courseLine: null,
          buttonLabel: null,
        },
        persona: {
          name: 'Meera, 19',
          descriptor: null,
          imageUrl: null,
          characterId: 'character-internal',
        },
        arc: {
          enabled: true,
          chapters: [
            {
              sectionId: 'section-1',
              beat: 'SETUP',
              teaser: 'It starts quietly.',
            },
            { sectionId: 'section-gone', beat: 'CLIMAX', teaser: 'Deleted.' },
          ],
          hardCallSectionId: 'section-1',
        },
        xp: { enabled: true },
      };

      it('is null for a course with no landing page, and runs no extra query', async () => {
        trackSharedService.getTrackWithStructure.mockResolvedValue(structure());

        const outline = await service.getPublicTrackOutline(TRACK_ID);

        expect(outline.story).toBeNull();
        expect(dataSource.query).not.toHaveBeenCalled();
      });

      it('is null when the landing page has no hook (classic layout), without querying', async () => {
        trackSharedService.getTrackWithStructure.mockResolvedValue(
          structure({
            landingPage: { ...landingPage, hero: { hook: '   ' } },
          }),
        );

        const outline = await service.getPublicTrackOutline(TRACK_ID);

        expect(outline.story).toBeNull();
        expect(dataSource.query).not.toHaveBeenCalled();
      });

      it('applies the display rules: arc from the live sections, stale ids ignored', async () => {
        trackSharedService.getTrackWithStructure.mockResolvedValue(
          structure({ landingPage }),
        );

        const { story } = await service.getPublicTrackOutline(TRACK_ID);

        expect(story).toMatchObject({
          hook: 'Meera’s message arrives at 2am.',
          question: 'Will you know what to say?',
          persona: { name: 'Meera, 19', descriptor: null, imageUrl: null },
          firstMove: null,
          outcomes: null,
          arc: {
            chapters: [
              {
                sectionId: 'section-1',
                beat: StoryBeat.SETUP,
                teaser: 'It starts quietly.',
              },
            ],
            hardCallSectionId: 'section-1',
          },
          // quiz 30 + roleplay (0 + 10 completion award)
          xp: { activityXp: 40, hasRoleplays: true },
          contentNotes: null,
        });
        expect(JSON.stringify(story)).not.toContain('section-gone');
        expect(JSON.stringify(story)).not.toContain('character-internal');
      });

      it('groups trigger warnings by section with one query, localised for the resolved language', async () => {
        trackLocalizationService.resolveLearnerLanguage.mockResolvedValueOnce(
          'hi',
        );
        trackSharedService.getTrackWithStructure.mockResolvedValue(
          structure({ landingPage }),
        );
        dataSource.query.mockResolvedValue([
          {
            sectionId: 'section-1',
            name: 'Suicide',
            translations: { hi: { name: 'आत्महत्या' } },
          },
          { sectionId: 'section-1', name: 'Grief', translations: null },
        ]);

        const { story } = await service.getPublicTrackOutline(TRACK_ID, 'hi');

        expect(dataSource.query).toHaveBeenCalledTimes(1);
        expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
          TRACK_ID,
        ]);
        expect(story?.contentNotes).toEqual({
          warnings: [
            { name: 'Grief', chapters: [1] },
            { name: 'आत्महत्या', chapters: [1] },
          ],
          extraNote: null,
        });
      });

      it('reads the CASE items’ scenarios too, through case_items', async () => {
        trackSharedService.getTrackWithStructure.mockResolvedValue(
          structure({ landingPage }),
        );

        await service.getPublicTrackOutline(TRACK_ID);

        const sql = dataSource.query.mock.calls[0][0] as string;
        expect(sql).toContain('"case_items"');
        expect(sql).toContain('"scenario_trigger_warnings"');
        expect(sql).toContain('"trigger_warnings"');
      });
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

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { ScenarioSessionReviewService } from '../review.service';
import { ReadFilter } from 'src/review/type/review.type';
import { ScenarioSessionReviewRepository } from '../../repository/review.repository';
import { ScenarioSessionReviewThreadRepository } from '../../repository/thread.repository';
import { ScenarioSessionReviewReactionRepository } from '../../repository/reaction.repository';
import { ScenarioSessionReviewCommentRepository } from '../../repository/comment.repository';
import { ScenarioSessionReviewCommentReactionRepository } from '../../repository/comment-reaction.repository';
import { ScenarioSharedService } from '../../../learn/service/scenario-shared.service';
import { UserService } from '../../../user/service/user.service';
import { ScenarioReviewAccessValidator } from '../../util/scenario-review-access-validator';
import { ScenarioSessionReviewReadStatusRepository } from '../../repository/read-status.repository';
import { PermissionValidator } from '../../../authorization/service/permission-validator.service';
import { ScenarioSessionRecordingService } from '../../../learn/service/scenario-session-recording.service';

jest.mock('src/review/util/review.util', () => ({
  getSessionDurationInSeconds: jest.fn(() => 120),
  getActiveSessionDurationSeconds: jest.fn(() => 120),
  formatCreatedUserDetails: jest.fn(() => ({
    id: 1,
    name: 'Test User',
    profileImage: 'image.jpg',
  })),
}));

describe('formatReviewListResponse', () => {
  let service: ScenarioSessionReviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionReviewService,
        { provide: ScenarioSessionReviewRepository, useValue: {} },
        { provide: ScenarioSessionReviewThreadRepository, useValue: {} },
        { provide: ScenarioSessionReviewReactionRepository, useValue: {} },
        { provide: ScenarioSessionReviewCommentRepository, useValue: {} },
        {
          provide: ScenarioSessionReviewCommentReactionRepository,
          useValue: {},
        },
        { provide: ScenarioSharedService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: ScenarioReviewAccessValidator, useValue: {} },
        { provide: ScenarioSessionReviewReadStatusRepository, useValue: {} },
        { provide: PermissionValidator, useValue: {} },
        {
          provide: ScenarioSessionRecordingService,
          useValue: {
            getRecordingUrlForSession: jest.fn().mockResolvedValue(null),
            getRecordingUrlsForSessions: jest.fn().mockResolvedValue(new Map()),
          },
        },
      ],
    }).compile();

    service = module.get<ScenarioSessionReviewService>(
      ScenarioSessionReviewService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const baseReview = {
    id: 'review-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tenantId: 'tenant-1',
    scenarioSessionId: 'session-1',
    createdBy: { id: 1, name: 'Test User' } as any,
    status: 'IN_REVIEW',
    note: 'Test note',
    noteEditedAt: null,
    scenarioSession: {
      id: 'session-1',
      startedAt: new Date('2023-01-01T10:00:00Z'),
      endedAt: new Date('2023-01-01T10:02:00Z'),
      createdAt: new Date(),
    } as any,
    scenario: {
      id: 1,
      title: 'English Title',
      description: 'English Description',
      createdAt: new Date(),
      coverImageUrl: 'cover.jpg',
      coverVideoUrl: 'video.mp4',
      translations: {
        fr: {
          title: 'French Title',
          description: 'French Description',
        },
      },
    } as any,
  };

  it('should format correctly without a language code provided', () => {
    const result = {
      reviews: [baseReview as any],
      count: 1,
      reactions: [{ reviewId: 'review-1', reaction: 'like', count: '5' }],
      comments: [{ reviewId: 'review-1', count: 3 }],
    };

    const formattedData = (service as any).formatReviewListResponse(result);

    expect(formattedData).toHaveLength(1);
    expect(formattedData[0].id).toEqual('review-1');
    expect(formattedData[0].scenario.title).toEqual('English Title');
    expect(formattedData[0].scenario.description).toEqual(
      'English Description',
    );
    expect(formattedData[0].commentsCount).toEqual(3);
    expect(formattedData[0].reactions).toEqual({ like: 5 });
    expect(formattedData[0].note).toEqual('Test note');
  });

  it('should format and translate the scenario details when a valid language code is provided', () => {
    const result = {
      reviews: [baseReview as any],
      count: 1,
      reactions: [],
      comments: [],
    };

    const formattedData = (service as any).formatReviewListResponse(
      result,
      'fr',
    );

    expect(formattedData[0].scenario.title).toEqual('French Title');
    expect(formattedData[0].scenario.description).toEqual('French Description');
  });

  it('should format and fallback to default title/description when language code is provided but not found in translations', () => {
    const result = {
      reviews: [baseReview as any],
      count: 1,
      reactions: [],
      comments: [],
    };

    const formattedData = (service as any).formatReviewListResponse(
      result,
      'es',
    );

    expect(formattedData[0].scenario.title).toEqual('English Title');
    expect(formattedData[0].scenario.description).toEqual(
      'English Description',
    );
  });

  it('should format correctly when scenario and scenarioSession are missing', () => {
    const reviewWithoutRelations = {
      ...baseReview,
      scenario: null,
      scenarioSession: null,
    };
    const result = {
      reviews: [reviewWithoutRelations as any],
      count: 1,
      reactions: [],
      comments: [],
    };

    const formattedData = (service as any).formatReviewListResponse(result);

    expect(formattedData[0].scenario).toEqual({});
    expect(formattedData[0].scenarioSession).toEqual({});
  });

  it('attaches audioUrl from the audio url map when the session has a recording', () => {
    const result = {
      reviews: [baseReview as any],
      count: 1,
      reactions: [],
      comments: [],
    };
    const audioUrlsBySessionId = new Map<string, string>([
      ['session-1', 'https://signed.example/session-1'],
    ]);

    const formattedData = (service as any).formatReviewListResponse(
      result,
      undefined,
      audioUrlsBySessionId,
    );

    expect(formattedData[0].scenarioSession.audioUrl).toEqual(
      'https://signed.example/session-1',
    );
  });

  it('sets audioUrl to null when the session has no recording in the map', () => {
    const result = {
      reviews: [baseReview as any],
      count: 1,
      reactions: [],
      comments: [],
    };

    const formattedData = (service as any).formatReviewListResponse(
      result,
      undefined,
      new Map<string, string>(),
    );

    expect(formattedData[0].scenarioSession.audioUrl).toBeNull();
  });

  it('sets isReviewed to true when the review id is in the read set', () => {
    const result = {
      reviews: [baseReview as any],
      count: 1,
      reactions: [],
      comments: [],
    };

    const formattedData = (service as any).formatReviewListResponse(
      result,
      undefined,
      undefined,
      new Set(['review-1']),
    );

    expect(formattedData[0].isReviewed).toBe(true);
  });

  it('sets isReviewed to false when the review id is not in the read set', () => {
    const result = {
      reviews: [baseReview as any],
      count: 1,
      reactions: [],
      comments: [],
    };

    const formattedData = (service as any).formatReviewListResponse(
      result,
      undefined,
      undefined,
      new Set(['some-other-review']),
    );

    expect(formattedData[0].isReviewed).toBe(false);
  });

  it('defaults isReviewed to false when no read set is provided', () => {
    const result = {
      reviews: [baseReview as any],
      count: 1,
      reactions: [],
      comments: [],
    };

    const formattedData = (service as any).formatReviewListResponse(result);

    expect(formattedData[0].isReviewed).toBe(false);
  });
});

describe('getReviewById', () => {
  let service: ScenarioSessionReviewService;
  const reviewRepository = { findOne: jest.fn() };
  const scenarioSharedService = {
    getScenarioSessionById: jest.fn(),
    getScenarioById: jest.fn(),
  };
  const userService = { get: jest.fn() };
  const reviewAccessValidator = { validateAccess: jest.fn() };
  const reviewThreadRepository = {
    getCommentsCountByReviewIds: jest.fn(),
    findOne: jest.fn(),
  };
  const reviewReactionRepository = {
    getReactionsByReviewIds: jest.fn(),
    findOne: jest.fn(),
  };
  const recordingService = {
    getRecordingUrlForSession: jest.fn(),
    getRecordingUrlsForSessions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionReviewService,
        {
          provide: ScenarioSessionReviewRepository,
          useValue: reviewRepository,
        },
        {
          provide: ScenarioSessionReviewThreadRepository,
          useValue: reviewThreadRepository,
        },
        {
          provide: ScenarioSessionReviewReactionRepository,
          useValue: reviewReactionRepository,
        },
        { provide: ScenarioSessionReviewCommentRepository, useValue: {} },
        {
          provide: ScenarioSessionReviewCommentReactionRepository,
          useValue: {},
        },
        { provide: ScenarioSharedService, useValue: scenarioSharedService },
        { provide: UserService, useValue: userService },
        {
          provide: ScenarioReviewAccessValidator,
          useValue: reviewAccessValidator,
        },
        { provide: ScenarioSessionReviewReadStatusRepository, useValue: {} },
        { provide: PermissionValidator, useValue: {} },
        {
          provide: ScenarioSessionRecordingService,
          useValue: recordingService,
        },
      ],
    }).compile();

    recordingService.getRecordingUrlForSession.mockResolvedValue(null);
    recordingService.getRecordingUrlsForSessions.mockResolvedValue(new Map());

    service = module.get<ScenarioSessionReviewService>(
      ScenarioSessionReviewService,
    );

    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('1');
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return review with translated scenario title and description if languageCode is provided and translation exists', async () => {
    reviewRepository.findOne.mockResolvedValue({
      id: 'review-1',
      status: 'IN_REVIEW',
      createdBy: 1,
      scenarioSessionId: 'session-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      note: 'test',
    });
    reviewAccessValidator.validateAccess.mockResolvedValue(true);
    scenarioSharedService.getScenarioSessionById.mockResolvedValue({
      id: 'session-1',
      scenarioId: 1,
      startedAt: new Date(),
      endedAt: new Date(),
      createdAt: new Date(),
    });
    userService.get.mockResolvedValue({
      id: 1,
      name: 'User 1',
      status: 'ACTIVE',
    });
    scenarioSharedService.getScenarioById.mockResolvedValue({
      id: 1,
      title: 'English Title',
      description: 'English Description',
      translations: {
        fr: { title: 'French Title', description: 'French Description' },
      },
      createdAt: new Date(),
    });
    reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue([
      { count: '2' },
    ]);
    reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue([
      { reaction: 'like', count: '5' },
    ]);
    reviewReactionRepository.findOne.mockResolvedValue({ reaction: 'like' });
    reviewThreadRepository.findOne.mockResolvedValue({ id: 'thread-1' });

    const result = await service.getReviewById('review-1', 'fr');

    expect(result.scenario.title).toEqual('French Title');
    expect(result.scenario.description).toEqual('French Description');
  });

  it('should return review with default scenario title and description if languageCode is not found in translations', async () => {
    reviewRepository.findOne.mockResolvedValue({
      id: 'review-1',
      status: 'IN_REVIEW',
      createdBy: 1,
      scenarioSessionId: 'session-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      note: 'test',
    });
    reviewAccessValidator.validateAccess.mockResolvedValue(true);
    scenarioSharedService.getScenarioSessionById.mockResolvedValue({
      id: 'session-1',
      scenarioId: 1,
      startedAt: new Date(),
      endedAt: new Date(),
      createdAt: new Date(),
    });
    userService.get.mockResolvedValue({
      id: 1,
      name: 'User 1',
      status: 'ACTIVE',
    });
    scenarioSharedService.getScenarioById.mockResolvedValue({
      id: 1,
      title: 'English Title',
      description: 'English Description',
      translations: {
        fr: { title: 'French Title', description: 'French Description' },
      },
      createdAt: new Date(),
    });
    reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue([
      { count: '2' },
    ]);
    reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue([
      { reaction: 'like', count: '5' },
    ]);
    reviewReactionRepository.findOne.mockResolvedValue({ reaction: 'like' });
    reviewThreadRepository.findOne.mockResolvedValue({ id: 'thread-1' });

    const result = await service.getReviewById('review-1', 'es'); // 'es' does not exist

    expect(result.scenario.title).toEqual('English Title');
    expect(result.scenario.description).toEqual('English Description');
  });

  const mockBaseHappyPath = () => {
    reviewRepository.findOne.mockResolvedValue({
      id: 'review-1',
      status: 'IN_REVIEW',
      createdBy: 1,
      scenarioSessionId: 'session-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      note: 'test',
    });
    reviewAccessValidator.validateAccess.mockResolvedValue(true);
    scenarioSharedService.getScenarioSessionById.mockResolvedValue({
      id: 'session-1',
      scenarioId: 1,
      startedAt: new Date(),
      endedAt: new Date(),
      createdAt: new Date(),
    });
    userService.get.mockResolvedValue({
      id: 1,
      name: 'User 1',
      status: 'ACTIVE',
    });
    scenarioSharedService.getScenarioById.mockResolvedValue({
      id: 1,
      title: 'English Title',
      description: 'English Description',
      createdAt: new Date(),
    });
    reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue([
      { count: '0' },
    ]);
    reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue([]);
    reviewReactionRepository.findOne.mockResolvedValue(null);
    reviewThreadRepository.findOne.mockResolvedValue(null);
  };

  it('includes the recording audioUrl on the scenarioSession when one is available', async () => {
    mockBaseHappyPath();
    recordingService.getRecordingUrlForSession.mockResolvedValue(
      'https://signed.example/session-1',
    );

    const result = await service.getReviewById('review-1');

    expect(recordingService.getRecordingUrlForSession).toHaveBeenCalledWith(
      'session-1',
    );
    expect(result.scenarioSession.audioUrl).toEqual(
      'https://signed.example/session-1',
    );
  });

  it('returns audioUrl as null when the session has no recording', async () => {
    mockBaseHappyPath();
    recordingService.getRecordingUrlForSession.mockResolvedValue(null);

    const result = await service.getReviewById('review-1');

    expect(result.scenarioSession.audioUrl).toBeNull();
  });
});

describe('getAllReviews', () => {
  let service: ScenarioSessionReviewService;
  const reviewRepository = { getAllReviews: jest.fn() };
  const reviewThreadRepository = { getCommentsCountByReviewIds: jest.fn() };
  const reviewReactionRepository = { getReactionsByReviewIds: jest.fn() };
  const recordingService = { getRecordingUrlsForSessions: jest.fn() };
  const readStatusRepository = { getReadReviewIds: jest.fn() };

  const reviewRow = (id: string) => ({
    id,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'tenant-1',
    scenarioSessionId: `session-${id}`,
    createdBy: { id: 1, name: 'Test User' } as any,
    status: 'IN_REVIEW',
    note: 'note',
    noteEditedAt: null,
    scenarioSession: {
      id: `session-${id}`,
      startedAt: new Date('2023-01-01T10:00:00Z'),
      endedAt: new Date('2023-01-01T10:02:00Z'),
      createdAt: new Date(),
    },
    scenario: {
      id: 1,
      title: 'Title',
      description: 'Description',
      createdAt: new Date(),
      coverImageUrl: 'cover.jpg',
      coverVideoUrl: 'video.mp4',
    },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionReviewService,
        {
          provide: ScenarioSessionReviewRepository,
          useValue: reviewRepository,
        },
        {
          provide: ScenarioSessionReviewThreadRepository,
          useValue: reviewThreadRepository,
        },
        {
          provide: ScenarioSessionReviewReactionRepository,
          useValue: reviewReactionRepository,
        },
        { provide: ScenarioSessionReviewCommentRepository, useValue: {} },
        {
          provide: ScenarioSessionReviewCommentReactionRepository,
          useValue: {},
        },
        { provide: ScenarioSharedService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: ScenarioReviewAccessValidator, useValue: {} },
        {
          provide: ScenarioSessionReviewReadStatusRepository,
          useValue: readStatusRepository,
        },
        { provide: PermissionValidator, useValue: {} },
        {
          provide: ScenarioSessionRecordingService,
          useValue: recordingService,
        },
      ],
    }).compile();

    service = module.get<ScenarioSessionReviewService>(
      ScenarioSessionReviewService,
    );

    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('1');
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-1');

    reviewReactionRepository.getReactionsByReviewIds.mockResolvedValue([]);
    reviewThreadRepository.getCommentsCountByReviewIds.mockResolvedValue([]);
    recordingService.getRecordingUrlsForSessions.mockResolvedValue(new Map());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('looks up read status for the current user and flags reviewed cards', async () => {
    reviewRepository.getAllReviews.mockResolvedValue({
      reviews: [reviewRow('review-1'), reviewRow('review-2')],
      count: 2,
    });
    readStatusRepository.getReadReviewIds.mockResolvedValue(
      new Set(['review-1']),
    );

    const result = await service.getAllReviews({});

    expect(readStatusRepository.getReadReviewIds).toHaveBeenCalledWith(1, [
      'review-1',
      'review-2',
    ]);
    expect(result.data[0]).toMatchObject({ id: 'review-1', isReviewed: true });
    expect(result.data[1]).toMatchObject({ id: 'review-2', isReviewed: false });
  });

  it('returns an empty list without querying read status when there are no reviews', async () => {
    reviewRepository.getAllReviews.mockResolvedValue({ reviews: [], count: 0 });

    const result = await service.getAllReviews({});

    expect(result).toEqual({ data: [], count: 0 });
    expect(readStatusRepository.getReadReviewIds).not.toHaveBeenCalled();
  });

  it('passes readFilter option through to the repository', async () => {
    reviewRepository.getAllReviews.mockResolvedValue({ reviews: [], count: 0 });

    await service.getAllReviews({ readFilter: ReadFilter.UNREAD });

    expect(reviewRepository.getAllReviews).toHaveBeenCalledWith(
      expect.objectContaining({ readFilter: ReadFilter.UNREAD }),
      'tenant-1',
      1,
    );
  });
});

describe('markReviewAsRead', () => {
  let service: ScenarioSessionReviewService;
  const reviewRepository = { findOne: jest.fn() };
  const readStatusRepository = { markAsRead: jest.fn() };
  const permissionValidator = { validatePermissions: jest.fn() };
  const reviewAccessValidator = { getReviewerAccessPermission: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionReviewService,
        {
          provide: ScenarioSessionReviewRepository,
          useValue: reviewRepository,
        },
        { provide: ScenarioSessionReviewThreadRepository, useValue: {} },
        { provide: ScenarioSessionReviewReactionRepository, useValue: {} },
        { provide: ScenarioSessionReviewCommentRepository, useValue: {} },
        {
          provide: ScenarioSessionReviewCommentReactionRepository,
          useValue: {},
        },
        { provide: ScenarioSharedService, useValue: {} },
        { provide: UserService, useValue: {} },
        {
          provide: ScenarioReviewAccessValidator,
          useValue: reviewAccessValidator,
        },
        {
          provide: ScenarioSessionReviewReadStatusRepository,
          useValue: readStatusRepository,
        },
        { provide: PermissionValidator, useValue: permissionValidator },
        {
          provide: ScenarioSessionRecordingService,
          useValue: {
            getRecordingUrlForSession: jest.fn(),
            getRecordingUrlsForSessions: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ScenarioSessionReviewService>(
      ScenarioSessionReviewService,
    );

    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('42');
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const setupHappyPath = () => {
    permissionValidator.validatePermissions.mockResolvedValue(true);
    reviewAccessValidator.getReviewerAccessPermission.mockReturnValue(
      'VIEW_SIMULATION_REVIEWS',
    );
    reviewRepository.findOne.mockResolvedValue({
      id: 'review-1',
      tenantId: 'tenant-1',
    });
    readStatusRepository.markAsRead.mockResolvedValue(undefined);
  };

  it('logs a simulation_review_viewed event with reviewId and userId', async () => {
    setupHappyPath();
    const loggerSpy = jest.spyOn((service as any).logger, 'info');

    await service.markReviewAsRead('review-1');

    expect(loggerSpy).toHaveBeenCalledWith({
      event: 'simulation_review_viewed',
      reviewId: 'review-1',
      userId: 42,
    });
  });

  it('returns the success response from the base implementation', async () => {
    setupHappyPath();

    const result = await service.markReviewAsRead('review-1');

    expect(result).toEqual({ success: true });
  });
});

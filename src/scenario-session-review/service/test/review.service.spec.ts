import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioSessionReviewService } from '../review.service';
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

jest.mock('src/review/util/review.util', () => ({
  getSessionDurationInSeconds: jest.fn(() => 120),
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
});

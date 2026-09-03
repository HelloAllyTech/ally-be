import { Test, TestingModule } from '@nestjs/testing';
import { BadgeUserService } from '../badge-user.service';
import { BadgeUserRepository } from '../../repository/badge-user.repository';
import { CommunitySharedService } from 'src/community/service/community-shared.service';
import { ScenarioSessionReviewSharedService } from 'src/scenario-session-review/service/review-shared.service';
import { ProgressSharedService } from 'src/progress/service/progress-shared.service';
import { Badge } from '../../entity/badge.entity';
import { BadgeCategory } from '../../constants/badge.constants';

describe('BadgeUserService', () => {
  let service: BadgeUserService;
  let mockBadgeUserRepository: jest.Mocked<BadgeUserRepository>;
  let mockCommunitySharedService: jest.Mocked<CommunitySharedService>;
  let mockScenarioSessionReviewSharedService: jest.Mocked<ScenarioSessionReviewSharedService>;
  let mockProgressSharedService: jest.Mocked<ProgressSharedService>;

  beforeEach(async () => {
    mockBadgeUserRepository = {
      create: jest.fn((entity) => entity),
      save: jest.fn(),
      findBadgeUserIdsByTenants: jest.fn(),
      softDelete: jest.fn(),
    } as any;

    mockCommunitySharedService = {
      getTotalSimulationMinutesPerUser: jest.fn(),
      getMaxActiveDaysPerUser: jest.fn(),
    } as any;

    mockScenarioSessionReviewSharedService = {
      getGivenCommentsCountPerUser: jest.fn(),
      getGivenReviewReactionsCountPerUser: jest.fn(),
      getGivenCommentsReactionsCountPerUser: jest.fn(),
      getReceivedCommentsCountPerUser: jest.fn(),
      getReceivedReviewReactionsCountPerUser: jest.fn(),
      getReceivedCommentsReactionsCountPerUser: jest.fn(),
    } as any;

    mockProgressSharedService = {
      getLevelPerUser: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgeUserService,
        {
          provide: ProgressSharedService,
          useValue: mockProgressSharedService,
        },
        {
          provide: BadgeUserRepository,
          useValue: mockBadgeUserRepository,
        },
        {
          provide: CommunitySharedService,
          useValue: mockCommunitySharedService,
        },
        {
          provide: ScenarioSessionReviewSharedService,
          useValue: mockScenarioSessionReviewSharedService,
        },
      ],
    }).compile();

    service = module.get<BadgeUserService>(BadgeUserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('awardBadgeToUsersByTenant', () => {
    it('should return undefined when badge has no achievementParams', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.SIMULATION_MINUTES,
        achievementParams: null,
      } as unknown as Badge;

      const result = await service.awardBadgeToUsersByTenant(badge, [
        'tenant-1',
      ]);

      expect(result).toBeUndefined();
      expect(
        mockCommunitySharedService.getTotalSimulationMinutesPerUser,
      ).not.toHaveBeenCalled();
    });

    it('should fetch simulation minutes for SIMULATION_MINUTES category', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.SIMULATION_MINUTES,
        achievementParams: { count: 10 },
      } as unknown as Badge;
      mockCommunitySharedService.getTotalSimulationMinutesPerUser.mockResolvedValue(
        [],
      );

      await service.awardBadgeToUsersByTenant(badge, ['tenant-1']);

      expect(
        mockCommunitySharedService.getTotalSimulationMinutesPerUser,
      ).toHaveBeenCalledWith(['tenant-1'], undefined);
    });

    it('should fetch max active days for ACTIVE_DAY_STREAK category', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.ACTIVE_DAY_STREAK,
        achievementParams: { count: 5 },
      } as unknown as Badge;
      mockCommunitySharedService.getMaxActiveDaysPerUser.mockResolvedValue([]);

      await service.awardBadgeToUsersByTenant(badge, ['tenant-1']);

      expect(
        mockCommunitySharedService.getMaxActiveDaysPerUser,
      ).toHaveBeenCalledWith(['tenant-1'], undefined);
    });

    it('should fetch given comments/reactions for COMMENTS_REACTIONS_GIVEN category', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
        achievementParams: { count: 3 },
      } as unknown as Badge;
      mockScenarioSessionReviewSharedService.getGivenCommentsCountPerUser.mockResolvedValue(
        [],
      );
      mockScenarioSessionReviewSharedService.getGivenReviewReactionsCountPerUser.mockResolvedValue(
        [],
      );
      mockScenarioSessionReviewSharedService.getGivenCommentsReactionsCountPerUser.mockResolvedValue(
        [],
      );

      await service.awardBadgeToUsersByTenant(badge, ['tenant-1']);

      expect(
        mockScenarioSessionReviewSharedService.getGivenCommentsCountPerUser,
      ).toHaveBeenCalledWith(['tenant-1'], undefined);
      expect(
        mockScenarioSessionReviewSharedService.getGivenReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(['tenant-1'], undefined);
      expect(
        mockScenarioSessionReviewSharedService.getGivenCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(['tenant-1'], undefined);
    });

    it('should fetch received comments/reactions for COMMENTS_REACTIONS_RECEIVED category', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
        achievementParams: { count: 3 },
      } as unknown as Badge;
      mockScenarioSessionReviewSharedService.getReceivedCommentsCountPerUser.mockResolvedValue(
        [],
      );
      mockScenarioSessionReviewSharedService.getReceivedReviewReactionsCountPerUser.mockResolvedValue(
        [],
      );
      mockScenarioSessionReviewSharedService.getReceivedCommentsReactionsCountPerUser.mockResolvedValue(
        [],
      );

      await service.awardBadgeToUsersByTenant(badge, ['tenant-1']);

      expect(
        mockScenarioSessionReviewSharedService.getReceivedCommentsCountPerUser,
      ).toHaveBeenCalledWith(['tenant-1'], undefined);
      expect(
        mockScenarioSessionReviewSharedService.getReceivedReviewReactionsCountPerUser,
      ).toHaveBeenCalledWith(['tenant-1'], undefined);
      expect(
        mockScenarioSessionReviewSharedService.getReceivedCommentsReactionsCountPerUser,
      ).toHaveBeenCalledWith(['tenant-1'], undefined);
    });

    it('should only award badges to users meeting the threshold', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.SIMULATION_MINUTES,
        achievementParams: { count: 30 },
      } as unknown as Badge;
      mockCommunitySharedService.getTotalSimulationMinutesPerUser.mockResolvedValue(
        [
          { userId: 1, totalMinutes: 50 },
          { userId: 2, totalMinutes: 20 },
          { userId: 3, totalMinutes: 30 },
        ],
      );
      mockBadgeUserRepository.save.mockResolvedValue([] as any);

      await service.awardBadgeToUsersByTenant(badge, ['tenant-1']);

      expect(mockBadgeUserRepository.save).toHaveBeenCalledWith([
        { userId: 1, badgeId: 'badge-1' },
        { userId: 3, badgeId: 'badge-1' },
      ]);
    });

    it('should not call save when no users meet the threshold', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.SIMULATION_MINUTES,
        achievementParams: { count: 100 },
      } as unknown as Badge;
      mockCommunitySharedService.getTotalSimulationMinutesPerUser.mockResolvedValue(
        [
          { userId: 1, totalMinutes: 50 },
          { userId: 2, totalMinutes: 20 },
        ],
      );

      await service.awardBadgeToUsersByTenant(badge, ['tenant-1']);

      expect(mockBadgeUserRepository.save).not.toHaveBeenCalled();
    });

    it('should merge counts from multiple sources for COMMENTS_REACTIONS_GIVEN', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
        achievementParams: { count: 6 },
      } as unknown as Badge;
      mockScenarioSessionReviewSharedService.getGivenCommentsCountPerUser.mockResolvedValue(
        [
          { userId: 1, count: 2 },
          { userId: 2, count: 1 },
        ],
      );
      mockScenarioSessionReviewSharedService.getGivenReviewReactionsCountPerUser.mockResolvedValue(
        [
          { userId: 1, count: 2 },
          { userId: 3, count: 3 },
        ],
      );
      mockScenarioSessionReviewSharedService.getGivenCommentsReactionsCountPerUser.mockResolvedValue(
        [{ userId: 1, count: 2 }],
      );
      mockBadgeUserRepository.save.mockResolvedValue([] as any);

      await service.awardBadgeToUsersByTenant(badge, ['tenant-1']);

      // User 1: 2 + 2 + 2 = 6 (meets threshold)
      // User 2: 1 (below threshold)
      // User 3: 3 (below threshold)
      expect(mockBadgeUserRepository.save).toHaveBeenCalledWith([
        { userId: 1, badgeId: 'badge-1' },
      ]);
    });

    it('should merge counts from multiple sources for COMMENTS_REACTIONS_RECEIVED', async () => {
      const badge = {
        id: 'badge-1',
        category: BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
        achievementParams: { count: 5 },
      } as unknown as Badge;
      mockScenarioSessionReviewSharedService.getReceivedCommentsCountPerUser.mockResolvedValue(
        [
          { userId: 1, count: 2 },
          { userId: 2, count: 1 },
        ],
      );
      mockScenarioSessionReviewSharedService.getReceivedReviewReactionsCountPerUser.mockResolvedValue(
        [
          { userId: 1, count: 1 },
          { userId: 3, count: 2 },
        ],
      );
      mockScenarioSessionReviewSharedService.getReceivedCommentsReactionsCountPerUser.mockResolvedValue(
        [{ userId: 1, count: 2 }],
      );
      mockBadgeUserRepository.save.mockResolvedValue([] as any);

      await service.awardBadgeToUsersByTenant(badge, ['tenant-1']);

      // User 1: 2 + 1 + 2 = 5 (meets threshold)
      // User 2: 1 (below threshold)
      // User 3: 2 (below threshold)
      expect(mockBadgeUserRepository.save).toHaveBeenCalledWith([
        { userId: 1, badgeId: 'badge-1' },
      ]);
    });
  });

  describe('mergeCountsByUserId', () => {
    it('should merge counts for the same userId', () => {
      const items = [
        { userId: 1, count: 5 },
        { userId: 2, count: 3 },
        { userId: 1, count: 10 },
        { userId: 2, count: 7 },
      ];

      const result = (service as any).mergeCountsByUserId(items);

      expect(result).toEqual(
        expect.arrayContaining([
          { userId: 1, count: 15 },
          { userId: 2, count: 10 },
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const result = (service as any).mergeCountsByUserId([]);

      expect(result).toEqual([]);
    });
  });

  describe('removeBadgeUsersForTenants', () => {
    it('should return early when tenantIds is empty', async () => {
      await service.removeBadgeUsersForTenants('badge-1', []);

      expect(
        mockBadgeUserRepository.findBadgeUserIdsByTenants,
      ).not.toHaveBeenCalled();
    });

    it('should soft delete badge users found for tenants', async () => {
      mockBadgeUserRepository.findBadgeUserIdsByTenants.mockResolvedValue([
        'bu-1',
        'bu-2',
      ]);
      mockBadgeUserRepository.softDelete.mockResolvedValue({} as any);

      await service.removeBadgeUsersForTenants('badge-1', [
        'tenant-1',
        'tenant-2',
      ]);

      expect(
        mockBadgeUserRepository.findBadgeUserIdsByTenants,
      ).toHaveBeenCalledWith('badge-1', ['tenant-1', 'tenant-2']);
      expect(mockBadgeUserRepository.softDelete).toHaveBeenCalledWith([
        'bu-1',
        'bu-2',
      ]);
    });

    it('should not call softDelete when no badge users found', async () => {
      mockBadgeUserRepository.findBadgeUserIdsByTenants.mockResolvedValue([]);

      await service.removeBadgeUsersForTenants('badge-1', ['tenant-1']);

      expect(mockBadgeUserRepository.softDelete).not.toHaveBeenCalled();
    });
  });
});

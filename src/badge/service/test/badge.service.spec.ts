import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BadgeService } from '../badge.service';
import { BadgeRepository } from '../../repository/badge.repository';
import { BadgeUserRepository } from '../../repository/badge-user.repository';
import { BadgeGroupRepository } from '../../repository/badge-group.repository';
import { BadgeUserService } from '../badge-user.service';
import { BadgeTenantService } from '../badge-tenant.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { GroupRepository } from 'src/authorization/repository/group.repository';
import { Badge } from '../../entity/badge.entity';
import {
  BadgeStatus,
  BadgeLockStatus,
  BadgeViewedStatus,
} from '../../constants/badge.constants';
import { NotFoundException } from 'src/exception/custom.exception';
import { ExecutionManager } from 'src/common/execution/execution-manager';

jest.mock('src/common/execution/execution-manager');

describe('BadgeService', () => {
  let service: BadgeService;
  let mockBadgeRepository: jest.Mocked<BadgeRepository>;
  let mockBadgeUserRepository: jest.Mocked<BadgeUserRepository>;
  let mockBadgeGroupRepository: jest.Mocked<BadgeGroupRepository>;
  let mockBadgeUserService: jest.Mocked<BadgeUserService>;
  let mockBadgeTenantService: jest.Mocked<BadgeTenantService>;
  let mockTenantService: jest.Mocked<TenantService>;
  let mockGroupRepository: jest.Mocked<GroupRepository>;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    mockBadgeRepository = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      getUserBadges: jest.fn(),
      getUserBadgeCount: jest.fn(),
      getBadgesForTenant: jest.fn(),
      getBadgeIdsForUserGroups: jest.fn(),
    } as any;

    mockBadgeUserRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    } as any;

    mockBadgeGroupRepository = {
      create: jest.fn((entity) => entity),
      save: jest.fn(),
      delete: jest.fn(),
      findByBadgeId: jest.fn(),
    } as any;

    mockBadgeUserService = {
      awardBadgeToUsersByTenant: jest.fn(),
      removeBadgeUsersForTenants: jest.fn(),
    } as any;

    mockBadgeTenantService = {
      assignBadgeToTenants: jest.fn(),
      getTenantIdsForBadge: jest.fn(),
      removeBadgeFromTenants: jest.fn(),
      updateBadgeTenants: jest.fn(),
    } as any;

    mockTenantService = {
      findById: jest.fn(),
      findAll: jest.fn(),
    } as any;

    mockGroupRepository = {
      getAll: jest.fn(),
    } as any;

    mockDataSource = {
      transaction: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgeService,
        { provide: BadgeRepository, useValue: mockBadgeRepository },
        { provide: BadgeUserRepository, useValue: mockBadgeUserRepository },
        { provide: BadgeGroupRepository, useValue: mockBadgeGroupRepository },
        { provide: BadgeUserService, useValue: mockBadgeUserService },
        { provide: BadgeTenantService, useValue: mockBadgeTenantService },
        { provide: TenantService, useValue: mockTenantService },
        { provide: GroupRepository, useValue: mockGroupRepository },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<BadgeService>(BadgeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateMandatoryFieldsForActiveStatus', () => {
    it('should throw BadRequestException when mandatory fields are missing for ACTIVE status', () => {
      const badgeData = {
        code: 'TEST',
        name: 'Test Badge',
        // missing: description, imageUrl, category, achievementParams, groupIds
      };

      expect(() => {
        (service as any).validateMandatoryFieldsForActiveStatus(
          badgeData,
          BadgeStatus.ACTIVE,
        );
      }).toThrow(BadRequestException);
    });

    it('should not validate mandatory fields for DRAFT status', () => {
      const badgeData = {
        code: 'TEST',
        // missing most fields
      };

      expect(() => {
        (service as any).validateMandatoryFieldsForActiveStatus(
          badgeData,
          BadgeStatus.DRAFT,
        );
      }).not.toThrow();
    });
  });

  describe('validateUpdateBadgeDto', () => {
    it('should throw BadRequestException when changing status from ACTIVE to DRAFT', async () => {
      const badge = {
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge;
      const updateDto = { status: BadgeStatus.DRAFT };

      await expect(
        (service as any).validateUpdateBadgeDto(badge, updateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when modifying achievementParams for ACTIVE badge', async () => {
      const badge = {
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge;
      const updateDto = { achievementParams: { count: 20 } };

      await expect(
        (service as any).validateUpdateBadgeDto(badge, updateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when modifying category for ACTIVE badge', async () => {
      const badge = {
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge;
      const updateDto = { category: 'ACTIVE_DAY_STREAK' };

      await expect(
        (service as any).validateUpdateBadgeDto(badge, updateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow modifying other fields for ACTIVE badge', async () => {
      const badge = {
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
        code: 'TEST',
        name: 'Test',
        description: 'Desc',
        imageUrl: 'url',
        category: 'SIMULATION_MINUTES',
        achievementParams: { count: 10 },
      } as unknown as Badge;
      const updateDto = { name: 'Updated Name' };

      mockBadgeGroupRepository.findByBadgeId.mockResolvedValue([
        { groupId: 1 },
      ] as any);

      await expect(
        (service as any).validateUpdateBadgeDto(badge, updateDto),
      ).resolves.not.toThrow();
    });
  });

  describe('validateTenantAndGroupIds', () => {
    it('should throw NotFoundException when group does not exist', async () => {
      mockGroupRepository.getAll.mockResolvedValue([{ id: 1 }] as any);

      await expect(
        (service as any).validateTenantAndGroupIds(undefined, [1, 2]),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when tenant does not exist', async () => {
      mockTenantService.findById.mockResolvedValueOnce({
        id: 'tenant-1',
      } as any);
      mockTenantService.findById.mockResolvedValueOnce(null);

      await expect(
        (service as any).validateTenantAndGroupIds(
          ['tenant-1', 'tenant-2'],
          undefined,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not throw when all tenants and groups exist', async () => {
      mockGroupRepository.getAll.mockResolvedValue([
        { id: 1 },
        { id: 2 },
      ] as any);
      mockTenantService.findById.mockResolvedValue({ id: 'tenant-1' } as any);

      await expect(
        (service as any).validateTenantAndGroupIds(['tenant-1'], [1, 2]),
      ).resolves.not.toThrow();
    });
  });

  describe('getFormattedUserAvailableBadges', () => {
    it('should return empty array when no badges for tenant', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
      mockBadgeRepository.getBadgesForTenant.mockResolvedValue([]);

      const result = await service.getFormattedUserAvailableBadges(1);

      expect(result).toEqual([]);
    });

    it('should set UNLOCKED status for awarded badges', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
      mockBadgeRepository.getBadgesForTenant.mockResolvedValue([
        {
          id: 'badge-1',
          category: 'SIMULATION_MINUTES',
          achievementParams: { count: 10 },
        },
      ] as any);
      mockBadgeRepository.getBadgeIdsForUserGroups.mockResolvedValue([
        'badge-1',
      ]);
      mockBadgeUserRepository.find.mockResolvedValue([
        { badgeId: 'badge-1', viewedStatus: BadgeViewedStatus.VIEWED },
      ] as any);

      const result = await service.getFormattedUserAvailableBadges(1);

      expect(result[0].badges[0].lockStatus).toBe(BadgeLockStatus.UNLOCKED);
      expect(result[0].badges[0].viewedStatus).toBe(BadgeViewedStatus.VIEWED);
    });

    it('should set LOCKED status for non-awarded badges', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
      mockBadgeRepository.getBadgesForTenant.mockResolvedValue([
        {
          id: 'badge-1',
          category: 'SIMULATION_MINUTES',
          achievementParams: { count: 10 },
        },
      ] as any);
      mockBadgeRepository.getBadgeIdsForUserGroups.mockResolvedValue([
        'badge-1',
      ]);
      mockBadgeUserRepository.find.mockResolvedValue([]);

      const result = await service.getFormattedUserAvailableBadges(1);

      expect(result[0].badges[0].lockStatus).toBe(BadgeLockStatus.LOCKED);
      expect(result[0].badges[0].viewedStatus).toBeNull();
    });

    it('should filter badges based on user group access', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
      mockBadgeRepository.getBadgesForTenant.mockResolvedValue([
        {
          id: 'badge-1',
          category: 'SIMULATION_MINUTES',
          achievementParams: { count: 10 },
        },
        {
          id: 'badge-2',
          category: 'SIMULATION_MINUTES',
          achievementParams: { count: 20 },
        },
        {
          id: 'badge-3',
          category: 'SIMULATION_MINUTES',
          achievementParams: { count: 30 },
        },
      ] as any);
      mockBadgeRepository.getBadgeIdsForUserGroups.mockResolvedValue([
        'badge-1',
        'badge-3',
      ]);
      mockBadgeUserRepository.find.mockResolvedValue([]);

      const result = await service.getFormattedUserAvailableBadges(1);

      const badgeIds = result.flatMap((g) => g.badges.map((b) => b.id));
      expect(badgeIds).toContain('badge-1');
      expect(badgeIds).toContain('badge-3');
      expect(badgeIds).not.toContain('badge-2');
    });
  });

  describe('markBadgeAsViewed', () => {
    it('should throw NotFoundException when badge not found for user', async () => {
      mockBadgeUserRepository.findOne.mockResolvedValue(null);

      await expect(service.markBadgeAsViewed(1, 'badge-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update viewedStatus to VIEWED', async () => {
      const badgeUser = {
        userId: 1,
        badgeId: 'badge-1',
        viewedStatus: BadgeViewedStatus.UNVIEWED,
      };
      mockBadgeUserRepository.findOne.mockResolvedValue(badgeUser as any);
      mockBadgeUserRepository.save.mockResolvedValue(badgeUser as any);

      const result = await service.markBadgeAsViewed(1, 'badge-1');

      expect(mockBadgeUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          viewedStatus: BadgeViewedStatus.VIEWED,
        }),
      );
      expect(result).toEqual({
        badgeId: 'badge-1',
        viewedStatus: BadgeViewedStatus.VIEWED,
      });
    });
  });

  describe('buildBadgeUpdateData', () => {
    it('should only include defined fields in update data', () => {
      const updateDto = {
        code: 'NEW_CODE',
        name: 'New Name',
        // other fields undefined
      };

      const result = (service as any).buildBadgeUpdateData(updateDto);

      expect(result).toEqual({
        code: 'NEW_CODE',
        name: 'New Name',
      });
      expect(result).not.toHaveProperty('description');
      expect(result).not.toHaveProperty('imageUrl');
    });
  });

  describe('updateBadge', () => {
    it('should throw NotFoundException when badge does not exist', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockBadgeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateBadge('badge-1', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteBadge', () => {
    it('should throw NotFoundException when badge does not exist', async () => {
      mockBadgeRepository.findOne.mockResolvedValue(null);

      await expect(service.deleteBadge('badge-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createBadgesBatch', () => {
    const createMockBadgeDto = (code: string) => ({
      code,
      name: `Badge ${code}`,
      description: 'Test description',
      imageUrl: 'https://example.com/badge.png',
      category: 'SIMULATION_MINUTES',
      achievementParams: { count: 10 },
      groupIds: [1],
      tenantIds: [],
    });

    it('should throw BadRequestException when duplicate codes in batch', async () => {
      const batchDto = {
        badges: [createMockBadgeDto('TEST-1'), createMockBadgeDto('TEST-1')],
      };

      await expect(service.createBadgesBatch(batchDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should validate all badges have mandatory fields for ACTIVE status', async () => {
      const batchDto = {
        badges: [
          {
            code: 'TEST-1',
            name: 'Test Badge',
            // missing mandatory fields for ACTIVE status
          },
        ],
      };

      await expect(service.createBadgesBatch(batchDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should validate tenant and group IDs once for all badges', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      const batchDto = {
        badges: [
          { ...createMockBadgeDto('TEST-1'), groupIds: [1, 2] },
          { ...createMockBadgeDto('TEST-2'), groupIds: [2, 3] },
        ],
      };

      // Return only 2 groups when 3 unique are requested (1, 2, 3)
      mockGroupRepository.getAll.mockResolvedValue([
        { id: 1 },
        { id: 2 },
      ] as any);

      await expect(service.createBadgesBatch(batchDto as any)).rejects.toThrow(
        NotFoundException,
      );

      // Should call getAll once with all unique group IDs
      expect(mockGroupRepository.getAll).toHaveBeenCalledTimes(1);
    });

    it('should create all badges in a single transaction', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      const batchDto = {
        badges: [createMockBadgeDto('TEST-1'), createMockBadgeDto('TEST-2')],
      };

      mockGroupRepository.getAll.mockResolvedValue([{ id: 1 }] as any);

      const mockBadgeRepo = {
        create: jest.fn((dto) => ({ ...dto, id: `id-${dto.code}` })),
        save: jest.fn((entities) =>
          entities.map((e: any) => ({ ...e, status: BadgeStatus.DRAFT })),
        ),
      };
      const mockBadgeGroupRepo = {
        create: jest.fn((entity) => entity),
        save: jest.fn(),
      };

      (mockDataSource.transaction as jest.Mock).mockImplementation(
        async (cb: any) => {
          return cb({
            getRepository: (entity: any) => {
              if (entity.name === 'Badge') return mockBadgeRepo;
              if (entity.name === 'BadgeGroup') return mockBadgeGroupRepo;
              return {};
            },
          });
        },
      );

      const result = await service.createBadgesBatch(batchDto as any);

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(result.ids).toHaveLength(2);
      expect(mockBadgeRepo.save).toHaveBeenCalledTimes(1);
      expect(mockBadgeGroupRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});

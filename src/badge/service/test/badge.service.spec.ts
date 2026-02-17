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
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';

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
  let mockAppConfigService: jest.Mocked<AppConfigService>;
  let mockS3Service: jest.Mocked<S3Service>;

  beforeEach(async () => {
    mockBadgeRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      getAllBadges: jest.fn().mockResolvedValue([[], 0]),
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
      getGroupNamesByBadgeIds: jest.fn().mockResolvedValue(new Map()),
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
      find: jest.fn(),
    } as any;

    mockDataSource = {
      transaction: jest.fn(),
    } as any;

    mockAppConfigService = {} as any;
    mockS3Service = {} as any;

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
        { provide: AppConfigService, useValue: mockAppConfigService },
        { provide: S3Service, useValue: mockS3Service },
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
        name: 'Test Badge',
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

  describe('getAllBadges', () => {
    it('should return data and count from repository', async () => {
      const pagination = {
        limit: 10,
        offset: 0,
        sortBy: 'createdAt',
        order: 'DESC' as const,
      };
      const badges = [{ id: 'badge-1', name: 'Badge 1' }] as Badge[];
      mockBadgeRepository.getAllBadges.mockResolvedValue([badges, 1]);
      mockBadgeGroupRepository.getGroupNamesByBadgeIds.mockResolvedValue(
        new Map(),
      );

      const result = await service.getAllBadges(pagination);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 'badge-1',
        name: 'Badge 1',
      });
      expect(result.data[0].roles).toEqual([]);
      expect(result.count).toBe(1);
      expect(mockBadgeRepository.getAllBadges).toHaveBeenCalledWith(
        pagination,
        undefined,
      );
    });

    it('should return empty data and zero count when no badges', async () => {
      mockBadgeRepository.getAllBadges.mockResolvedValue([[], 0]);

      const result = await service.getAllBadges({});

      expect(result).toEqual({ data: [], count: 0 });
    });

    it('should attach group names as roles to each badge', async () => {
      const badges = [{ id: 'badge-1', name: 'Badge 1' }] as Badge[];
      mockBadgeRepository.getAllBadges.mockResolvedValue([badges, 1]);
      mockBadgeGroupRepository.getGroupNamesByBadgeIds.mockResolvedValue(
        new Map([['badge-1', ['Admin', 'Manager']]]),
      );

      const result = await service.getAllBadges({});

      expect(result.data[0].roles).toEqual(['Admin', 'Manager']);
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
        name: 'New Name',
        // other fields undefined
      };

      const result = (service as any).buildBadgeUpdateData(updateDto);

      expect(result).toEqual({
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

    it('should soft-delete badge and related records in a transaction', async () => {
      const badge = { id: 'badge-1', name: 'Test Badge' } as Badge;
      mockBadgeRepository.findOne.mockResolvedValue(badge);
      (mockDataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (entityManager: any) => Promise<boolean>) => cb({
          getRepository: jest.fn().mockReturnValue({
            softDelete: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      );

      const result = await service.deleteBadge('badge-1');

      expect(result).toBe(true);
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteBadgesBatch', () => {
    it('should throw BadRequestException when badgeIds is empty', async () => {
      await expect(service.deleteBadgesBatch([])).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deleteBadgesBatch([])).rejects.toThrow(
        'No badge IDs provided',
      );
    });

    it('should throw NotFoundException when one or more badges do not exist', async () => {
      mockBadgeRepository.find.mockResolvedValue([
        { id: '30303d05-19ef-45e5-b52c-7fdc6e4df26c' },
      ] as Badge[]);

      await expect(
        service.deleteBadgesBatch([
          '30303d05-19ef-45e5-b52c-7fdc6e4df26c',
          '3976395a-cf59-417d-8e2d-0beee7a7687e',
        ]),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.deleteBadgesBatch([
          '30303d05-19ef-45e5-b52c-7fdc6e4df26c',
          '3976395a-cf59-417d-8e2d-0beee7a7687e',
        ]),
      ).rejects.toThrow('One or more badges not found');
    });

    it('should soft-delete all badges and related records in a transaction', async () => {
      const badgeIds = [
        '30303d05-19ef-45e5-b52c-7fdc6e4df26c',
        '3976395a-cf59-417d-8e2d-0beee7a7687e',
      ];
      mockBadgeRepository.find.mockResolvedValue(
        badgeIds.map((id) => ({ id })) as Badge[],
      );
      const mockSoftDelete = jest.fn().mockResolvedValue(undefined);
      (mockDataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (entityManager: any) => Promise<boolean>) =>
          cb({
            getRepository: jest.fn().mockReturnValue({
              softDelete: mockSoftDelete,
            }),
          }),
      );

      const result = await service.deleteBadgesBatch(badgeIds);

      expect(result).toBe(true);
      expect(mockBadgeRepository.find).toHaveBeenCalledWith({
        where: { id: expect.anything() },
      });
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockSoftDelete).toHaveBeenCalledTimes(4); // BadgeTenant, BadgeUser, BadgeGroup, Badge
    });
  });

  describe('createBadgesBatch', () => {
    const createMockBadgeDto = (name: string) => ({
      name,
      description: 'Test description',
      imageUrl: 'https://example.com/badge.png',
      category: 'SIMULATION_MINUTES',
      achievementParams: { count: 10 },
      groupIds: [1],
      tenantIds: [],
    });

    it('should validate all badges have mandatory fields for ACTIVE status', async () => {
      const batchDto = {
        badges: [
          {
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
          { ...createMockBadgeDto('Test Badge 1'), groupIds: [1, 2] },
          { ...createMockBadgeDto('Test Badge 2'), groupIds: [2, 3] },
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
        badges: [
          createMockBadgeDto('Test Badge 1'),
          createMockBadgeDto('Test Badge 2'),
        ],
      };

      mockGroupRepository.getAll.mockResolvedValue([{ id: 1 }] as any);

      const mockBadgeRepo = {
        create: jest.fn((dto) => ({ ...dto, id: `id-${dto.name}` })),
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

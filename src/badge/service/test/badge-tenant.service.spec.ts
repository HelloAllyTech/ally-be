import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BadgeTenantService } from '../badge-tenant.service';
import { BadgeTenant } from '../../entity/badge-tenant.entity';
import { Badge } from '../../entity/badge.entity';
import { TenantsRepository } from 'src/tenant/repository/tenant.repository';
import {
  BadgeStatus,
  BadgeVisibilityType,
} from '../../constants/badge.constants';

describe('BadgeTenantService', () => {
  let service: BadgeTenantService;
  let mockBadgeTenantRepository: jest.Mocked<Repository<BadgeTenant>>;
  let mockBadgeRepository: jest.Mocked<Repository<Badge>>;
  let mockTenantsRepository: jest.Mocked<TenantsRepository>;

  beforeEach(async () => {
    mockBadgeTenantRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((entity) => entity as BadgeTenant),
      save: jest.fn(),
      softDelete: jest.fn(),
    } as any;

    mockBadgeRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    } as any;

    mockTenantsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgeTenantService,
        {
          provide: getRepositoryToken(BadgeTenant),
          useValue: mockBadgeTenantRepository,
        },
        {
          provide: getRepositoryToken(Badge),
          useValue: mockBadgeRepository,
        },
        {
          provide: TenantsRepository,
          useValue: mockTenantsRepository,
        },
      ],
    }).compile();

    service = module.get<BadgeTenantService>(BadgeTenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addBadgeToTenants', () => {
    it('should throw NotFoundException when badge does not exist', async () => {
      mockBadgeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.addBadgeToTenants('badge-1', ['tenant-1']),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when badge is not active', async () => {
      mockBadgeRepository.findOne.mockResolvedValue({
        id: 'badge-1',
        status: BadgeStatus.DRAFT,
      } as Badge);

      await expect(
        service.addBadgeToTenants('badge-1', ['tenant-1']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when some tenants do not exist', async () => {
      mockBadgeRepository.findOne.mockResolvedValue({
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge);
      mockTenantsRepository.find.mockResolvedValue([{ id: 'tenant-1' }] as any);

      await expect(
        service.addBadgeToTenants('badge-1', ['tenant-1', 'tenant-2']),
      ).rejects.toThrow(NotFoundException);
    });

    it('should filter out existing badge-tenant mappings', async () => {
      mockBadgeRepository.findOne.mockResolvedValue({
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge);
      mockTenantsRepository.find.mockResolvedValue([
        { id: 'tenant-1' },
        { id: 'tenant-2' },
        { id: 'tenant-3' },
      ] as any);
      mockBadgeTenantRepository.find.mockResolvedValue([
        { badgeId: 'badge-1', tenantId: 'tenant-1' },
      ] as BadgeTenant[]);
      mockBadgeTenantRepository.save.mockResolvedValue([] as any);

      await service.addBadgeToTenants('badge-1', [
        'tenant-1',
        'tenant-2',
        'tenant-3',
      ]);

      expect(mockBadgeTenantRepository.save).toHaveBeenCalledWith([
        { badgeId: 'badge-1', tenantId: 'tenant-2' },
        { badgeId: 'badge-1', tenantId: 'tenant-3' },
      ]);
    });

    it('should not call save when all mappings already exist', async () => {
      mockBadgeRepository.findOne.mockResolvedValue({
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge);
      mockTenantsRepository.find.mockResolvedValue([{ id: 'tenant-1' }] as any);
      mockBadgeTenantRepository.find.mockResolvedValue([
        { badgeId: 'badge-1', tenantId: 'tenant-1' },
      ] as BadgeTenant[]);

      const result = await service.addBadgeToTenants('badge-1', ['tenant-1']);

      expect(result).toBe(true);
      expect(mockBadgeTenantRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('assignBadgeToTenants', () => {
    it('should assign to all tenants when badge is PUBLIC', async () => {
      const badge = {
        id: 'badge-1',
        visibilityType: BadgeVisibilityType.PUBLIC,
      } as Badge;
      mockTenantsRepository.find.mockResolvedValue([
        { id: 'tenant-1' },
        { id: 'tenant-2' },
      ] as any);
      mockBadgeTenantRepository.save.mockResolvedValue([] as any);

      const result = await service.assignBadgeToTenants(badge);

      expect(mockTenantsRepository.find).toHaveBeenCalled();
      expect(result).toEqual(['tenant-1', 'tenant-2']);
    });

    it('should assign to specified tenants when badge is PRIVATE', async () => {
      const badge = {
        id: 'badge-1',
        visibilityType: BadgeVisibilityType.PRIVATE,
      } as Badge;
      mockBadgeTenantRepository.save.mockResolvedValue([] as any);

      const result = await service.assignBadgeToTenants(badge, [
        'tenant-1',
        'tenant-2',
      ]);

      expect(mockTenantsRepository.find).not.toHaveBeenCalled();
      expect(result).toEqual(['tenant-1', 'tenant-2']);
    });

    it('should return empty array on error', async () => {
      const badge = {
        id: 'badge-1',
        visibilityType: BadgeVisibilityType.PUBLIC,
      } as Badge;
      mockTenantsRepository.find.mockRejectedValue(new Error('DB error'));

      const result = await service.assignBadgeToTenants(badge);

      expect(result).toEqual([]);
    });
  });

  describe('getTenantIdsForBadge', () => {
    it('should return tenant IDs from badge-tenant mappings', async () => {
      mockBadgeTenantRepository.find.mockResolvedValue([
        { badgeId: 'badge-1', tenantId: 'tenant-1' },
        { badgeId: 'badge-1', tenantId: 'tenant-2' },
      ] as BadgeTenant[]);

      const result = await service.getTenantIdsForBadge('badge-1');

      expect(result).toEqual(['tenant-1', 'tenant-2']);
    });

    it('should return empty array when no mappings exist', async () => {
      mockBadgeTenantRepository.find.mockResolvedValue([]);

      const result = await service.getTenantIdsForBadge('badge-1');

      expect(result).toEqual([]);
    });
  });

  describe('removeBadgeFromTenants', () => {
    it('should return early when tenantIds array is empty', async () => {
      await service.removeBadgeFromTenants('badge-1', []);

      expect(mockBadgeTenantRepository.softDelete).not.toHaveBeenCalled();
    });

    it('should soft delete badge-tenant mappings', async () => {
      mockBadgeTenantRepository.softDelete.mockResolvedValue({} as any);

      await service.removeBadgeFromTenants('badge-1', ['tenant-1', 'tenant-2']);

      expect(mockBadgeTenantRepository.softDelete).toHaveBeenCalledWith({
        badgeId: 'badge-1',
        tenantId: expect.anything(),
      });
    });
  });

  describe('updateBadgeTenants', () => {
    it('should return empty array when tenantIds is empty', async () => {
      const result = await service.updateBadgeTenants('badge-1', []);

      expect(result).toEqual([]);
      expect(mockBadgeTenantRepository.find).not.toHaveBeenCalled();
    });

    it('should filter out existing mappings and only add new ones', async () => {
      mockBadgeTenantRepository.find.mockResolvedValue([
        { badgeId: 'badge-1', tenantId: 'tenant-1' },
      ] as BadgeTenant[]);
      mockBadgeTenantRepository.save.mockResolvedValue([] as any);

      const result = await service.updateBadgeTenants('badge-1', [
        'tenant-1',
        'tenant-2',
        'tenant-3',
      ]);

      expect(result).toEqual(['tenant-2', 'tenant-3']);
      expect(mockBadgeTenantRepository.save).toHaveBeenCalledWith([
        { badgeId: 'badge-1', tenantId: 'tenant-2' },
        { badgeId: 'badge-1', tenantId: 'tenant-3' },
      ]);
    });

    it('should not call save when all tenants already have the badge', async () => {
      mockBadgeTenantRepository.find.mockResolvedValue([
        { badgeId: 'badge-1', tenantId: 'tenant-1' },
        { badgeId: 'badge-1', tenantId: 'tenant-2' },
      ] as BadgeTenant[]);

      const result = await service.updateBadgeTenants('badge-1', [
        'tenant-1',
        'tenant-2',
      ]);

      expect(result).toEqual([]);
      expect(mockBadgeTenantRepository.save).not.toHaveBeenCalled();
    });
  });
});

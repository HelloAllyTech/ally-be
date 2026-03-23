import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BadgeTenantService } from '../badge-tenant.service';
import { BadgeTenant } from '../../entity/badge-tenant.entity';
import { Badge } from '../../entity/badge.entity';
import { TenantsRepository } from 'src/tenant/repository/tenant.repository';
import { BadgeUserService } from '../badge-user.service';
import {
  BadgeStatus,
  BadgeVisibilityType,
} from '../../constants/badge.constants';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { AdminTenantService } from 'src/user/service/admin-tenant.service';
import {
  AUDIT_EVENTS,
  AUDIT_ACTIONS,
} from 'src/audit/constants/audit-event.constants';

describe('BadgeTenantService', () => {
  let service: BadgeTenantService;
  let mockBadgeTenantRepository: jest.Mocked<Repository<BadgeTenant>>;
  let mockBadgeRepository: jest.Mocked<Repository<Badge>>;
  let mockTenantsRepository: jest.Mocked<TenantsRepository>;
  let mockBadgeUserService: jest.Mocked<
    Pick<BadgeUserService, 'awardBadgeToUsersByTenant'>
  >;
  let mockAuditLogService: jest.Mocked<Pick<AuditLogService, 'log'>>;
  let mockPermissionsService: jest.Mocked<
    Pick<PermissionsService, 'isMultiTenantAdmin'>
  >;
  let mockAdminTenantService: jest.Mocked<
    Pick<AdminTenantService, 'getTenantsForAdmin'>
  >;

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

    mockBadgeUserService = {
      awardBadgeToUsersByTenant: jest.fn().mockResolvedValue(undefined),
    };

    mockAuditLogService = {
      log: jest.fn(),
    } as any;

    mockPermissionsService = {
      isMultiTenantAdmin: jest.fn().mockResolvedValue(false),
    } as any;

    mockAdminTenantService = {
      getTenantsForAdmin: jest.fn(),
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
        {
          provide: BadgeUserService,
          useValue: mockBadgeUserService,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: AdminTenantService,
          useValue: mockAdminTenantService,
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
        service.addBadgeToTenants('badge-1', ['tenant-1'], 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when badge is not active', async () => {
      mockBadgeRepository.findOne.mockResolvedValue({
        id: 'badge-1',
        status: BadgeStatus.DRAFT,
      } as Badge);

      await expect(
        service.addBadgeToTenants('badge-1', ['tenant-1'], 1),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when some tenants do not exist', async () => {
      mockBadgeRepository.findOne.mockResolvedValue({
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge);
      mockTenantsRepository.find.mockResolvedValue([{ id: 'tenant-1' }] as any);

      await expect(
        service.addBadgeToTenants('badge-1', ['tenant-1', 'tenant-2'], 1),
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

      await service.addBadgeToTenants(
        'badge-1',
        ['tenant-1', 'tenant-2', 'tenant-3'],
        1,
      );

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

      const result = await service.addBadgeToTenants(
        'badge-1',
        ['tenant-1'],
        1,
      );

      expect(result).toBe(true);
      expect(mockBadgeTenantRepository.save).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when multi-tenant admin assigns to unauthorized tenant', async () => {
      mockBadgeRepository.findOne.mockResolvedValue({
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge);
      mockPermissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      mockAdminTenantService.getTenantsForAdmin.mockResolvedValue({
        data: [{ id: 'tenant-1' }],
      } as any);

      await expect(
        service.addBadgeToTenants(
          'badge-1',
          ['tenant-1', 'unauthorized-tenant'],
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should assign badge to tenants and log audit event for multi-tenant admin', async () => {
      mockBadgeRepository.findOne.mockResolvedValue({
        id: 'badge-1',
        status: BadgeStatus.ACTIVE,
      } as Badge);
      mockTenantsRepository.find.mockResolvedValue([{ id: 'tenant-1' }] as any);
      mockBadgeTenantRepository.find.mockResolvedValue([]);
      const savedBadgeTenant = { badgeId: 'badge-1', tenantId: 'tenant-1' };
      mockBadgeTenantRepository.save.mockResolvedValue([
        savedBadgeTenant,
      ] as any);

      mockPermissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      mockAdminTenantService.getTenantsForAdmin.mockResolvedValue({
        data: [{ id: 'tenant-1' }],
      } as any);

      await service.addBadgeToTenants('badge-1', ['tenant-1'], 1);

      expect(mockAdminTenantService.getTenantsForAdmin).toHaveBeenCalledWith(1);
      expect(mockBadgeTenantRepository.save).toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith({
        eventType: AUDIT_EVENTS.MULTI_TENANT_ADMIN_ASSIGNED_BADGE_TO_TENANT,
        details: {
          action: AUDIT_ACTIONS.ASSIGN_BADGE_TO_TENANT,
          tenantIdsToAdd: ['tenant-1'],
          userId: 1,
          badgeId: 'badge-1',
        },
      });
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
      await service.removeBadgeFromTenants('badge-1', [], 1);

      expect(mockBadgeTenantRepository.softDelete).not.toHaveBeenCalled();
    });

    it('should soft delete badge-tenant mappings', async () => {
      mockBadgeTenantRepository.softDelete.mockResolvedValue({} as any);

      await service.removeBadgeFromTenants(
        'badge-1',
        ['tenant-1', 'tenant-2'],
        1,
      );

      expect(mockBadgeTenantRepository.softDelete).toHaveBeenCalledWith({
        badgeId: 'badge-1',
        tenantId: In(['tenant-1', 'tenant-2']),
      });
    });

    it('should throw BadRequestException when multi-tenant admin removes from unauthorized tenant', async () => {
      mockPermissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      mockAdminTenantService.getTenantsForAdmin.mockResolvedValue({
        data: [{ id: 'tenant-1' }],
      } as any);

      await expect(
        service.removeBadgeFromTenants(
          'badge-1',
          ['tenant-1', 'unauthorized-tenant'],
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should soft delete mappings and log audit event for multi-tenant admin', async () => {
      mockBadgeTenantRepository.softDelete.mockResolvedValue({} as any);
      mockPermissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      mockAdminTenantService.getTenantsForAdmin.mockResolvedValue({
        data: [
          { id: 'tenant-1', name: 'Tenant 1' },
          { id: 'tenant-2', name: 'Tenant 2' },
        ],
      } as any);

      await service.removeBadgeFromTenants(
        'badge-1',
        ['tenant-1', 'tenant-2'],
        1,
      );

      expect(mockBadgeTenantRepository.softDelete).toHaveBeenCalledWith({
        badgeId: 'badge-1',
        tenantId: In(['tenant-1', 'tenant-2']),
      });
      expect(mockAuditLogService.log).toHaveBeenCalledWith({
        eventType: AUDIT_EVENTS.MULTI_TENANT_ADMIN_REMOVED_BADGE_FROM_TENANT,
        details: {
          action: AUDIT_ACTIONS.REMOVE_BADGE_FROM_TENANT,
          tenantIds: ['tenant-1', 'tenant-2'],
          badgeId: 'badge-1',
          userId: 1,
        },
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

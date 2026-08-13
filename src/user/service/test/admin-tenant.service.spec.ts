import { Test, TestingModule } from '@nestjs/testing';
import { AdminTenantService } from '../admin-tenant.service';
import { AdminTenantRepository } from '../../repository/admin-tenant.repository';
import { UserRepository } from '../../repository/user.repository';
import { TenantService } from 'src/tenant/service/tenant.service';
import { GroupService } from 'src/authorization/service/group.service';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/constants/user.constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AssignAdminTenantsDto,
  RemoveAdminTenantsDto,
} from '../../dto/admin-tenant.dto';

describe('AdminTenantService', () => {
  let service: AdminTenantService;
  let mockAdminTenantRepository: any;
  let mockUserRepository: any;
  let mockTenantService: any;
  let mockGroupService: any;

  const mockUser = {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.com',
  };

  const mockTenant = {
    id: 'tenant-1',
    name: 'Test Tenant',
  };

  beforeEach(async () => {
    mockAdminTenantRepository = {
      findByUserId: jest.fn(),
      findByUserIdAndTenantIds: jest.fn(),
      findByUserIdAndTenantIdsIncludingDeleted: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softRemove: jest.fn(),
      recover: jest.fn(),
    };

    mockUserRepository = {
      findOne: jest.fn(),
    };

    mockTenantService = {
      findById: jest.fn(),
    };

    mockGroupService = {
      getUserRolesByUserId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminTenantService,
        { provide: AdminTenantRepository, useValue: mockAdminTenantRepository },
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: TenantService, useValue: mockTenantService },
        { provide: GroupService, useValue: mockGroupService },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    service = module.get<AdminTenantService>(AdminTenantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assignTenants', () => {
    const dto: AssignAdminTenantsDto = {
      userId: 1,
      tenantIds: ['tenant-1'],
    };

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.assignTenants(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user is not PLATFORM_ADMIN', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockGroupService.getUserRolesByUserId.mockResolvedValue([
        { name: UserRole.CLIENT },
      ]);
      await expect(service.assignTenants(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if tenant not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockGroupService.getUserRolesByUserId.mockResolvedValue([
        { name: UserRole.PLATFORM_ADMIN },
      ]);
      mockTenantService.findById.mockResolvedValue(null);
      await expect(service.assignTenants(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create new mappings and restore soft-deleted ones', async () => {
      const tenantIds = ['tenant-1', 'tenant-2', 'tenant-3'];
      const multiDto: AssignAdminTenantsDto = { userId: 1, tenantIds };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockGroupService.getUserRolesByUserId.mockResolvedValue([
        { name: UserRole.PLATFORM_ADMIN },
      ]);
      mockTenantService.findById.mockResolvedValue(mockTenant);

      // Existing mappings:
      // tenant-1: active (should skip)
      // tenant-2: soft-deleted (should restore)
      // tenant-3: none exists (should create)
      const existingAll = [
        { tenantId: 'tenant-1', deletedAt: null },
        { tenantId: 'tenant-2', deletedAt: new Date() },
      ];
      mockAdminTenantRepository.findByUserIdAndTenantIdsIncludingDeleted.mockResolvedValue(
        existingAll,
      );
      mockAdminTenantRepository.create.mockReturnValue({
        userId: 1,
        tenantId: 'tenant-3',
      });

      const result = await service.assignTenants(multiDto);

      expect(result).toEqual({ success: true });
      expect(mockAdminTenantRepository.recover).toHaveBeenCalledWith([
        expect.objectContaining({ tenantId: 'tenant-2', deletedAt: undefined }),
      ]);
      expect(mockAdminTenantRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ tenantId: 'tenant-3' }),
      ]);
    });

    it('should be idempotent if mappings already active', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockGroupService.getUserRolesByUserId.mockResolvedValue([
        { name: UserRole.PLATFORM_ADMIN },
      ]);
      mockTenantService.findById.mockResolvedValue(mockTenant);

      const existingAll = [{ tenantId: 'tenant-1', deletedAt: null }];
      mockAdminTenantRepository.findByUserIdAndTenantIdsIncludingDeleted.mockResolvedValue(
        existingAll,
      );

      const result = await service.assignTenants(dto);

      expect(result).toEqual({ success: true });
      expect(mockAdminTenantRepository.recover).not.toHaveBeenCalled();
      expect(mockAdminTenantRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('removeTenants', () => {
    const dto: RemoveAdminTenantsDto = {
      userId: 1,
      tenantIds: ['tenant-1'],
    };

    it('should throw NotFoundException if no active mappings found', async () => {
      mockAdminTenantRepository.findByUserIdAndTenantIds.mockResolvedValue([]);
      await expect(service.removeTenants(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should soft-remove existing mappings', async () => {
      const mappings = [{ userId: 1, tenantId: 'tenant-1' }];
      mockAdminTenantRepository.findByUserIdAndTenantIds.mockResolvedValue(
        mappings,
      );

      const result = await service.removeTenants(dto);

      expect(result).toEqual({ success: true });
      expect(mockAdminTenantRepository.softRemove).toHaveBeenCalledWith(
        mappings,
      );
    });
  });

  describe('getTenantsForAdmin', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.getTenantsForAdmin(1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return mapped tenants', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockAdminTenantRepository.findByUserId.mockResolvedValue([
        { tenantId: 'tenant-1' },
      ]);
      mockTenantService.findById.mockResolvedValue(mockTenant);

      const result = await service.getTenantsForAdmin(1);

      expect(result).toEqual({ data: [mockTenant], count: 1 });
      expect(mockTenantService.findById).toHaveBeenCalledWith('tenant-1');
    });

    it('should return empty list if no mappings exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockAdminTenantRepository.findByUserId.mockResolvedValue([]);

      const result = await service.getTenantsForAdmin(1);

      expect(result).toEqual({ data: [], count: 0 });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { TenantController } from '../tenant.controller';
import { TenantService } from '../../service/tenant.service';
import { Tenant, TenantStatus } from '../../entity/tenant.entity';
import { CreateTenantDto } from '../../dto/create-tenant.dto';
import { UpdateTenantStatusDto } from '../../dto/update-tenant-status.dto';
import { UpdateTenantSettingsDto } from '../../dto/update-tenant-settings.dto';
import { UpdateTenantMetadataDto } from '../../dto/update-tenant-metadata.dto';
import { UpdateTenantDto } from '../../dto/update-tenant.dto';
import { GetAllTenantsResponseDto } from '../../dto/get-tenants.dto';
import { TenantSortBy } from '../../enum/tenant.enum';
import { SortOrder } from '../../../user/enum/user.enum';
import { TenantResponseDto } from '../../dto/tenant-response.dto';
import { ForbiddenException } from '@nestjs/common';
import { TenantScopeService } from '../../../authorization/service/tenant-scope.service';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';

jest.mock('../../../auth/decorators/auth-permissions.decorator', () => ({
  AuthPermissions: () => () => {},
}));

describe('TenantController', () => {
  let controller: TenantController;
  let tenantService: jest.Mocked<TenantService>;
  let mockPermissionsService: {
    isMultiTenantAdmin: jest.Mock;
    getUserPermissions: jest.Mock;
  };
  const ALLOWED_TENANT_ID = 'allowed-tenant-id';

  const mockTenant: Tenant = {
    id: 'test-tenant-id',
    name: 'Test Tenant',
    code: 'test-tenant',
    description: 'Test tenant description',
    status: TenantStatus.ACTIVE,
    isTestOrganization: false,
    metadata: { key: 'value' },
    settings: { setting: 'value' },
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
    deletedAt: undefined,
    createdBy: undefined,
    updatedBy: undefined,
  };

  const mockTenantResponse: TenantResponseDto = {
    ...mockTenant,
    enabledDashboardIds: [],
    hideRankInCommunity: false,
    engagementReminderEnabled: false,
    enableAudioUpload: true,
    enableMicrophoneMode: true,
    enableDictationMode: true,
  };

  const mockTenantWithUserCount = {
    ...mockTenant,
    userCount: 5,
    enabledDashboardIds: [],
    hideRankInCommunity: false,
    engagementReminderEnabled: false,
    enableAudioUpload: true,
    enableMicrophoneMode: true,
    enableDictationMode: true,
  };

  const mockTenantListItem = {
    ...mockTenant,
    userCount: 5,
    enabledDashboardIds: [],
    hideRankInCommunity: false,
    engagementReminderEnabled: false,
    enableAudioUpload: true,
    enableMicrophoneMode: true,
  };

  const mockCreateTenantDto: CreateTenantDto = {
    name: 'New Tenant',
    code: 'new-tenant',
    description: 'New tenant description',
    metadata: { key: 'value' },
    settings: { setting: 'value' },
  };

  beforeEach(async () => {
    const mockTenantService = {
      create: jest.fn(),
      findById: jest.fn(),
      findByCode: jest.fn(),
      updateStatus: jest.fn(),
      updateSettings: jest.fn(),
      updateMetadata: jest.fn(),
      getAllTenants: jest.fn(),
      updateTenant: jest.fn(),
      findTenantIdsUsingLogo: jest.fn(),
      deleteOrganizationLogo: jest.fn(),
    };

    // The real resolver: an unrestricted platform admin unless a test makes
    // them allowlisted, in which case they hold ALLOWED_TENANT_ID only.
    mockPermissionsService = {
      isMultiTenantAdmin: jest.fn().mockResolvedValue(false),
      getUserPermissions: jest
        .fn()
        .mockResolvedValue([PERMISSIONS.SYSTEM_ACCESS]),
    };
    const tenantScopeService = new TenantScopeService(
      mockPermissionsService as any,
      {
        find: jest.fn().mockResolvedValue([{ tenantId: ALLOWED_TENANT_ID }]),
      } as any,
      {
        find: jest.fn().mockResolvedValue([{ id: ALLOWED_TENANT_ID }]),
        findOne: jest.fn(async ({ where }) =>
          where.code === 'allowed-code' ? { id: ALLOWED_TENANT_ID } : null,
        ),
      } as any,
    );
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('1');

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
        {
          provide: TenantScopeService,
          useValue: tenantScopeService,
        },
      ],
    }).compile();

    controller = module.get<TenantController>(TenantController);
    tenantService = module.get(TenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('as a platform admin restricted to one organization', () => {
    beforeEach(() => {
      mockPermissionsService.isMultiTenantAdmin.mockResolvedValue(true);
    });

    it('refuses to create an organization', async () => {
      await expect(controller.create(mockCreateTenantDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(tenantService.create).not.toHaveBeenCalled();
    });

    it('reads an allowlisted organization by id and by code', async () => {
      tenantService.findById.mockResolvedValue(mockTenantResponse);
      tenantService.findByCode.mockResolvedValue(mockTenantResponse);

      await expect(controller.findById(ALLOWED_TENANT_ID)).resolves.toBe(
        mockTenantResponse,
      );
      await expect(controller.findByCode('allowed-code')).resolves.toBe(
        mockTenantResponse,
      );
    });

    it('refuses to read another organization by id or by code', async () => {
      await expect(controller.findById('other-tenant-id')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(controller.findByCode('other-code')).rejects.toThrow(
        ForbiddenException,
      );
      expect(tenantService.findById).not.toHaveBeenCalled();
      expect(tenantService.findByCode).not.toHaveBeenCalled();
    });

    it("refuses to delete another organization's logo", async () => {
      tenantService.findTenantIdsUsingLogo.mockResolvedValue([
        'other-tenant-id',
      ]);

      await expect(
        controller.deleteOrganizationLogo({
          logoUrl: 'https://b/org-logos/x.png',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(tenantService.deleteOrganizationLogo).not.toHaveBeenCalled();
    });

    it('deletes their own organization logo or an unreferenced upload', async () => {
      tenantService.deleteOrganizationLogo.mockResolvedValue({ success: true });

      tenantService.findTenantIdsUsingLogo.mockResolvedValueOnce([
        ALLOWED_TENANT_ID,
      ]);
      await controller.deleteOrganizationLogo({
        logoUrl: 'https://b/mine.png',
      });

      tenantService.findTenantIdsUsingLogo.mockResolvedValueOnce([]);
      await controller.deleteOrganizationLogo({
        logoUrl: 'https://b/orphan.png',
      });

      expect(tenantService.deleteOrganizationLogo).toHaveBeenCalledTimes(2);
    });

    it.each([
      [
        'updateStatus',
        (id: string) =>
          controller.updateStatus(id, { status: TenantStatus.SUSPENDED }),
      ],
      [
        'updateSettings',
        (id: string) => controller.updateSettings(id, { settings: {} }),
      ],
      [
        'updateMetadata',
        (id: string) => controller.updateMetadata(id, { metadata: {} }),
      ],
      [
        'updateTenant',
        (id: string) => controller.updateTenant(id, { name: 'Renamed' }),
      ],
    ] as const)(
      '%s: allows an allowlisted organization and refuses any other',
      async (method, call) => {
        await expect(call('other-tenant-id')).rejects.toThrow(
          ForbiddenException,
        );
        expect(tenantService[method]).not.toHaveBeenCalled();

        await call(ALLOWED_TENANT_ID);
        expect(tenantService[method]).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('create', () => {
    it('should create a new tenant with ACTIVE status', async () => {
      const expectedTenant = { ...mockTenant, ...mockCreateTenantDto };
      tenantService.create.mockResolvedValue(expectedTenant);

      const result = await controller.create(mockCreateTenantDto);

      expect(tenantService.create).toHaveBeenCalledWith(
        mockCreateTenantDto,
        TenantStatus.ACTIVE,
      );
      expect(result).toEqual(expectedTenant);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      tenantService.create.mockRejectedValue(error);

      await expect(controller.create(mockCreateTenantDto)).rejects.toThrow(
        'Service error',
      );
    });
  });

  describe('findById', () => {
    it('should return tenant by ID', async () => {
      tenantService.findById.mockResolvedValue(mockTenantResponse);
      const result = await controller.findById('test-tenant-id');

      expect(tenantService.findById).toHaveBeenCalledWith('test-tenant-id', {
        includeUserCount: undefined,
      });
      expect(result).toEqual(mockTenantResponse);
    });

    it('should call service with includeUserCount when query param is true', async () => {
      tenantService.findById.mockResolvedValue(mockTenantWithUserCount);
      const result = await controller.findById('test-tenant-id', true);

      expect(tenantService.findById).toHaveBeenCalledWith('test-tenant-id', {
        includeUserCount: true,
      });
      expect(result).toEqual(mockTenantWithUserCount);
      expect(result).toHaveProperty('userCount', 5);
    });

    it('should return null when not found', async () => {
      tenantService.findById.mockResolvedValue(null);
      const result = await controller.findById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('findByCode', () => {
    it('should return tenant by code', async () => {
      tenantService.findByCode.mockResolvedValue(mockTenantResponse);
      const result = await controller.findByCode('test-tenant');

      expect(tenantService.findByCode).toHaveBeenCalledWith('test-tenant');
      expect(result).toEqual(mockTenantResponse);
    });

    it('should return null when not found', async () => {
      tenantService.findByCode.mockResolvedValue(null);
      const result = await controller.findByCode('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update tenant status', async () => {
      const dto: UpdateTenantStatusDto = { status: TenantStatus.INACTIVE };
      const updatedTenant = { ...mockTenant, status: TenantStatus.INACTIVE };
      tenantService.updateStatus.mockResolvedValue(updatedTenant);

      const result = await controller.updateStatus('id1', dto);
      expect(tenantService.updateStatus).toHaveBeenCalledWith(
        'id1',
        TenantStatus.INACTIVE,
      );
      expect(result).toEqual(updatedTenant);
    });
  });

  describe('updateSettings', () => {
    it('should update tenant settings', async () => {
      const dto: UpdateTenantSettingsDto = { settings: { theme: 'dark' } };
      const updatedTenant = { ...mockTenant, settings: dto.settings };
      tenantService.updateSettings.mockResolvedValue(updatedTenant);

      const result = await controller.updateSettings('id1', dto);
      expect(tenantService.updateSettings).toHaveBeenCalledWith(
        'id1',
        dto.settings,
      );
      expect(result).toEqual(updatedTenant);
    });
  });

  describe('updateMetadata', () => {
    it('should update tenant metadata', async () => {
      const dto: UpdateTenantMetadataDto = { metadata: { plan: 'premium' } };
      const updatedTenant = { ...mockTenant, metadata: dto.metadata };
      tenantService.updateMetadata.mockResolvedValue(updatedTenant);

      const result = await controller.updateMetadata('id1', dto);
      expect(tenantService.updateMetadata).toHaveBeenCalledWith(
        'id1',
        dto.metadata,
      );
      expect(result).toEqual(updatedTenant);
    });
  });

  describe('getAllTenants', () => {
    it('should return list of tenants with correct properties', async () => {
      const response: GetAllTenantsResponseDto = {
        data: [mockTenantListItem],
        count: 1,
      };

      tenantService.getAllTenants.mockResolvedValue(response);

      const result = await controller.getAllTenants(
        10,
        0,
        TenantSortBy.NAME,
        SortOrder.ASC,
        'search',
      );

      expect(tenantService.getAllTenants).toHaveBeenCalledWith('search', {
        limit: 10,
        offset: 0,
        sortBy: TenantSortBy.NAME,
        order: SortOrder.ASC,
      });
      expect(result).toEqual(response);
    });

    it('should handle empty query params', async () => {
      const response: GetAllTenantsResponseDto = {
        data: [],
        count: 0,
      };
      tenantService.getAllTenants.mockResolvedValue(response);

      const result = await controller.getAllTenants();
      expect(tenantService.getAllTenants).toHaveBeenCalledWith(undefined, {
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: undefined,
      });
      expect(result).toEqual(response);
    });
  });

  describe('updateTenant', () => {
    it('should update tenant details', async () => {
      const dto: UpdateTenantDto = {
        name: 'Updated Tenant',
        description: 'Updated desc',
      };
      const updatedTenantResponse: TenantResponseDto = {
        ...mockTenantResponse,
        ...dto,
      };
      tenantService.updateTenant.mockResolvedValue(updatedTenantResponse);

      const result = await controller.updateTenant('id1', dto);

      expect(tenantService.updateTenant).toHaveBeenCalledWith('id1', dto);
      expect(result).toEqual(updatedTenantResponse);
    });

    it('should return null if tenant not found', async () => {
      const dto: UpdateTenantDto = { name: 'NoTenant' };
      tenantService.updateTenant.mockResolvedValue(null);

      const result = await controller.updateTenant('invalid', dto);
      expect(result).toBeNull();
    });
  });
});

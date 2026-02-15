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

jest.mock('../../../auth/decorators/auth-permissions.decorator', () => ({
  AuthPermissions: () => () => {},
}));

describe('TenantController', () => {
  let controller: TenantController;
  let tenantService: jest.Mocked<TenantService>;

  const mockTenant: Tenant = {
    id: 'test-tenant-id',
    name: 'Test Tenant',
    code: 'test-tenant',
    description: 'Test tenant description',
    status: TenantStatus.ACTIVE,
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
    hideRankInLeaderboard: false,
    enableAudioUpload: true,
    enableMicrophoneMode: true,
  };

  const mockTenantWithUserCount = {
    ...mockTenant,
    userCount: 5,
    enabledDashboardIds: [],
    hideRankInLeaderboard: false,
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
      getallTenants: jest.fn(),
      updateTenant: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
      ],
    }).compile();

    controller = module.get<TenantController>(TenantController);
    tenantService = module.get(TenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
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

      expect(tenantService.findById).toHaveBeenCalledWith('test-tenant-id');
      expect(result).toEqual(mockTenantResponse);
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
        data: [mockTenantWithUserCount],
        count: 1,
      };

      tenantService.getallTenants.mockResolvedValue(response);

      const result = await controller.getAllTenants(
        10,
        0,
        TenantSortBy.NAME,
        SortOrder.ASC,
        'search',
      );

      expect(tenantService.getallTenants).toHaveBeenCalledWith('search', {
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
      tenantService.getallTenants.mockResolvedValue(response);

      const result = await controller.getAllTenants();
      expect(tenantService.getallTenants).toHaveBeenCalledWith(undefined, {
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

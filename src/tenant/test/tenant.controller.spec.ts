import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { TenantController } from '../tenant.controller';
import { TenantService } from '../tenant.service';
import { Tenant, TenantStatus } from '../../common/entities/tenant.entity';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantStatusDto } from '../dto/update-tenant-status.dto';
import { UpdateTenantSettingsDto } from '../dto/update-tenant-settings.dto';
import { UpdateTenantMetadataDto } from '../dto/update-tenant-metadata.dto';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsService } from '../../authorization/service/permissions.service';

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
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn(),
    };

    const mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: Reflector,
          useValue: mockReflector,
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<TenantController>(TenantController);
    tenantService = module.get(TenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new tenant with ACTIVE status', async () => {
      const expectedTenant = {
        ...mockTenant,
        ...mockCreateTenantDto,
        status: TenantStatus.ACTIVE,
      };
      tenantService.create.mockResolvedValue(expectedTenant);

      const result = await controller.create(mockCreateTenantDto);

      expect(tenantService.create).toHaveBeenCalledWith({
        ...mockCreateTenantDto,
        status: TenantStatus.ACTIVE,
      });
      expect(result).toEqual(expectedTenant);
    });

    it('should handle service errors during tenant creation', async () => {
      const error = new Error('Service error');
      tenantService.create.mockRejectedValue(error);

      await expect(controller.create(mockCreateTenantDto)).rejects.toThrow(
        'Service error',
      );
    });
  });

  describe('findById', () => {
    it('should return tenant when found by ID', async () => {
      tenantService.findById.mockResolvedValue(mockTenant);

      const result = await controller.findById('test-tenant-id');

      expect(tenantService.findById).toHaveBeenCalledWith('test-tenant-id');
      expect(result).toEqual(mockTenant);
    });

    it('should return null when tenant not found by ID', async () => {
      tenantService.findById.mockResolvedValue(null);

      const result = await controller.findById('non-existent-id');

      expect(tenantService.findById).toHaveBeenCalledWith('non-existent-id');
      expect(result).toBeNull();
    });

    it('should handle service errors during findById', async () => {
      const error = new Error('Service error');
      tenantService.findById.mockRejectedValue(error);

      await expect(controller.findById('test-tenant-id')).rejects.toThrow(
        'Service error',
      );
    });
  });

  describe('findByCode', () => {
    it('should return tenant when found by code', async () => {
      tenantService.findByCode.mockResolvedValue(mockTenant);

      const result = await controller.findByCode('test-tenant');

      expect(tenantService.findByCode).toHaveBeenCalledWith('test-tenant');
      expect(result).toEqual(mockTenant);
    });

    it('should return null when tenant not found by code', async () => {
      tenantService.findByCode.mockResolvedValue(null);

      const result = await controller.findByCode('non-existent-code');

      expect(tenantService.findByCode).toHaveBeenCalledWith(
        'non-existent-code',
      );
      expect(result).toBeNull();
    });

    it('should handle service errors during findByCode', async () => {
      const error = new Error('Service error');
      tenantService.findByCode.mockRejectedValue(error);

      await expect(controller.findByCode('test-tenant')).rejects.toThrow(
        'Service error',
      );
    });
  });

  describe('updateStatus', () => {
    it('should update tenant status successfully', async () => {
      const updateStatusDto: UpdateTenantStatusDto = {
        status: TenantStatus.INACTIVE,
      };
      const updatedTenant = { ...mockTenant, status: TenantStatus.INACTIVE };
      tenantService.updateStatus.mockResolvedValue(updatedTenant);

      const result = await controller.updateStatus(
        'test-tenant-id',
        updateStatusDto,
      );

      expect(tenantService.updateStatus).toHaveBeenCalledWith(
        'test-tenant-id',
        TenantStatus.INACTIVE,
      );
      expect(result).toEqual(updatedTenant);
    });

    it('should return null when tenant not found for status update', async () => {
      const updateStatusDto: UpdateTenantStatusDto = {
        status: TenantStatus.INACTIVE,
      };
      tenantService.updateStatus.mockResolvedValue(null);

      const result = await controller.updateStatus(
        'non-existent-id',
        updateStatusDto,
      );

      expect(tenantService.updateStatus).toHaveBeenCalledWith(
        'non-existent-id',
        TenantStatus.INACTIVE,
      );
      expect(result).toBeNull();
    });

    it('should handle service errors during status update', async () => {
      const error = new Error('Service error');
      const updateStatusDto: UpdateTenantStatusDto = {
        status: TenantStatus.INACTIVE,
      };
      tenantService.updateStatus.mockRejectedValue(error);

      await expect(
        controller.updateStatus('test-tenant-id', updateStatusDto),
      ).rejects.toThrow('Service error');
    });
  });

  describe('updateSettings', () => {
    it('should update tenant settings successfully', async () => {
      const newSettings = { newSetting: 'newValue' };
      const updateSettingsDto: UpdateTenantSettingsDto = {
        settings: newSettings,
      };
      const updatedTenant = { ...mockTenant, settings: newSettings };
      tenantService.updateSettings.mockResolvedValue(updatedTenant);

      const result = await controller.updateSettings(
        'test-tenant-id',
        updateSettingsDto,
      );

      expect(tenantService.updateSettings).toHaveBeenCalledWith(
        'test-tenant-id',
        newSettings,
      );
      expect(result).toEqual(updatedTenant);
    });

    it('should return null when tenant not found for settings update', async () => {
      const newSettings = { newSetting: 'newValue' };
      const updateSettingsDto: UpdateTenantSettingsDto = {
        settings: newSettings,
      };
      tenantService.updateSettings.mockResolvedValue(null);

      const result = await controller.updateSettings(
        'non-existent-id',
        updateSettingsDto,
      );

      expect(tenantService.updateSettings).toHaveBeenCalledWith(
        'non-existent-id',
        newSettings,
      );
      expect(result).toBeNull();
    });

    it('should handle service errors during settings update', async () => {
      const error = new Error('Service error');
      const updateSettingsDto: UpdateTenantSettingsDto = { settings: {} };
      tenantService.updateSettings.mockRejectedValue(error);

      await expect(
        controller.updateSettings('test-tenant-id', updateSettingsDto),
      ).rejects.toThrow('Service error');
    });
  });

  describe('updateMetadata', () => {
    it('should update tenant metadata successfully', async () => {
      const newMetadata = { newKey: 'newValue' };
      const updateMetadataDto: UpdateTenantMetadataDto = {
        metadata: newMetadata,
      };
      const updatedTenant = { ...mockTenant, metadata: newMetadata };
      tenantService.updateMetadata.mockResolvedValue(updatedTenant);

      const result = await controller.updateMetadata(
        'test-tenant-id',
        updateMetadataDto,
      );

      expect(tenantService.updateMetadata).toHaveBeenCalledWith(
        'test-tenant-id',
        newMetadata,
      );
      expect(result).toEqual(updatedTenant);
    });

    it('should return null when tenant not found for metadata update', async () => {
      const newMetadata = { newKey: 'newValue' };
      const updateMetadataDto: UpdateTenantMetadataDto = {
        metadata: newMetadata,
      };
      tenantService.updateMetadata.mockResolvedValue(null);

      const result = await controller.updateMetadata(
        'non-existent-id',
        updateMetadataDto,
      );

      expect(tenantService.updateMetadata).toHaveBeenCalledWith(
        'non-existent-id',
        newMetadata,
      );
      expect(result).toBeNull();
    });

    it('should handle service errors during metadata update', async () => {
      const error = new Error('Service error');
      const updateMetadataDto: UpdateTenantMetadataDto = { metadata: {} };
      tenantService.updateMetadata.mockRejectedValue(error);

      await expect(
        controller.updateMetadata('test-tenant-id', updateMetadataDto),
      ).rejects.toThrow('Service error');
    });
  });
});

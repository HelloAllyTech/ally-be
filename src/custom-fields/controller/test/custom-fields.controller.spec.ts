import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CustomFieldsController } from '../custom-fields.controller';
import { CustomFieldsService } from '../../service/custom-fields.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { UserService } from '../../../user/service/user.service';
import {
  CustomFieldEditPermission,
  CustomFieldFillMode,
  CustomFieldType,
} from '../../entity/custom-field-definition.entity';

describe('CustomFieldsController', () => {
  let controller: CustomFieldsController;
  let service: jest.Mocked<CustomFieldsService>;

  const mockService: jest.Mocked<Partial<CustomFieldsService>> = {
    getDefinitions: jest.fn(),
    createDefinition: jest.fn(),
    updateDefinition: jest.fn(),
    deleteDefinition: jest.fn(),
    getValues: jest.fn(),
    upsertValues: jest.fn(),
  };

  const allowGuard: CanActivate = { canActivate: () => true };

  const mockDefinition = {
    id: 'def-uuid-1',
    name: 'Test Field',
    fieldType: CustomFieldType.SINGLE_SELECT,
    options: [{ id: 'opt-1', label: 'A', order: 0 }],
    sectionKey: 'intake',
    editPermission: CustomFieldEditPermission.BOTH,
    fillMode: CustomFieldFillMode.MANUAL,
    displayOrder: 0,
    isActive: true,
    createdBy: 1,
    updatedBy: 1,
    tenantId: 'tenant-id',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomFieldsController],
      providers: [
        { provide: CustomFieldsService, useValue: mockService },
        {
          provide: PermissionsService,
          useValue: { getUserPermissions: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: UserService,
          useValue: {
            getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
          },
        },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(allowGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowGuard)
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<CustomFieldsController>(CustomFieldsController);
    service = module.get(
      CustomFieldsService,
    ) as jest.Mocked<CustomFieldsService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDefinitions', () => {
    it('should return array of definitions', async () => {
      service.getDefinitions.mockResolvedValue([mockDefinition]);

      const result = await controller.getDefinitions();

      expect(service.getDefinitions).toHaveBeenCalledTimes(1);
      expect(result).toEqual([mockDefinition]);
    });

    it('should handle service errors', async () => {
      service.getDefinitions.mockRejectedValue(new Error('DB error'));

      await expect(controller.getDefinitions()).rejects.toThrow('DB error');
    });
  });

  describe('createDefinition', () => {
    const dto = {
      name: 'New Field',
      fieldType: CustomFieldType.SINGLE_SELECT,
      options: [{ id: 'opt-1', label: 'A', order: 0 }],
      sectionKey: 'intake',
      editPermission: CustomFieldEditPermission.BOTH,
    };

    it('should create and return definition', async () => {
      service.createDefinition.mockResolvedValue(mockDefinition);

      const result = await controller.createDefinition(dto);

      expect(service.createDefinition).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockDefinition);
    });

    it('should handle service errors', async () => {
      service.createDefinition.mockRejectedValue(new Error('Validation error'));

      await expect(controller.createDefinition(dto)).rejects.toThrow();
    });
  });

  describe('updateDefinition', () => {
    it('should update and return definition', async () => {
      const updated = { ...mockDefinition, name: 'Updated' };
      service.updateDefinition.mockResolvedValue(updated);

      const result = await controller.updateDefinition('def-uuid-1', {
        name: 'Updated',
      });

      expect(service.updateDefinition).toHaveBeenCalledWith('def-uuid-1', {
        name: 'Updated',
      });
      expect(result).toEqual(updated);
    });

    it('should handle service errors', async () => {
      service.updateDefinition.mockRejectedValue(new Error('Not found'));

      await expect(controller.updateDefinition('bad-id', {})).rejects.toThrow();
    });
  });

  describe('deleteDefinition', () => {
    it('should return success response', async () => {
      service.deleteDefinition.mockResolvedValue({ success: true });

      const result = await controller.deleteDefinition('def-uuid-1');

      expect(service.deleteDefinition).toHaveBeenCalledWith('def-uuid-1');
      expect(result).toEqual({ success: true });
    });

    it('should handle service errors', async () => {
      service.deleteDefinition.mockRejectedValue(new Error('Not found'));

      await expect(controller.deleteDefinition('bad-id')).rejects.toThrow();
    });
  });

  describe('getValues', () => {
    it('should return merged values for chatId', async () => {
      const mockValues = [
        { fieldDefinitionId: 'def-uuid-1', value: 'opt-1' },
      ] as any;
      service.getValues.mockResolvedValue(mockValues);

      const result = await controller.getValues(100);

      expect(service.getValues).toHaveBeenCalledWith(100);
      expect(result).toEqual(mockValues);
    });
  });

  describe('upsertValues', () => {
    it('should return success response', async () => {
      service.upsertValues.mockResolvedValue({ success: true });
      const dto = {
        values: [{ fieldDefinitionId: 'def-uuid-1', value: 'opt-1' }],
      };

      const result = await controller.upsertValues(100, dto);

      expect(service.upsertValues).toHaveBeenCalledWith(100, dto);
      expect(result).toEqual({ success: true });
    });

    it('should handle permission errors from service', async () => {
      service.upsertValues.mockRejectedValue(new Error('Forbidden'));

      await expect(
        controller.upsertValues(100, {
          values: [{ fieldDefinitionId: 'x', value: 'y' }],
        }),
      ).rejects.toThrow();
    });
  });
});

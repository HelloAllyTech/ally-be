import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomFieldsService } from '../custom-fields.service';
import {
  CustomFieldDefinition,
  CustomFieldEditPermission,
  CustomFieldFillMode,
  CustomFieldType,
} from '../../entity/custom-field-definition.entity';
import { ChatCustomFieldValue } from '../../entity/chat-custom-field-value.entity';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { PermissionValidator } from '../../../authorization/service/permission-validator.service';

describe('CustomFieldsService', () => {
  let service: CustomFieldsService;
  let definitionRepo: jest.Mocked<Repository<CustomFieldDefinition>>;
  let valueRepo: jest.Mocked<Repository<ChatCustomFieldValue>>;
  let permissionValidator: jest.Mocked<PermissionValidator>;

  const mockTenantId = 'tenant-uuid';
  const mockUserId = '42';
  const mockDefinitionId = 'def-uuid-1';
  const mockChatId = 100;

  const mockDefinition: CustomFieldDefinition = {
    id: mockDefinitionId,
    name: 'Test Field',
    fieldType: CustomFieldType.SINGLE_SELECT,
    options: [{ id: 'opt-1', label: 'Option A', order: 0 }],
    sectionKey: 'intake',
    editPermission: CustomFieldEditPermission.BOTH,
    fillMode: CustomFieldFillMode.MANUAL,
    displayOrder: 0,
    isActive: true,
    createdBy: 42,
    updatedBy: 42,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  const mockDateDefinition: CustomFieldDefinition = {
    ...mockDefinition,
    id: 'def-uuid-2',
    name: 'Date Field',
    fieldType: CustomFieldType.DATE,
    options: undefined,
  } as any;

  let mockQb: any;

  beforeEach(async () => {
    mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getOne: jest.fn().mockResolvedValue(null),
    };

    definitionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    } as any;

    valueRepo = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomFieldsService,
        {
          provide: getRepositoryToken(CustomFieldDefinition),
          useValue: definitionRepo,
        },
        {
          provide: getRepositoryToken(ChatCustomFieldValue),
          useValue: valueRepo,
        },
        {
          provide: PermissionValidator,
          useValue: { validatePermissions: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<CustomFieldsService>(CustomFieldsService);
    permissionValidator = module.get(PermissionValidator);

    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(mockTenantId);
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(mockUserId);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── getDefinitions ───────────────────────────────────────────────────────

  describe('getDefinitions', () => {
    it('should return active definitions ordered by displayOrder', async () => {
      definitionRepo.find.mockResolvedValue([mockDefinition]);

      const result = await service.getDefinitions();

      expect(definitionRepo.find).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId, isActive: true },
        order: { displayOrder: 'ASC', createdAt: 'ASC' },
      });
      expect(result).toEqual([mockDefinition]);
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.getDefinitions()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── createDefinition (Fix 6: field count limit) ─────────────────────────

  describe('createDefinition', () => {
    const baseDto = {
      name: 'New Field',
      fieldType: CustomFieldType.SINGLE_SELECT,
      options: [{ id: 'opt-1', label: 'A', order: 0 }],
      sectionKey: 'intake',
      editPermission: CustomFieldEditPermission.BOTH,
      displayOrder: 1,
    };

    beforeEach(() => {
      (definitionRepo as any).count = jest.fn().mockResolvedValue(0);
    });

    it('should create and save a single-select definition', async () => {
      definitionRepo.create.mockReturnValue(mockDefinition);
      definitionRepo.save.mockResolvedValue(mockDefinition);

      const result = await service.createDefinition(baseDto);

      expect(definitionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: baseDto.name,
          fieldType: CustomFieldType.SINGLE_SELECT,
          options: baseDto.options,
          tenantId: mockTenantId,
          createdBy: parseInt(mockUserId),
        }),
      );
      expect(definitionRepo.save).toHaveBeenCalledWith(mockDefinition);
      expect(result).toEqual(mockDefinition);
    });

    it('should create a date definition with no options', async () => {
      const dateDto = {
        name: 'Date Field',
        fieldType: CustomFieldType.DATE,
        sectionKey: 'intake',
        editPermission: CustomFieldEditPermission.BOTH,
      };
      definitionRepo.create.mockReturnValue(mockDateDefinition);
      definitionRepo.save.mockResolvedValue(mockDateDefinition);

      await service.createDefinition(dateDto);

      expect(definitionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ options: undefined }),
      );
    });

    it('should use displayOrder 0 when not provided', async () => {
      const dto = { ...baseDto, displayOrder: undefined };
      definitionRepo.create.mockReturnValue(mockDefinition);
      definitionRepo.save.mockResolvedValue(mockDefinition);

      await service.createDefinition(dto);

      expect(definitionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ displayOrder: 0 }),
      );
    });

    it('should throw BadRequestException when SINGLE_SELECT has no options', async () => {
      const dto = { ...baseDto, options: [] };

      await expect(service.createDefinition(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when tenant already has 3 active definitions', async () => {
      (definitionRepo as any).count.mockResolvedValue(
        CustomFieldsService.MAX_DEFINITIONS_PER_TENANT,
      );

      await expect(service.createDefinition(baseDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should allow creation when tenant has fewer than 3 active definitions', async () => {
      (definitionRepo as any).count.mockResolvedValue(2);
      definitionRepo.create.mockReturnValue(mockDefinition);
      definitionRepo.save.mockResolvedValue(mockDefinition);

      const result = await service.createDefinition(baseDto);

      expect(result).toEqual(mockDefinition);
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.createDefinition(baseDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(service.createDefinition(baseDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should persist showInTable=false when explicitly set', async () => {
      const dto = { ...baseDto, showInTable: false };
      definitionRepo.create.mockReturnValue({
        ...mockDefinition,
        showInTable: false,
      });
      definitionRepo.save.mockResolvedValue({
        ...mockDefinition,
        showInTable: false,
      });

      await service.createDefinition(dto);

      expect(definitionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ showInTable: false }),
      );
    });

    it('should throw BadRequestException when name matches a session log column (Status)', async () => {
      await expect(
        service.createDefinition({ ...baseDto, name: 'Status' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for case-insensitive session log column match (status)', async () => {
      await expect(
        service.createDefinition({ ...baseDto, name: 'status' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when name duplicates an existing active custom field', async () => {
      mockQb.getOne = jest.fn().mockResolvedValue(mockDefinition);

      await expect(
        service.createDefinition({ ...baseDto, name: 'Test Field' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── updateDefinition ────────────────────────────────────────────────────

  describe('updateDefinition', () => {
    it('should update and save an existing definition', async () => {
      const updatedDef = { ...mockDefinition, name: 'Updated Name' };
      definitionRepo.findOne.mockResolvedValue(mockDefinition);
      definitionRepo.save.mockResolvedValue(updatedDef);

      const result = await service.updateDefinition(mockDefinitionId, {
        name: 'Updated Name',
      });

      expect(definitionRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockDefinitionId, tenantId: mockTenantId },
      });
      expect(definitionRepo.save).toHaveBeenCalled();
      expect(result).toEqual(updatedDef);
    });

    it('should throw NotFoundException when definition does not exist', async () => {
      definitionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateDefinition('nonexistent-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(
        service.updateDefinition(mockDefinitionId, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should persist showInTable=false when updated', async () => {
      const updatedDef = { ...mockDefinition, showInTable: false };
      definitionRepo.findOne.mockResolvedValue(mockDefinition);
      definitionRepo.save.mockResolvedValue(updatedDef);

      const result = await service.updateDefinition(mockDefinitionId, {
        showInTable: false,
      });

      expect(definitionRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ showInTable: false });
    });

    it('should throw BadRequestException when renaming to a built-in field name', async () => {
      definitionRepo.findOne.mockResolvedValue({
        ...mockDefinition,
        name: 'Old Name',
      });
      mockQb.getOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.updateDefinition(mockDefinitionId, { name: 'Counsellor' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── deleteDefinition ────────────────────────────────────────────────────

  describe('deleteDefinition', () => {
    it('should soft-delete by setting isActive to false', async () => {
      const def = { ...mockDefinition, isActive: true };
      definitionRepo.findOne.mockResolvedValue(def);
      definitionRepo.save.mockResolvedValue({ ...def, isActive: false });

      const result = await service.deleteDefinition(mockDefinitionId);

      expect(def.isActive).toBe(false);
      expect(def.updatedBy).toBe(parseInt(mockUserId));
      expect(definitionRepo.save).toHaveBeenCalledWith(def);
      expect(result).toEqual({ success: true });
    });

    it('should throw NotFoundException when definition does not exist', async () => {
      definitionRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteDefinition('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.deleteDefinition(mockDefinitionId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── getValues ───────────────────────────────────────────────────────────

  describe('getValues', () => {
    const mockValue: ChatCustomFieldValue = {
      id: 'val-uuid-1',
      chatId: mockChatId,
      fieldDefinitionId: mockDefinitionId,
      value: 'opt-1',
      tenantId: mockTenantId,
      updatedBy: 42,
    } as any;

    it('should merge definitions and values into combined response', async () => {
      definitionRepo.find.mockResolvedValue([mockDefinition]);
      valueRepo.find.mockResolvedValue([mockValue]);

      const result = await service.getValues(mockChatId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        fieldDefinitionId: mockDefinitionId,
        name: mockDefinition.name,
        fieldType: mockDefinition.fieldType,
        value: 'opt-1',
      });
    });

    it('should return null value for definitions with no saved value', async () => {
      definitionRepo.find.mockResolvedValue([
        mockDefinition,
        mockDateDefinition,
      ]);
      valueRepo.find.mockResolvedValue([mockValue]);

      const result = await service.getValues(mockChatId);

      expect(result[0].value).toBe('opt-1');
      expect(result[1].value).toBeNull();
    });

    it('should include sectionLabel resolved from SUMMARY_SECTIONS', async () => {
      const defWithKnownSection = {
        ...mockDefinition,
        sectionKey: 'other',
      };
      definitionRepo.find.mockResolvedValue([defWithKnownSection]);
      valueRepo.find.mockResolvedValue([]);

      const result = await service.getValues(mockChatId);

      expect(result[0].sectionLabel).toBe('Other');
    });

    it('should fall back to sectionKey as label when section is unknown', async () => {
      const defWithUnknownSection = {
        ...mockDefinition,
        sectionKey: 'custom_section',
      };
      definitionRepo.find.mockResolvedValue([defWithUnknownSection]);
      valueRepo.find.mockResolvedValue([]);

      const result = await service.getValues(mockChatId);

      expect(result[0].sectionLabel).toBe('custom_section');
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.getValues(mockChatId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── upsertValues ────────────────────────────────────────────────────────

  describe('upsertValues', () => {
    const upsertDto = {
      values: [{ fieldDefinitionId: mockDefinitionId, value: 'opt-1' }],
    };

    const mockExistingValue: ChatCustomFieldValue = {
      id: 'val-uuid-1',
      chatId: mockChatId,
      fieldDefinitionId: mockDefinitionId,
      value: 'old-value',
      tenantId: mockTenantId,
      updatedBy: 1,
    } as any;

    beforeEach(() => {
      mockQb.getMany.mockResolvedValue([mockDefinition]);
      valueRepo.find.mockResolvedValue([]);
      valueRepo.create.mockImplementation((data) => data as any);
      valueRepo.save.mockResolvedValue([] as any);
    });

    it('should upsert values and return success when user has BOTH permission', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      const result = await service.upsertValues(mockChatId, upsertDto);

      expect(valueRepo.save).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should allow admin to edit ADMIN_ONLY field', async () => {
      const adminOnlyDef = {
        ...mockDefinition,
        editPermission: CustomFieldEditPermission.ADMIN_ONLY,
      };
      mockQb.getMany.mockResolvedValue([adminOnlyDef]);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);

      const result = await service.upsertValues(mockChatId, upsertDto);

      expect(result).toEqual({ success: true });
    });

    it('should throw ForbiddenException when counsellor tries to edit ADMIN_ONLY field', async () => {
      const adminOnlyDef = {
        ...mockDefinition,
        editPermission: CustomFieldEditPermission.ADMIN_ONLY,
      };
      mockQb.getMany.mockResolvedValue([adminOnlyDef]);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      await expect(service.upsertValues(mockChatId, upsertDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow counsellor to edit COUNSELLOR_ONLY field', async () => {
      const counsellorOnlyDef = {
        ...mockDefinition,
        editPermission: CustomFieldEditPermission.COUNSELLOR_ONLY,
      };
      mockQb.getMany.mockResolvedValue([counsellorOnlyDef]);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      const result = await service.upsertValues(mockChatId, upsertDto);

      expect(result).toEqual({ success: true });
    });

    it('should throw ForbiddenException when admin tries to edit COUNSELLOR_ONLY field', async () => {
      const counsellorOnlyDef = {
        ...mockDefinition,
        editPermission: CustomFieldEditPermission.COUNSELLOR_ONLY,
      };
      mockQb.getMany.mockResolvedValue([counsellorOnlyDef]);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);

      await expect(service.upsertValues(mockChatId, upsertDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should update existing value record when one exists for chatId+fieldDefinitionId', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      valueRepo.find.mockResolvedValue([mockExistingValue]);

      await service.upsertValues(mockChatId, upsertDto);

      const saved = (valueRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved[0].id).toBe(mockExistingValue.id);
      expect(saved[0].value).toBe('opt-1');
    });

    it('should create new value record when none exists', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      valueRepo.find.mockResolvedValue([]);
      const newRecord = {
        chatId: mockChatId,
        fieldDefinitionId: mockDefinitionId,
        tenantId: mockTenantId,
      };
      valueRepo.create.mockReturnValue(newRecord as any);

      await service.upsertValues(mockChatId, upsertDto);

      expect(valueRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: mockChatId,
          fieldDefinitionId: mockDefinitionId,
        }),
      );
    });

    it('should throw BadRequestException when fieldDefinitionId is not found in tenant', async () => {
      mockQb.getMany.mockResolvedValue([]);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      await expect(service.upsertValues(mockChatId, upsertDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.upsertValues(mockChatId, upsertDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(service.upsertValues(mockChatId, upsertDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

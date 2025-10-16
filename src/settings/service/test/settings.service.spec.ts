import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from '../settings.service';
import { PreferenceService } from '../../../common/service/preference.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { CommonUtil } from '../../../common/util/common.util';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import {
  PreferenceName,
  PreferenceRelatedEntity,
} from '../../../common/constants/user.constants';
import {
  DEFAULT_SUMMARY_FIELDS_ARRAY,
  DEFAULT_SUMMARY_FIELDS_SET,
  DEFAULT_CHAT_TYPES,
} from '../../constants/settings.constants';
import { SummaryPreferenceValue } from '../../../common/type/common.type';
import { ChatTypes } from '../../../common/constants/chat.constants';

describe('SettingsService', () => {
  let service: SettingsService;
  let preferenceService: jest.Mocked<PreferenceService>;

  const mockTenantId = 'test-tenant-id';
  const mockUserId = 'test-user-id';
  const mockPreferenceId = 'test-preference-id';

  const mockOrgPreference = {
    id: mockPreferenceId,
    name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
    relatedId: mockTenantId,
    relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
    value: { fields: ['callId', 'callDuration'] } as SummaryPreferenceValue,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCounselorPreference = {
    id: mockPreferenceId,
    name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
    relatedId: mockUserId,
    relatedEntity: PreferenceRelatedEntity.COUNSELOR,
    value: { fields: ['clientId'] } as SummaryPreferenceValue,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNudgePreference = {
    id: mockPreferenceId,
    name: PreferenceName.NUDGE_STATUS,
    relatedId: mockTenantId,
    relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
    value: { status: true },
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockChatTypesPreference = {
    id: mockPreferenceId,
    name: PreferenceName.HIDDEN_CHAT_TYPES,
    relatedId: mockTenantId,
    relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
    value: [ChatTypes.MICROPHONE_CHAT],
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPreferenceService = {
      getPreference: jest.fn(),
      createPreference: jest.fn(),
      updatePreference: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        {
          provide: PreferenceService,
          useValue: mockPreferenceService,
        },
        {
          provide: PermissionValidator,
          useValue: {
            validatePermissions: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
    preferenceService = module.get(PreferenceService);

    // Mock ExecutionManager static methods
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(mockTenantId);
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(mockUserId);

    // Mock PermissionValidator to return true for admin permissions by default
    const permissionValidator = module.get(PermissionValidator);
    jest
      .spyOn(permissionValidator, 'validatePermissions')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSummaryFieldsConfig', () => {
    it('should return visible fields when both org and counselor preferences exist', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(mockCounselorPreference);

      const result = await service.getSummaryFieldsConfig();

      expect(preferenceService.getPreference).toHaveBeenCalledTimes(2);
      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        mockUserId,
        PreferenceRelatedEntity.COUNSELOR,
      );

      const hiddenFields = ['callId', 'callDuration', 'clientId'];
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !hiddenFields.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should return visible fields when only org preference exists', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(null);

      const result = await service.getSummaryFieldsConfig();

      const hiddenFields = ['callId', 'callDuration'];
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !hiddenFields.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should return visible fields when only counselor preference exists', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockCounselorPreference);

      const result = await service.getSummaryFieldsConfig();

      const hiddenFields = ['clientId'];
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !hiddenFields.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should return all default fields when no preferences exist', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getSummaryFieldsConfig();

      expect(result).toEqual(DEFAULT_SUMMARY_FIELDS_ARRAY);
    });

    it('should return visible fields when preferences have empty fields arrays', async () => {
      const emptyOrgPreference = {
        ...mockOrgPreference,
        value: { fields: [] },
      };
      const emptyCounselorPreference = {
        ...mockCounselorPreference,
        value: { fields: [] },
      };

      preferenceService.getPreference
        .mockResolvedValueOnce(emptyOrgPreference)
        .mockResolvedValueOnce(emptyCounselorPreference);

      const result = await service.getSummaryFieldsConfig();

      expect(result).toEqual(DEFAULT_SUMMARY_FIELDS_ARRAY);
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.getSummaryFieldsConfig()).rejects.toThrow(
        new BadRequestException('Tenant ID and User ID are required'),
      );
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(service.getSummaryFieldsConfig()).rejects.toThrow(
        new BadRequestException('Tenant ID and User ID are required'),
      );
    });
  });

  describe('getHiddenSummaryFields', () => {
    it('should return combined hidden fields from org and counselor preferences', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(mockCounselorPreference);

      const result = await service.getHiddenSummaryFields();

      expect(result).toEqual(['callId', 'callDuration', 'clientId']);
    });

    it('should return only org hidden fields when counselor preference is null', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(null);

      const result = await service.getHiddenSummaryFields();

      expect(result).toEqual(['callId', 'callDuration']);
    });

    it('should return only counselor hidden fields when org preference is null', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockCounselorPreference);

      const result = await service.getHiddenSummaryFields();

      expect(result).toEqual(['clientId']);
    });

    it('should return empty array when no preferences exist', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getHiddenSummaryFields();

      expect(result).toEqual([]);
    });
  });

  describe('updateSummaryFields', () => {
    const validFields = ['callId', 'callDuration'];

    it('should update existing preference for admin role', async () => {
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);
      preferenceService.getPreference.mockResolvedValue(mockOrgPreference);
      preferenceService.updatePreference.mockResolvedValue(mockOrgPreference);

      const result = await service.updateSummaryFields(validFields);

      expect(CommonUtil.getInvalidKeysFromSet).toHaveBeenCalledWith(
        DEFAULT_SUMMARY_FIELDS_SET,
        validFields,
      );
      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(preferenceService.updatePreference).toHaveBeenCalledWith(
        mockPreferenceId,
        { fields: validFields },
      );
      expect(result).toEqual(mockOrgPreference);
    });

    it('should create new preference for admin role when none exists', async () => {
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(mockOrgPreference);

      const result = await service.updateSummaryFields(validFields);

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { fields: validFields },
        tenantId: mockTenantId,
      });
      expect(result).toEqual(mockOrgPreference);
    });

    it('should update existing preference for counselor role', async () => {
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);
      // Mock PermissionValidator to return false for counselor permissions
      const permissionValidator = service['permissionValidator'];
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(
        mockCounselorPreference,
      );
      preferenceService.updatePreference.mockResolvedValue(
        mockCounselorPreference,
      );

      const result = await service.updateSummaryFields(validFields);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        mockUserId,
        PreferenceRelatedEntity.COUNSELOR,
      );
      expect(preferenceService.updatePreference).toHaveBeenCalledWith(
        mockPreferenceId,
        { fields: validFields },
      );
      expect(result).toEqual(mockCounselorPreference);
    });

    it('should create new preference for counselor role when none exists', async () => {
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);
      // Mock PermissionValidator to return false for counselor permissions
      const permissionValidator = service['permissionValidator'];
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(
        mockCounselorPreference,
      );

      const result = await service.updateSummaryFields(validFields);

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
        relatedId: mockUserId,
        relatedEntity: PreferenceRelatedEntity.COUNSELOR,
        value: { fields: validFields },
        tenantId: mockTenantId,
      });
      expect(result).toEqual(mockCounselorPreference);
    });

    it('should throw BadRequestException for invalid fields', async () => {
      const invalidFields = ['invalidField1', 'invalidField2'];
      jest
        .spyOn(CommonUtil, 'getInvalidKeysFromSet')
        .mockReturnValue(invalidFields);

      await expect(service.updateSummaryFields(invalidFields)).rejects.toThrow(
        new BadRequestException(
          `Invalid summary fields - ${invalidFields.join(', ')}`,
        ),
      );
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);

      await expect(service.updateSummaryFields(validFields)).rejects.toThrow(
        new BadRequestException('User ID is required'),
      );
    });

    it('should throw BadRequestException when relatedId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);

      await expect(service.updateSummaryFields(validFields)).rejects.toThrow(
        new BadRequestException('Related ID or Entity is required'),
      );
    });
  });

  describe('getNudgeStatus', () => {
    it('should return org preference status when available', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(mockNudgePreference)
        .mockResolvedValueOnce(null);

      const result = await service.getNudgeStatus();

      expect(result).toBe(true);
    });

    it('should return counselor preference status when org preference is null', async () => {
      const counselorNudgePreference = {
        ...mockNudgePreference,
        value: { status: false },
      };
      preferenceService.getPreference
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(counselorNudgePreference);

      const result = await service.getNudgeStatus();

      expect(result).toBe(false);
    });

    it('should return default true when no preferences exist', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getNudgeStatus();

      expect(result).toBe(true);
    });

    it('should return org status when both preferences exist (org takes precedence)', async () => {
      const counselorNudgePreference = {
        ...mockNudgePreference,
        value: { status: false },
      };
      preferenceService.getPreference
        .mockResolvedValueOnce(mockNudgePreference)
        .mockResolvedValueOnce(counselorNudgePreference);

      const result = await service.getNudgeStatus();

      expect(result).toBe(true);
    });
  });

  describe('updateNudgeStatus', () => {
    it('should update existing preference for admin role', async () => {
      preferenceService.getPreference.mockResolvedValue(mockNudgePreference);
      preferenceService.updatePreference.mockResolvedValue(mockNudgePreference);

      const result = await service.updateNudgeStatus(false);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.NUDGE_STATUS,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(preferenceService.updatePreference).toHaveBeenCalledWith(
        mockPreferenceId,
        { status: false },
      );
      expect(result).toEqual(mockNudgePreference);
    });

    it('should create new preference for admin role when none exists', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(mockNudgePreference);

      const result = await service.updateNudgeStatus(true);

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.NUDGE_STATUS,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { status: true },
        tenantId: mockTenantId,
      });
      expect(result).toEqual(mockNudgePreference);
    });

    it('should update existing preference for counselor role', async () => {
      // Mock PermissionValidator to return false for counselor permissions
      const permissionValidator = service['permissionValidator'];
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(mockNudgePreference);
      preferenceService.updatePreference.mockResolvedValue(mockNudgePreference);

      const result = await service.updateNudgeStatus(false);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.NUDGE_STATUS,
        mockUserId,
        PreferenceRelatedEntity.COUNSELOR,
      );
      expect(result).toEqual(mockNudgePreference);
    });

    it('should create new preference for counselor role when none exists', async () => {
      // Mock PermissionValidator to return false for counselor permissions
      const permissionValidator = service['permissionValidator'];
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(mockNudgePreference);

      const result = await service.updateNudgeStatus(true);

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.NUDGE_STATUS,
        relatedId: mockUserId,
        relatedEntity: PreferenceRelatedEntity.COUNSELOR,
        value: { status: true },
        tenantId: mockTenantId,
      });
      expect(result).toEqual(mockNudgePreference);
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(service.updateNudgeStatus(true)).rejects.toThrow(
        new BadRequestException('User ID is required'),
      );
    });

    it('should throw BadRequestException when relatedId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.updateNudgeStatus(true)).rejects.toThrow(
        new BadRequestException('Related ID or Entity is required'),
      );
    });
  });

  describe('getChatTypes', () => {
    it('should return visible chat types when hidden types exist', async () => {
      preferenceService.getPreference.mockResolvedValue(
        mockChatTypesPreference,
      );

      const result = await service.getChatTypes();

      const expectedVisibleTypes = DEFAULT_CHAT_TYPES.filter(
        (type) => type !== ChatTypes.MICROPHONE_CHAT,
      );
      expect(result).toEqual(expectedVisibleTypes);
    });

    it('should return all default chat types when no hidden types exist', async () => {
      preferenceService.getPreference.mockResolvedValue(null);

      const result = await service.getChatTypes();

      expect(result).toEqual(DEFAULT_CHAT_TYPES);
    });

    it('should return all default chat types when preference has empty value', async () => {
      const emptyPreference = { ...mockChatTypesPreference, value: [] };
      preferenceService.getPreference.mockResolvedValue(emptyPreference);

      const result = await service.getChatTypes();

      expect(result).toEqual(DEFAULT_CHAT_TYPES);
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.getChatTypes()).rejects.toThrow(
        new BadRequestException('Tenant ID is required'),
      );
    });
  });

  describe('getHiddenChatTypesForEntity', () => {
    it('should return hidden chat types when preference exists', async () => {
      preferenceService.getPreference.mockResolvedValue(
        mockChatTypesPreference,
      );

      const result = await service.getHiddenChatTypesForEntity(
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );

      expect(result).toEqual([ChatTypes.MICROPHONE_CHAT]);
    });

    it('should return empty array when preference does not exist', async () => {
      preferenceService.getPreference.mockResolvedValue(null);

      const result = await service.getHiddenChatTypesForEntity(
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );

      expect(result).toEqual([]);
    });

    it('should return empty array when preference value is null', async () => {
      const nullValuePreference = {
        ...mockChatTypesPreference,
        value: null as any,
      };
      preferenceService.getPreference.mockResolvedValue(nullValuePreference);

      const result = await service.getHiddenChatTypesForEntity(
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );

      expect(result).toEqual([]);
    });

    it('should return empty array when preference value is not an array', async () => {
      const invalidValuePreference = {
        ...mockChatTypesPreference,
        value: 'not-an-array' as any,
      };
      preferenceService.getPreference.mockResolvedValue(invalidValuePreference);

      const result = await service.getHiddenChatTypesForEntity(
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );

      expect(result).toEqual([]);
    });
  });

  describe('updateChatTypes', () => {
    const validChatTypes = [ChatTypes.MICROPHONE_CHAT, ChatTypes.WEBRTC_CHAT];

    it('should update existing preference with valid chat types', async () => {
      preferenceService.getPreference.mockResolvedValue(
        mockChatTypesPreference,
      );
      preferenceService.updatePreference.mockResolvedValue(
        mockChatTypesPreference,
      );

      const result = await service.updateChatTypes(validChatTypes);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.HIDDEN_CHAT_TYPES,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(preferenceService.updatePreference).toHaveBeenCalledWith(
        mockPreferenceId,
        validChatTypes,
      );
      expect(result).toEqual(mockChatTypesPreference);
    });

    it('should create new preference with valid chat types when none exists', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(
        mockChatTypesPreference,
      );

      const result = await service.updateChatTypes(validChatTypes);

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.HIDDEN_CHAT_TYPES,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: validChatTypes,
        tenantId: mockTenantId,
      });
      expect(result).toEqual(mockChatTypesPreference);
    });

    it('should throw BadRequestException for invalid chat types', async () => {
      const invalidChatTypes = ['INVALID_TYPE1', 'INVALID_TYPE2'];

      await expect(service.updateChatTypes(invalidChatTypes)).rejects.toThrow(
        new BadRequestException(
          `Invalid chat types - ${invalidChatTypes.join(', ')}`,
        ),
      );
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(service.updateChatTypes(validChatTypes)).rejects.toThrow(
        new BadRequestException('Tenant ID is required'),
      );
    });

    it('should handle empty array of chat types', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(
        mockChatTypesPreference,
      );

      const result = await service.updateChatTypes([]);

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.HIDDEN_CHAT_TYPES,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: [],
        tenantId: mockTenantId,
      });
      expect(result).toEqual(mockChatTypesPreference);
    });
  });
});

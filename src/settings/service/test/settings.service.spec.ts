import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SettingsService } from '../settings.service';
import { PreferenceService } from '../preference.service';
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
  SELECTABLE_CHAT_TYPES,
  LEGAL_CONTENT_NAMES,
  TURN_ENDPOINTING_SETTINGS_NAME,
  DEFAULT_TURN_ENDPOINTING_SETTINGS,
} from '../../constants/settings.constants';
import { GlobalSettingsRepository } from '../../repository/global-settings.repository';
import {
  DEFAULT_HIDDEN_SECTION_IDS,
  SECTION_ID_TO_FIELD_IDS,
  SUMMARY_SECTIONS,
} from '../../constants/summary-sections.constants';
import {
  HiddenSectionsPreferenceValue,
  SummaryPreferenceValue,
} from '../../../common/type/common.type';
import { ChatTypes } from '../../../common/constants/chat.constants';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import {
  GetSummaryFieldsDto,
  UpdateSummaryFieldsDto,
} from '../../dto/summary-fields.dto';
import { UpdateSummarySectionsDto } from '../../dto/summary-sections.dto';
import { UpdateChatTypesDto } from '../../dto/chat-types.dto';
import { AuditLogService } from '../../../audit/service/audit-log.service';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { AdminTenantService } from '../../../user/service/admin-tenant.service';
import {
  AUDIT_ACTIONS,
  AUDIT_EVENTS,
} from '../../../audit/constants/audit-event.constants';
import { DataSource } from 'typeorm';

describe('SettingsService', () => {
  let service: SettingsService;
  let preferenceService: jest.Mocked<PreferenceService>;
  let permissionValidator: jest.Mocked<PermissionValidator>;
  let auditLogService: jest.Mocked<AuditLogService>;
  let permissionsService: jest.Mocked<PermissionsService>;
  let adminTenantService: jest.Mocked<AdminTenantService>;
  let globalSettingsRepository: jest.Mocked<GlobalSettingsRepository>;

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
        {
          provide: AuditLogService,
          useValue: { log: jest.fn() },
        },
        {
          provide: PermissionsService,
          useValue: { isMultiTenantAdmin: jest.fn() },
        },
        {
          provide: AdminTenantService,
          useValue: { getTenantsForAdmin: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: { query: jest.fn() },
        },
        {
          provide: GlobalSettingsRepository,
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
    preferenceService = module.get(PreferenceService);
    permissionValidator = module.get(PermissionValidator);
    auditLogService = module.get(AuditLogService) as any;
    permissionsService = module.get(PermissionsService) as any;
    adminTenantService = module.get(AdminTenantService) as any;
    globalSettingsRepository = module.get(GlobalSettingsRepository);

    // Mock ExecutionManager static methods
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(mockTenantId);
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(mockUserId);

    // Mock PermissionValidator to return false for SYSTEM_ACCESS by default (counselor)
    jest
      .spyOn(permissionValidator, 'validatePermissions')
      .mockImplementation(async (userId, permissions) => {
        // Default: no system access (counselor)
        if (permissions.includes(PERMISSIONS.SYSTEM_ACCESS)) {
          return false;
        }
        // Default: has organization access for admin operations
        return true;
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSummaryFieldsConfig', () => {
    it('should return visible fields for counselor (no system access) with org and counselor preferences', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockCounselorPreference);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {};
      const result = await service.getSummaryFieldsConfig(getSummaryFieldsDto);

      expect(permissionValidator.validatePermissions).toHaveBeenCalledWith(
        parseInt(mockUserId),
        [PERMISSIONS.SYSTEM_ACCESS],
      );
      expect(preferenceService.getPreference).toHaveBeenCalledTimes(3);
      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_SECTIONS,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        mockUserId,
        PreferenceRelatedEntity.COUNSELOR,
      );

      const fieldsFromDefaultHidden = DEFAULT_HIDDEN_SECTION_IDS.flatMap(
        (id) => SECTION_ID_TO_FIELD_IDS[id] ?? [],
      );
      const hiddenFields = [
        'callId',
        'callDuration',
        'clientId',
        ...fieldsFromDefaultHidden,
      ];
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !hiddenFields.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should return visible fields for system access user with selected tenantId', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);

      const selectedTenantId = 'selected-tenant-id';
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(null);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {
        tenantId: selectedTenantId,
      };
      const result = await service.getSummaryFieldsConfig(getSummaryFieldsDto);

      expect(permissionValidator.validatePermissions).toHaveBeenCalledWith(
        parseInt(mockUserId),
        [PERMISSIONS.SYSTEM_ACCESS],
      );
      expect(preferenceService.getPreference).toHaveBeenCalledTimes(2);
      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        selectedTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );

      const fieldsFromDefaultHidden = DEFAULT_HIDDEN_SECTION_IDS.flatMap(
        (id) => SECTION_ID_TO_FIELD_IDS[id] ?? [],
      );
      const hiddenFields = [
        'callId',
        'callDuration',
        ...fieldsFromDefaultHidden,
      ];
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !hiddenFields.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should return visible fields for system access user with tenantId in DTO', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);

      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(null);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {
        tenantId: mockTenantId,
      };
      const result = await service.getSummaryFieldsConfig(getSummaryFieldsDto);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );

      const fieldsFromDefaultHidden = DEFAULT_HIDDEN_SECTION_IDS.flatMap(
        (id) => SECTION_ID_TO_FIELD_IDS[id] ?? [],
      );
      const hiddenFields = [
        'callId',
        'callDuration',
        ...fieldsFromDefaultHidden,
      ];
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !hiddenFields.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should return visible fields when only org preference exists (counselor)', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {};
      const result = await service.getSummaryFieldsConfig(getSummaryFieldsDto);

      const fieldsFromDefaultHidden = DEFAULT_HIDDEN_SECTION_IDS.flatMap(
        (id) => SECTION_ID_TO_FIELD_IDS[id] ?? [],
      );
      const hiddenFields = [
        'callId',
        'callDuration',
        ...fieldsFromDefaultHidden,
      ];
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !hiddenFields.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should return visible fields when only counselor preference exists', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockCounselorPreference);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {};
      const result = await service.getSummaryFieldsConfig(getSummaryFieldsDto);

      const fieldsFromDefaultHidden = DEFAULT_HIDDEN_SECTION_IDS.flatMap(
        (id) => SECTION_ID_TO_FIELD_IDS[id] ?? [],
      );
      const hiddenFields = ['clientId', ...fieldsFromDefaultHidden];
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !hiddenFields.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should return visible fields excluding default-hidden sections when no preferences exist', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {};
      const result = await service.getSummaryFieldsConfig(getSummaryFieldsDto);

      const fieldsFromDefaultHidden = DEFAULT_HIDDEN_SECTION_IDS.flatMap(
        (id) => SECTION_ID_TO_FIELD_IDS[id] ?? [],
      );
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !fieldsFromDefaultHidden.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
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
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(emptyCounselorPreference);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {};
      const result = await service.getSummaryFieldsConfig(getSummaryFieldsDto);

      const fieldsFromDefaultHidden = DEFAULT_HIDDEN_SECTION_IDS.flatMap(
        (id) => SECTION_ID_TO_FIELD_IDS[id] ?? [],
      );
      const expectedVisibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
        (field) => !fieldsFromDefaultHidden.includes(field),
      );
      expect(result).toEqual(expectedVisibleFields);
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {};
      await expect(
        service.getSummaryFieldsConfig(getSummaryFieldsDto),
      ).rejects.toThrow(new BadRequestException('User ID is required'));
    });

    it('should throw BadRequestException when tenantId is missing for counselor', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {};
      await expect(
        service.getSummaryFieldsConfig(getSummaryFieldsDto),
      ).rejects.toThrow(new BadRequestException('Tenant ID is required'));
    });

    it('should throw BadRequestException when tenantId is missing for system access user without tenantId in DTO', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      const getSummaryFieldsDto: GetSummaryFieldsDto = {};
      await expect(
        service.getSummaryFieldsConfig(getSummaryFieldsDto),
      ).rejects.toThrow(new BadRequestException('Tenant ID is required'));
    });
  });

  describe('getSummarySectionsConfig', () => {
    it('should return sections with defaultVisibility, enabled and per-field visible', async () => {
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getSummarySectionsConfig({});

      expect(result.sections).toHaveLength(SUMMARY_SECTIONS.length);
      const otherSection = result.sections.find((s) => s.id === 'other');
      expect(otherSection).toBeDefined();
      expect(otherSection?.defaultVisibility).toBe(true);
      expect(otherSection?.enabled).toBe(true);
      expect(otherSection?.fields.some((f) => f.id === 'callId')).toBe(true);
      expect(otherSection?.fields.find((f) => f.id === 'callId')?.visible).toBe(
        false,
      );
      const intakeSection = result.sections.find((s) => s.id === 'intake');
      expect(intakeSection?.defaultVisibility).toBe(false);
      expect(intakeSection?.enabled).toBe(false);
    });

    it('should return section as hidden when in SUMMARY_HIDDEN_SECTIONS', async () => {
      const hiddenSectionsPref = {
        id: 'pref-id',
        name: PreferenceName.SUMMARY_HIDDEN_SECTIONS,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { sections: ['metrics'] } as HiddenSectionsPreferenceValue,
        tenantId: mockTenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      preferenceService.getPreference
        .mockResolvedValueOnce(mockOrgPreference)
        .mockResolvedValueOnce(hiddenSectionsPref)
        .mockResolvedValueOnce(null);

      const result = await service.getSummarySectionsConfig({});

      const metricsSection = result.sections.find((s) => s.id === 'metrics');
      expect(metricsSection?.enabled).toBe(false);
      metricsSection?.fields.forEach((f) => expect(f.visible).toBe(false));
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
    const updateDto: UpdateSummaryFieldsDto = {
      hiddenFields: validFields,
      tenantId: mockTenantId,
    };

    it('should update existing preference when hiddenFields and tenantId provided', async () => {
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);
      preferenceService.getPreference.mockResolvedValue(mockOrgPreference);
      preferenceService.updatePreference.mockResolvedValue(mockOrgPreference);

      const result = await service.updateSummaryFields(updateDto);

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
      expect(result).toEqual({ success: true });
    });

    it('should use ExecutionManager.getTenantId() when counselor (no tenantId in body)', async () => {
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);
      preferenceService.getPreference.mockResolvedValue(mockOrgPreference);
      preferenceService.updatePreference.mockResolvedValue(mockOrgPreference);

      const counselorDto: UpdateSummaryFieldsDto = {
        hiddenFields: validFields,
      };
      const result = await service.updateSummaryFields(counselorDto);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(result).toEqual({ success: true });
    });

    it('should create new preference when none exists', async () => {
      jest.spyOn(CommonUtil, 'getInvalidKeysFromSet').mockReturnValue([]);
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(mockOrgPreference);

      const result = await service.updateSummaryFields(updateDto);

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { fields: validFields },
        tenantId: mockTenantId,
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw BadRequestException for invalid fields', async () => {
      const invalidFields = ['invalidField1', 'invalidField2'];
      const invalidDto: UpdateSummaryFieldsDto = {
        hiddenFields: invalidFields,
        tenantId: mockTenantId,
      };
      jest
        .spyOn(CommonUtil, 'getInvalidKeysFromSet')
        .mockReturnValue(invalidFields);

      await expect(service.updateSummaryFields(invalidDto)).rejects.toThrow(
        new BadRequestException(
          `Invalid summary fields - ${invalidFields.join(', ')}`,
        ),
      );
    });

    it('should throw BadRequestException when tenantId missing for counselor', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);
      const counselorDto: UpdateSummaryFieldsDto = {
        hiddenFields: validFields,
      };

      await expect(service.updateSummaryFields(counselorDto)).rejects.toThrow(
        new BadRequestException('Tenant ID is required'),
      );
    });
  });

  describe('updateSummarySections', () => {
    const updateDto: UpdateSummarySectionsDto = {
      hiddenSections: ['intake', 'ongoingRisks'],
      tenantId: mockTenantId,
    };

    beforeEach(() => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);
      permissionsService.isMultiTenantAdmin.mockResolvedValue(false);
    });

    it('should update SUMMARY_HIDDEN_SECTIONS when valid section ids provided', async () => {
      const existingPref = {
        id: 'pref-hidden-id',
        name: PreferenceName.SUMMARY_HIDDEN_SECTIONS,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { sections: ['intake'] } as HiddenSectionsPreferenceValue,
        tenantId: mockTenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      preferenceService.getPreference.mockResolvedValue(existingPref);
      preferenceService.updatePreference.mockResolvedValue(existingPref);

      const result = await service.updateSummarySections(updateDto);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SUMMARY_HIDDEN_SECTIONS,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(preferenceService.updatePreference).toHaveBeenCalledWith(
        'pref-hidden-id',
        { sections: ['intake', 'ongoingRisks'] },
      );
      expect(result).toEqual({ success: true });
    });

    it('should create SUMMARY_HIDDEN_SECTIONS when none exists', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue({} as any);

      const result = await service.updateSummarySections(updateDto);

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.SUMMARY_HIDDEN_SECTIONS,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { sections: ['intake', 'ongoingRisks'] },
        tenantId: mockTenantId,
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw BadRequestException for invalid section ids', async () => {
      const invalidDto: UpdateSummarySectionsDto = {
        hiddenSections: ['invalidSection'],
        tenantId: mockTenantId,
      };

      await expect(service.updateSummarySections(invalidDto)).rejects.toThrow(
        new BadRequestException('Invalid section ids - invalidSection'),
      );
    });

    it('scopes to the caller own tenant when user lacks SYSTEM_ACCESS (tenant admin)', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue({} as any);

      // A tenant admin may pass a different tenantId, but the write is locked
      // server-side to their own tenant (ExecutionManager.getTenantId()).
      const result = await service.updateSummarySections({
        hiddenSections: ['intake', 'ongoingRisks'],
        tenantId: 'some-other-tenant-id',
      });

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PreferenceName.SUMMARY_HIDDEN_SECTIONS,
          relatedId: mockTenantId,
          relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
          value: { sections: ['intake', 'ongoingRisks'] },
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('should throw ForbiddenException if multi-tenant admin does not manage the tenant', async () => {
      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      adminTenantService.getTenantsForAdmin.mockResolvedValue({
        data: [{ id: 'other-tenant-id' }],
      } as any);

      await expect(service.updateSummarySections(updateDto)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.updateSummarySections(updateDto)).rejects.toThrow(
        'You are not authorized to update summary sections for this tenant',
      );
    });

    it('should update SUMMARY_HIDDEN_SECTIONS and log audit event if updated by multi-tenant admin', async () => {
      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      adminTenantService.getTenantsForAdmin.mockResolvedValue({
        data: [{ id: mockTenantId }],
      } as any);

      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue({} as any);

      const result = await service.updateSummarySections(updateDto);

      expect(preferenceService.createPreference).toHaveBeenCalled();
      expect(auditLogService.log).toHaveBeenCalledWith({
        eventType:
          AUDIT_EVENTS.MULTI_TENANT_ADMIN_EDITED_SETTINGS_SUMMARY_FIELDS,
        details: {
          action: AUDIT_ACTIONS.UPDATE_SETTING_SUMMARY_FIELDS,
          tenantId: mockTenantId,
          userId: mockUserId,
          hiddenSections: ['intake', 'ongoingRisks'],
        },
      });
      expect(result).toEqual({ success: true });
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

      const expectedVisibleTypes = SELECTABLE_CHAT_TYPES.filter(
        (type) => type !== ChatTypes.MICROPHONE_CHAT,
      );
      expect(result).toEqual(expectedVisibleTypes);
    });

    it('should return all selectable chat types when no hidden types exist', async () => {
      preferenceService.getPreference.mockResolvedValue(null);

      const result = await service.getChatTypes();

      expect(result).toEqual(SELECTABLE_CHAT_TYPES);
    });

    it('should return all selectable chat types when preference has empty value', async () => {
      const emptyPreference = { ...mockChatTypesPreference, value: [] };
      preferenceService.getPreference.mockResolvedValue(emptyPreference);

      const result = await service.getChatTypes();

      expect(result).toEqual(SELECTABLE_CHAT_TYPES);
    });

    it('should never advertise the retired dictation mode', async () => {
      preferenceService.getPreference.mockResolvedValue(null);

      const result = await service.getChatTypes();

      expect(result).not.toContain(ChatTypes.DICTATION_MODE);
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
    const validChatTypes = [ChatTypes.MICROPHONE_CHAT, ChatTypes.AUDIO_UPLOAD];
    const updateDto: UpdateChatTypesDto = {
      hiddenChatTypes: validChatTypes,
      tenantId: mockTenantId,
    };

    it('should update existing preference with valid chat types', async () => {
      preferenceService.getPreference.mockResolvedValue(
        mockChatTypesPreference,
      );
      preferenceService.updatePreference.mockResolvedValue(
        mockChatTypesPreference,
      );

      const result = await service.updateChatTypes(updateDto);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.HIDDEN_CHAT_TYPES,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
        undefined,
      );
      expect(preferenceService.updatePreference).toHaveBeenCalledWith(
        mockPreferenceId,
        validChatTypes,
        undefined,
      );
      expect(result).toEqual(mockChatTypesPreference);
    });

    it('should create new preference with valid chat types when none exists', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(
        mockChatTypesPreference,
      );

      const result = await service.updateChatTypes(updateDto);

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        {
          name: PreferenceName.HIDDEN_CHAT_TYPES,
          relatedId: mockTenantId,
          relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
          value: validChatTypes,
          tenantId: mockTenantId,
        },
        undefined,
      );
      expect(result).toEqual(mockChatTypesPreference);
    });

    it('should throw BadRequestException for invalid chat types', async () => {
      const invalidChatTypes = ['INVALID_TYPE1', 'INVALID_TYPE2'];
      const invalidDto: UpdateChatTypesDto = {
        hiddenChatTypes: invalidChatTypes,
        tenantId: mockTenantId,
      };

      await expect(service.updateChatTypes(invalidDto)).rejects.toThrow(
        new BadRequestException(
          `Invalid chat types - ${invalidChatTypes.join(', ')}`,
        ),
      );
    });

    it('should handle undefined tenantId without throwing error', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(
        mockChatTypesPreference,
      );
      const dtoWithoutTenantId: UpdateChatTypesDto = {
        hiddenChatTypes: validChatTypes,
        tenantId: undefined as any,
      };

      const result = await service.updateChatTypes(dtoWithoutTenantId);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.HIDDEN_CHAT_TYPES,
        undefined,
        PreferenceRelatedEntity.ORGANIZATION,
        undefined,
      );
      expect(result).toEqual(mockChatTypesPreference);
    });

    it('should handle empty array of chat types', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(
        mockChatTypesPreference,
      );
      const emptyDto: UpdateChatTypesDto = {
        hiddenChatTypes: [],
        tenantId: mockTenantId,
      };

      const result = await service.updateChatTypes(emptyDto);

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        {
          name: PreferenceName.HIDDEN_CHAT_TYPES,
          relatedId: mockTenantId,
          relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
          value: [],
          tenantId: mockTenantId,
        },
        undefined,
      );
      expect(result).toEqual(mockChatTypesPreference);
    });
  });

  describe('getCustomFieldsEnabled', () => {
    const mockEnabledPreference = {
      id: mockPreferenceId,
      name: PreferenceName.CUSTOM_FIELDS_ENABLED,
      relatedId: mockTenantId,
      relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      value: { enabled: true },
      tenantId: mockTenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
    });

    it('should return false by default when no preference exists', async () => {
      preferenceService.getPreference.mockResolvedValue(null);

      const result = await service.getCustomFieldsEnabled();

      expect(result).toBe(false);
    });

    it('should return true when preference has enabled=true', async () => {
      preferenceService.getPreference.mockResolvedValue(mockEnabledPreference);

      const result = await service.getCustomFieldsEnabled();

      expect(result).toBe(true);
    });

    it('should return false when preference has enabled=false', async () => {
      preferenceService.getPreference.mockResolvedValue({
        ...mockEnabledPreference,
        value: { enabled: false },
      });

      const result = await service.getCustomFieldsEnabled();

      expect(result).toBe(false);
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(service.getCustomFieldsEnabled()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getScribeNoteCreationEnabled', () => {
    const mockEnabledPreference = {
      id: mockPreferenceId,
      name: PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
      relatedId: mockTenantId,
      relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      value: { enabled: true },
      tenantId: mockTenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
    });

    it('should return false by default when no preference exists', async () => {
      preferenceService.getPreference.mockResolvedValue(null);

      const result = await service.getScribeNoteCreationEnabled();

      expect(result).toBe(false);
    });

    it('should return true when preference has enabled=true', async () => {
      preferenceService.getPreference.mockResolvedValue(mockEnabledPreference);

      const result = await service.getScribeNoteCreationEnabled();

      expect(result).toBe(true);
    });

    it('should return false when preference has enabled=false', async () => {
      preferenceService.getPreference.mockResolvedValue({
        ...mockEnabledPreference,
        value: { enabled: false },
      });

      const result = await service.getScribeNoteCreationEnabled();

      expect(result).toBe(false);
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(service.getScribeNoteCreationEnabled()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateScribeNoteCreationEnabled', () => {
    beforeEach(() => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);
    });

    it('scopes to the caller own tenant without system access (tenant admin)', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue({} as any);

      // Passing a different tenantId must not escape the caller's own tenant.
      const result = await service.updateScribeNoteCreationEnabled(
        'some-other-tenant-id',
        true,
      );

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
          relatedId: mockTenantId,
          relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
          value: { enabled: true },
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('should update an existing preference', async () => {
      preferenceService.getPreference.mockResolvedValue({
        id: mockPreferenceId,
        name: PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { enabled: false },
        tenantId: mockTenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.updateScribeNoteCreationEnabled(
        mockTenantId,
        true,
      );

      expect(preferenceService.updatePreference).toHaveBeenCalledWith(
        mockPreferenceId,
        { enabled: true },
      );
      expect(result).toEqual({ success: true });
    });

    it('should create a preference when none exists', async () => {
      preferenceService.getPreference.mockResolvedValue(null);

      const result = await service.updateScribeNoteCreationEnabled(
        mockTenantId,
        true,
      );

      expect(preferenceService.createPreference).toHaveBeenCalledWith({
        name: PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
        relatedId: mockTenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { enabled: true },
        tenantId: mockTenantId,
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('own-tenant fallback on settings writes', () => {
    // The helpline app's Org. Settings screen is the *own*-tenant screen, so it
    // sends no tenantId. A tenant admin was fine (their branch always used the
    // JWT tenant); an Ally staff account with SYSTEM_ACCESS took the other
    // branch and got "Tenant ID is required" on every toggle — while the
    // matching GET happily reported the current value from their own tenant.
    beforeEach(() => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue({} as any);
    });

    it('falls back to the caller tenant for a system-access voice-note write', async () => {
      const result = await service.updateScribeVoiceNoteEnabled(
        undefined as unknown as string,
        true,
      );

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PreferenceName.SCRIBE_VOICE_NOTE_ENABLED,
          relatedId: mockTenantId,
          value: { enabled: true },
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('falls back to the caller tenant for a system-access note-creation write', async () => {
      await service.updateScribeNoteCreationEnabled(
        undefined as unknown as string,
        true,
      );

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
          relatedId: mockTenantId,
        }),
      );
    });

    it('still honours an explicit tenantId from a system-access caller', async () => {
      // The admin dashboard's per-tenant screen does send one, and it must keep
      // winning — the fallback is for the screen that has nothing to send.
      await service.updateScribeVoiceNoteEnabled('other-tenant', true);

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({ relatedId: 'other-tenant' }),
      );
    });

    it('still pins a non-system-access caller to their own tenant', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      await service.updateScribeVoiceNoteEnabled('other-tenant', true);

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({ relatedId: mockTenantId }),
      );
    });

    it('falls back to the caller tenant for a system-access character-library write', async () => {
      const result = await service.updateCharacterLibraryEnabled(
        undefined as unknown as string,
        true,
      );

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PreferenceName.CHARACTER_LIBRARY_ENABLED,
          relatedId: mockTenantId,
          value: { enabled: true },
        }),
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('getEnabledCustomFieldTypes', () => {
    const mockCustomFieldTypesPreference = {
      id: mockPreferenceId,
      name: PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
      relatedId: mockTenantId,
      relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      value: ['SINGLE_SELECT'],
      tenantId: mockTenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return stored enabled types when preference exists', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(
        mockCustomFieldTypesPreference,
      );

      const result = await service.getEnabledCustomFieldTypes();

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
      expect(result).toEqual(['SINGLE_SELECT']);
    });

    it('should return all CustomFieldType values as default when no preference exists', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(null);

      const result = await service.getEnabledCustomFieldTypes();

      expect(result).toEqual(expect.arrayContaining(['SINGLE_SELECT', 'DATE']));
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('should use provided tenantId when caller is super admin', async () => {
      const otherTenantId = 'other-tenant-id';
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);
      preferenceService.getPreference.mockResolvedValue(null);

      await service.getEnabledCustomFieldTypes(otherTenantId);

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
        otherTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
    });

    it('should ignore provided tenantId and use execution context when not super admin', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      preferenceService.getPreference.mockResolvedValue(null);

      await service.getEnabledCustomFieldTypes('should-be-ignored');

      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
        mockTenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      );
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(service.getEnabledCustomFieldTypes()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateEnabledCustomFieldTypes', () => {
    const mockCustomFieldTypesPreference = {
      id: mockPreferenceId,
      name: PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
      relatedId: mockTenantId,
      relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      value: ['SINGLE_SELECT', 'DATE'],
      tenantId: mockTenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // updateEnabledCustomFieldTypes requires SYSTEM_ACCESS permission. The
    // outer beforeEach defaults SYSTEM_ACCESS to false (counselor role), so
    // override it here to true for this block.
    beforeEach(() => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);
    });

    it('should update existing preference and return success', async () => {
      preferenceService.getPreference.mockResolvedValue(
        mockCustomFieldTypesPreference,
      );
      preferenceService.updatePreference.mockResolvedValue(
        mockCustomFieldTypesPreference,
      );

      const result = await service.updateEnabledCustomFieldTypes(mockTenantId, [
        'SINGLE_SELECT',
      ]);

      expect(preferenceService.updatePreference).toHaveBeenCalledWith(
        mockPreferenceId,
        ['SINGLE_SELECT'],
      );
      expect(result).toEqual({ success: true });
    });

    it('should create new preference when none exists', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(
        mockCustomFieldTypesPreference,
      );

      const result = await service.updateEnabledCustomFieldTypes(mockTenantId, [
        'DATE',
      ]);

      expect(preferenceService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
          relatedId: mockTenantId,
          relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
          value: ['DATE'],
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('should throw BadRequestException for invalid field type', async () => {
      await expect(
        service.updateEnabledCustomFieldTypes(mockTenantId, ['INVALID_TYPE']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept empty array (disabling all types)', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      preferenceService.createPreference.mockResolvedValue(
        mockCustomFieldTypesPreference,
      );

      const result = await service.updateEnabledCustomFieldTypes(
        mockTenantId,
        [],
      );

      expect(result).toEqual({ success: true });
    });
  });

  describe('getLegalContent', () => {
    it('should return the stored html when the row exists', async () => {
      globalSettingsRepository.findOne.mockResolvedValue({
        id: 'gs-1',
        name: LEGAL_CONTENT_NAMES.TERMS,
        value: { html: '<p>Terms</p>' },
        createdBy: 1,
        updatedBy: 1,
      } as any);

      const result = await service.getLegalContent(LEGAL_CONTENT_NAMES.TERMS);

      expect(globalSettingsRepository.findOne).toHaveBeenCalledWith({
        where: { name: LEGAL_CONTENT_NAMES.TERMS },
      });
      expect(result).toEqual({ html: '<p>Terms</p>' });
    });

    it('should return empty html when the row does not exist yet', async () => {
      globalSettingsRepository.findOne.mockResolvedValue(null);

      const result = await service.getLegalContent(LEGAL_CONTENT_NAMES.PRIVACY);

      expect(result).toEqual({ html: '' });
    });
  });

  describe('updateLegalContent', () => {
    it('should update an existing row with sanitized html', async () => {
      const existing = {
        id: 'gs-1',
        name: LEGAL_CONTENT_NAMES.TERMS,
        value: { html: '<p>old</p>' },
        createdBy: 1,
        updatedBy: 1,
      };
      globalSettingsRepository.findOne.mockResolvedValue(existing as any);
      globalSettingsRepository.save.mockResolvedValue(existing as any);

      const result = await service.updateLegalContent(
        LEGAL_CONTENT_NAMES.TERMS,
        '<p>new</p><script>alert(1)</script>',
      );

      const saved = globalSettingsRepository.save.mock.calls[0][0] as any;
      expect(saved.value.html).toContain('<p>new</p>');
      // sanitizeDescriptionHtml strips <script>
      expect(saved.value.html).not.toContain('<script>');
      expect(result).toEqual({ success: true });
    });

    it('should create a new row when none exists', async () => {
      globalSettingsRepository.findOne.mockResolvedValue(null);
      globalSettingsRepository.create.mockImplementation(
        (entity: any) => entity,
      );
      globalSettingsRepository.save.mockResolvedValue({} as any);

      const result = await service.updateLegalContent(
        LEGAL_CONTENT_NAMES.PRIVACY,
        '<p>privacy</p>',
      );

      expect(globalSettingsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: LEGAL_CONTENT_NAMES.PRIVACY,
          value: { html: '<p>privacy</p>' },
        }),
      );
      expect(globalSettingsRepository.save).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(
        service.updateLegalContent(LEGAL_CONTENT_NAMES.TERMS, '<p>x</p>'),
      ).rejects.toThrow(new BadRequestException('User ID is required'));
    });
  });

  describe('getTurnEndpointingSettings', () => {
    it('should return the LiveKit defaults when no row exists yet', async () => {
      globalSettingsRepository.findOne.mockResolvedValue(null);

      const result = await service.getTurnEndpointingSettings();

      expect(globalSettingsRepository.findOne).toHaveBeenCalledWith({
        where: { name: TURN_ENDPOINTING_SETTINGS_NAME },
      });
      expect(result).toEqual(DEFAULT_TURN_ENDPOINTING_SETTINGS);
    });

    it('should return the stored bounds when a row exists', async () => {
      globalSettingsRepository.findOne.mockResolvedValue({
        id: 'gs-1',
        name: TURN_ENDPOINTING_SETTINGS_NAME,
        value: {
          turnMinEndpointingDelay: 0.75,
          turnMaxEndpointingDelay: 2.25,
        },
        createdBy: 1,
        updatedBy: 1,
      } as any);

      const result = await service.getTurnEndpointingSettings();

      expect(result).toEqual({
        turnMinEndpointingDelay: 0.75,
        turnMaxEndpointingDelay: 2.25,
      });
    });
  });

  describe('updateTurnEndpointingSettings', () => {
    it('should create a new row when none exists', async () => {
      globalSettingsRepository.findOne.mockResolvedValue(null);
      globalSettingsRepository.create.mockImplementation(
        (entity: any) => entity,
      );
      globalSettingsRepository.save.mockResolvedValue({} as any);

      const result = await service.updateTurnEndpointingSettings({
        turnMinEndpointingDelay: 0.5,
        turnMaxEndpointingDelay: 3,
      });

      expect(globalSettingsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: TURN_ENDPOINTING_SETTINGS_NAME,
          value: {
            turnMinEndpointingDelay: 0.5,
            turnMaxEndpointingDelay: 3,
          },
        }),
      );
      expect(globalSettingsRepository.save).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should update an existing row', async () => {
      const existing = {
        id: 'gs-1',
        name: TURN_ENDPOINTING_SETTINGS_NAME,
        value: { turnMinEndpointingDelay: 0.5, turnMaxEndpointingDelay: 3 },
        createdBy: 1,
        updatedBy: 1,
      };
      globalSettingsRepository.findOne.mockResolvedValue(existing as any);
      globalSettingsRepository.save.mockResolvedValue(existing as any);

      const result = await service.updateTurnEndpointingSettings({
        turnMinEndpointingDelay: 1,
        turnMaxEndpointingDelay: 4,
      });

      const saved = globalSettingsRepository.save.mock.calls[0][0] as any;
      expect(saved.value).toEqual({
        turnMinEndpointingDelay: 1,
        turnMaxEndpointingDelay: 4,
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw BadRequestException when userId is missing', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(
        service.updateTurnEndpointingSettings({
          turnMinEndpointingDelay: 0.5,
          turnMaxEndpointingDelay: 3,
        }),
      ).rejects.toThrow(new BadRequestException('User ID is required'));
    });
  });
});

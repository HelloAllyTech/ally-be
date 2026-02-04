import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SettingsController } from '../settings.controller';
import { SettingsService } from '../../service/settings.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ChatTypes } from '../../../common/constants/chat.constants';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { UserService } from '../../../user/service/user.service';

describe('SettingsController', () => {
  let controller: SettingsController;
  let service: jest.Mocked<SettingsService>;

  const mockService: jest.Mocked<SettingsService> = {
    getSummaryFieldsConfig: jest.fn(),
    getSummarySectionsConfig: jest.fn(),
    updateSummaryFields: jest.fn(),
    updateSummarySections: jest.fn(),
    getNudgeStatus: jest.fn(),
    updateNudgeStatus: jest.fn(),
    getChatTypes: jest.fn(),
    updateChatTypes: jest.fn(),
    getHiddenSummaryFields: jest.fn(),
    getHiddenChatTypesForEntity: jest.fn(),
  } as any;

  const allowGuard: CanActivate = { canActivate: () => true };

  const mockPermissionsService = {
    getUserPermissions: jest
      .fn()
      .mockResolvedValue([
        PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS,
        PERMISSIONS.EDIT_SETTINGS_SUMMARY_FIELDS,
        PERMISSIONS.VIEW_SETTINGS_NUDGE_STATUS,
        PERMISSIONS.EDIT_SETTINGS_NUDGE_STATUS,
        PERMISSIONS.VIEW_SETTINGS_CHAT_TYPES,
        PERMISSIONS.EDIT_SETTINGS_CHAT_TYPES,
      ]),
  };

  const mockUserService = {
    getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        { provide: SettingsService, useValue: mockService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: UserService, useValue: mockUserService },
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

    controller = module.get<SettingsController>(SettingsController);
    service = module.get(SettingsService) as jest.Mocked<SettingsService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSummaryFields', () => {
    it('should return summary fields configuration without DTO', async () => {
      const mockFields = ['callId', 'callDuration', 'clientId'] as any;
      service.getSummaryFieldsConfig.mockResolvedValue(mockFields);

      const result = await controller.getSummaryFields();

      expect(service.getSummaryFieldsConfig).toHaveBeenCalledWith({});
      expect(result).toEqual(mockFields);
    });

    it('should return summary fields configuration with DTO', async () => {
      const mockFields = ['callId', 'callDuration', 'clientId'] as any;
      const getSummaryFieldsDto = { tenantId: 'test-tenant-id' };
      service.getSummaryFieldsConfig.mockResolvedValue(mockFields);

      const result = await controller.getSummaryFields(getSummaryFieldsDto);

      expect(service.getSummaryFieldsConfig).toHaveBeenCalledWith(
        getSummaryFieldsDto,
      );
      expect(result).toEqual(mockFields);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      service.getSummaryFieldsConfig.mockRejectedValue(error);

      await expect(controller.getSummaryFields()).rejects.toThrow(error);
    });
  });

  describe('updateSummaryFields', () => {
    it('should update summary fields with valid hidden fields', async () => {
      const requestBody = {
        hiddenFields: ['callId', 'callDuration'],
        tenantId: 'tenant-id',
      };
      const mockResult = { success: true };
      service.updateSummaryFields.mockResolvedValue(mockResult);

      const result = await controller.updateSummaryFields(requestBody);

      expect(service.updateSummaryFields).toHaveBeenCalledWith(requestBody);
      expect(result).toEqual(mockResult);
    });

    it('should update summary fields with empty hidden fields array', async () => {
      const requestBody = { hiddenFields: [], tenantId: 'tenant-id' };
      const mockResult = { success: true };
      service.updateSummaryFields.mockResolvedValue(mockResult);

      const result = await controller.updateSummaryFields(requestBody);

      expect(service.updateSummaryFields).toHaveBeenCalledWith(requestBody);
      expect(result).toEqual(mockResult);
    });

    it('should handle service errors', async () => {
      const requestBody = {
        hiddenFields: ['invalidField'],
        tenantId: 'tenant-id',
      };
      const error = new Error('Invalid fields');
      service.updateSummaryFields.mockRejectedValue(error);

      await expect(controller.updateSummaryFields(requestBody)).rejects.toThrow(
        error,
      );
    });
  });

  describe('getSummarySections', () => {
    it('should return summary sections config without query', async () => {
      const mockSections = {
        sections: [
          {
            id: 'other',
            label: 'Other',
            defaultVisibility: true,
            enabled: true,
            fields: [{ id: 'callId', label: 'Call ID', visible: false }],
          },
        ],
      };
      service.getSummarySectionsConfig.mockResolvedValue(mockSections);

      const result = await controller.getSummarySections();

      expect(service.getSummarySectionsConfig).toHaveBeenCalledWith({});
      expect(result).toEqual(mockSections);
    });

    it('should return summary sections config with tenantId query', async () => {
      const query = { tenantId: 'test-tenant-id' };
      const mockSections = { sections: [] };
      service.getSummarySectionsConfig.mockResolvedValue(mockSections);

      const result = await controller.getSummarySections(query);

      expect(service.getSummarySectionsConfig).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockSections);
    });
  });

  describe('updateSummarySections', () => {
    it('should update summary sections with valid hidden sections', async () => {
      const requestBody = {
        hiddenSections: ['intake', 'ongoingRisks'],
        tenantId: 'tenant-id',
      };
      const mockResult = { success: true };
      service.updateSummarySections.mockResolvedValue(mockResult);

      const result = await controller.updateSummarySections(requestBody);

      expect(service.updateSummarySections).toHaveBeenCalledWith(requestBody);
      expect(result).toEqual(mockResult);
    });

    it('should handle service errors', async () => {
      const requestBody = {
        hiddenSections: ['intake'],
        tenantId: 'tenant-id',
      };
      const error = new Error('Forbidden');
      service.updateSummarySections.mockRejectedValue(error);

      await expect(
        controller.updateSummarySections(requestBody),
      ).rejects.toThrow(error);
    });
  });

  describe('getNudgeStatus', () => {
    it('should return nudge status as true', async () => {
      service.getNudgeStatus.mockResolvedValue(true);

      const result = await controller.getNudgeStatus();

      expect(service.getNudgeStatus).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('should return nudge status as false', async () => {
      service.getNudgeStatus.mockResolvedValue(false);

      const result = await controller.getNudgeStatus();

      expect(service.getNudgeStatus).toHaveBeenCalledTimes(1);
      expect(result).toBe(false);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      service.getNudgeStatus.mockRejectedValue(error);

      await expect(controller.getNudgeStatus()).rejects.toThrow(error);
    });
  });

  describe('updateNudgeStatus', () => {
    it('should update nudge status to true', async () => {
      const requestBody = { status: true };
      const mockResult = {
        id: 'pref-id',
        name: 'NUDGE_STATUS',
        relatedId: 'tenant-id',
        relatedEntity: 'ORGANIZATION',
        value: { status: true },
        tenantId: 'tenant-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      service.updateNudgeStatus.mockResolvedValue(mockResult);

      const result = await controller.updateNudgeStatus(requestBody);

      expect(service.updateNudgeStatus).toHaveBeenCalledWith(true);
      expect(result).toEqual(mockResult);
    });

    it('should update nudge status to false', async () => {
      const requestBody = { status: false };
      const mockResult = {
        id: 'pref-id',
        name: 'NUDGE_STATUS',
        relatedId: 'tenant-id',
        relatedEntity: 'ORGANIZATION',
        value: { status: false },
        tenantId: 'tenant-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      service.updateNudgeStatus.mockResolvedValue(mockResult);

      const result = await controller.updateNudgeStatus(requestBody);

      expect(service.updateNudgeStatus).toHaveBeenCalledWith(false);
      expect(result).toEqual(mockResult);
    });

    it('should handle service errors', async () => {
      const requestBody = { status: true };
      const error = new Error('Service error');
      service.updateNudgeStatus.mockRejectedValue(error);

      await expect(controller.updateNudgeStatus(requestBody)).rejects.toThrow(
        error,
      );
    });
  });

  describe('getChatTypes', () => {
    it('should return enabled chat types', async () => {
      const mockChatTypes = [
        ChatTypes.WEBRTC_CHAT,
        ChatTypes.EXOTEL_CONFERENCE_CHAT,
      ];
      service.getChatTypes.mockResolvedValue(mockChatTypes);

      const result = await controller.getChatTypes();

      expect(service.getChatTypes).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockChatTypes);
    });

    it('should return empty array when no chat types are enabled', async () => {
      service.getChatTypes.mockResolvedValue([]);

      const result = await controller.getChatTypes();

      expect(service.getChatTypes).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      service.getChatTypes.mockRejectedValue(error);

      await expect(controller.getChatTypes()).rejects.toThrow(error);
    });
  });

  describe('updateHiddenChatTypes', () => {
    it('should update hidden chat types with valid types', async () => {
      const requestBody = {
        hiddenChatTypes: [ChatTypes.MICROPHONE_CHAT],
        tenantId: 'tenant-id',
      };
      const mockResult = {
        id: 'pref-id',
        name: 'HIDDEN_CHAT_TYPES',
        relatedId: 'tenant-id',
        relatedEntity: 'ORGANIZATION',
        value: requestBody.hiddenChatTypes,
        tenantId: 'tenant-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      service.updateChatTypes.mockResolvedValue(mockResult);

      const result = await controller.updateHiddenChatTypes(requestBody);

      expect(service.updateChatTypes).toHaveBeenCalledWith(requestBody);
      expect(result).toEqual(mockResult);
    });

    it('should update hidden chat types with empty array', async () => {
      const requestBody = { hiddenChatTypes: [], tenantId: 'tenant-id' };
      const mockResult = {
        id: 'pref-id',
        name: 'HIDDEN_CHAT_TYPES',
        relatedId: 'tenant-id',
        relatedEntity: 'ORGANIZATION',
        value: [],
        tenantId: 'tenant-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      service.updateChatTypes.mockResolvedValue(mockResult);

      const result = await controller.updateHiddenChatTypes(requestBody);

      expect(service.updateChatTypes).toHaveBeenCalledWith(requestBody);
      expect(result).toEqual(mockResult);
    });

    it('should update hidden chat types with multiple types', async () => {
      const requestBody = {
        hiddenChatTypes: [ChatTypes.MICROPHONE_CHAT, ChatTypes.WEBRTC_CHAT],
        tenantId: 'tenant-id',
      };
      const mockResult = {
        id: 'pref-id',
        name: 'HIDDEN_CHAT_TYPES',
        relatedId: 'tenant-id',
        relatedEntity: 'ORGANIZATION',
        value: requestBody.hiddenChatTypes,
        tenantId: 'tenant-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      service.updateChatTypes.mockResolvedValue(mockResult);

      const result = await controller.updateHiddenChatTypes(requestBody);

      expect(service.updateChatTypes).toHaveBeenCalledWith(requestBody);
      expect(result).toEqual(mockResult);
    });

    it('should handle service errors', async () => {
      const requestBody = {
        hiddenChatTypes: ['invalidType'],
        tenantId: 'tenant-id',
      };
      const error = new Error('Invalid chat types');
      service.updateChatTypes.mockRejectedValue(error);

      await expect(
        controller.updateHiddenChatTypes(requestBody),
      ).rejects.toThrow(error);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SettingsController } from '../settings.controller';
import { SettingsService } from '../../service/settings.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { ChatTypes } from '../../../common/constants/chat.constants';
import { PermissionsService } from '../../../authorization/service/permissions.service';

describe('SettingsController', () => {
  let controller: SettingsController;
  let service: jest.Mocked<SettingsService>;

  const mockService: jest.Mocked<SettingsService> = {
    getSummaryFieldsConfig: jest.fn(),
    updateSummaryFields: jest.fn(),
    getNudgeStatus: jest.fn(),
    updateNudgeStatus: jest.fn(),
    getChatTypes: jest.fn(),
    updateChatTypes: jest.fn(),
    getHiddenSummaryFields: jest.fn(),
    getHiddenChatTypesForEntity: jest.fn(),
  } as any;

  const allowGuard: CanActivate = { canActivate: () => true };

  const mockPermissionsService = {
    getUserPermissions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        { provide: SettingsService, useValue: mockService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<SettingsController>(SettingsController);
    service = module.get(SettingsService) as jest.Mocked<SettingsService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSummaryFields', () => {
    it('should return summary fields configuration', async () => {
      const mockFields = ['callId', 'callDuration', 'clientId'] as any;
      service.getSummaryFieldsConfig.mockResolvedValue(mockFields);

      const result = await controller.getSummaryFields();

      expect(service.getSummaryFieldsConfig).toHaveBeenCalledTimes(1);
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
      const requestBody = { hiddenFields: ['callId', 'callDuration'] };
      const mockResult = {
        id: 'pref-id',
        name: 'SUMMARY_HIDDEN_FIELDS',
        relatedId: 'tenant-id',
        relatedEntity: 'ORGANIZATION',
        value: { fields: requestBody.hiddenFields },
        tenantId: 'tenant-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      service.updateSummaryFields.mockResolvedValue(mockResult);

      const result = await controller.updateSummaryFields(requestBody);

      expect(service.updateSummaryFields).toHaveBeenCalledWith(
        requestBody.hiddenFields,
      );
      expect(result).toEqual(mockResult);
    });

    it('should update summary fields with empty hidden fields array', async () => {
      const requestBody = { hiddenFields: [] };
      const mockResult = {
        id: 'pref-id',
        name: 'SUMMARY_HIDDEN_FIELDS',
        relatedId: 'tenant-id',
        relatedEntity: 'ORGANIZATION',
        value: { fields: [] },
        tenantId: 'tenant-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      service.updateSummaryFields.mockResolvedValue(mockResult);

      const result = await controller.updateSummaryFields(requestBody);

      expect(service.updateSummaryFields).toHaveBeenCalledWith([]);
      expect(result).toEqual(mockResult);
    });

    it('should handle service errors', async () => {
      const requestBody = { hiddenFields: ['invalidField'] };
      const error = new Error('Invalid fields');
      service.updateSummaryFields.mockRejectedValue(error);

      await expect(controller.updateSummaryFields(requestBody)).rejects.toThrow(
        error,
      );
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
      const requestBody = { hiddenChatTypes: [ChatTypes.MICROPHONE_CHAT] };
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

      expect(service.updateChatTypes).toHaveBeenCalledWith(
        requestBody.hiddenChatTypes,
      );
      expect(result).toEqual(mockResult);
    });

    it('should update hidden chat types with empty array', async () => {
      const requestBody = { hiddenChatTypes: [] };
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

      expect(service.updateChatTypes).toHaveBeenCalledWith([]);
      expect(result).toEqual(mockResult);
    });

    it('should update hidden chat types with multiple types', async () => {
      const requestBody = {
        hiddenChatTypes: [ChatTypes.MICROPHONE_CHAT, ChatTypes.WEBRTC_CHAT],
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

      expect(service.updateChatTypes).toHaveBeenCalledWith(
        requestBody.hiddenChatTypes,
      );
      expect(result).toEqual(mockResult);
    });

    it('should handle service errors', async () => {
      const requestBody = { hiddenChatTypes: ['invalidType'] };
      const error = new Error('Invalid chat types');
      service.updateChatTypes.mockRejectedValue(error);

      await expect(
        controller.updateHiddenChatTypes(requestBody),
      ).rejects.toThrow(error);
    });
  });
});

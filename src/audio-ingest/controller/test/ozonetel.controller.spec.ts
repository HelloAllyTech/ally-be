import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OzonetelController } from '../ozonetel.controller';
import { OzonetelService } from '../../service/ozonetel.service';
import {
  OzonetelSubscriptionDto,
  OzonetelUnsubscriptionDto,
} from '../../dto/ozonetel.dto';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { UserService } from '../../../user/service/user.service';
import { AppConfigService } from '../../../config/config.service';

describe('OzonetelController', () => {
  let controller: OzonetelController;
  let ozonetelService: jest.Mocked<OzonetelService>;

  const mockOzonetelService = {
    subscribeOzonetelEvents: jest.fn(),
    unsubscribeOzonetelEvents: jest.fn(),
  };

  const mockPermissionsService = {
    getUserRoles: jest.fn(),
  };

  const mockUserService = {
    getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OzonetelController],
      providers: [
        {
          provide: OzonetelService,
          useValue: mockOzonetelService,
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: AppConfigService,
          useValue: {
            featureFlag: {
              termsAndAgreement: false,
            },
          },
        },
      ],
    }).compile();

    controller = module.get<OzonetelController>(OzonetelController);
    ozonetelService = module.get(OzonetelService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleOzonetelCallDetails (subscribe-events)', () => {
    const mockSubscriptionDto: OzonetelSubscriptionDto = {
      tenantId: 'tenant-123',
    };

    it('should successfully subscribe to ozonetel events', async () => {
      // Arrange
      ozonetelService.subscribeOzonetelEvents.mockResolvedValue(true);

      // Act
      const result =
        await controller.handleOzonetelCallDetails(mockSubscriptionDto);

      // Assert
      expect(ozonetelService.subscribeOzonetelEvents).toHaveBeenCalledWith(
        'tenant-123',
      );
      expect(ozonetelService.subscribeOzonetelEvents).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('should handle various service errors', async () => {
      // Test NotFoundException
      const notFoundError = new NotFoundException(
        'Cloud telephony integration not found',
      );
      ozonetelService.subscribeOzonetelEvents.mockRejectedValue(notFoundError);

      await expect(
        controller.handleOzonetelCallDetails(mockSubscriptionDto),
      ).rejects.toThrow(NotFoundException);
      expect(ozonetelService.subscribeOzonetelEvents).toHaveBeenCalledWith(
        'tenant-123',
      );

      // Reset mock
      ozonetelService.subscribeOzonetelEvents.mockClear();

      // Test ServiceUnavailableException
      const serviceUnavailableError = new ServiceUnavailableException(
        'Ozonetel service unavailable',
      );
      ozonetelService.subscribeOzonetelEvents.mockRejectedValue(
        serviceUnavailableError,
      );

      await expect(
        controller.handleOzonetelCallDetails(mockSubscriptionDto),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(ozonetelService.subscribeOzonetelEvents).toHaveBeenCalledWith(
        'tenant-123',
      );

      // Reset mock
      ozonetelService.subscribeOzonetelEvents.mockClear();

      // Test generic error
      const genericError = new Error('Generic error occurred');
      ozonetelService.subscribeOzonetelEvents.mockRejectedValue(genericError);

      await expect(
        controller.handleOzonetelCallDetails(mockSubscriptionDto),
      ).rejects.toThrow('Generic error occurred');
      expect(ozonetelService.subscribeOzonetelEvents).toHaveBeenCalledWith(
        'tenant-123',
      );
    });

    it('should call service with correct tenantId from DTO', async () => {
      // Arrange
      const customTenantId = 'custom-tenant-456';
      const customDto: OzonetelSubscriptionDto = {
        tenantId: customTenantId,
      };
      ozonetelService.subscribeOzonetelEvents.mockResolvedValue(true);

      // Act
      await controller.handleOzonetelCallDetails(customDto);

      // Assert
      expect(ozonetelService.subscribeOzonetelEvents).toHaveBeenCalledWith(
        customTenantId,
      );
      expect(ozonetelService.subscribeOzonetelEvents).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleOzonetelUnsubscribe (unsubscribe-events)', () => {
    const mockUnsubscriptionDto: OzonetelUnsubscriptionDto = {
      tenantId: 'tenant-123',
    };

    it('should successfully unsubscribe from ozonetel events', async () => {
      // Arrange
      ozonetelService.unsubscribeOzonetelEvents.mockResolvedValue(true);

      // Act
      const result = await controller.handleOzonetelUnsubscribe(
        mockUnsubscriptionDto,
      );

      // Assert
      expect(ozonetelService.unsubscribeOzonetelEvents).toHaveBeenCalledWith(
        'tenant-123',
      );
      expect(ozonetelService.unsubscribeOzonetelEvents).toHaveBeenCalledTimes(
        1,
      );
      expect(result).toBe(true);
    });

    it('should handle various service errors', async () => {
      // Test NotFoundException
      const notFoundError = new NotFoundException(
        'Cloud telephony integration not found',
      );
      ozonetelService.unsubscribeOzonetelEvents.mockRejectedValue(
        notFoundError,
      );

      await expect(
        controller.handleOzonetelUnsubscribe(mockUnsubscriptionDto),
      ).rejects.toThrow(NotFoundException);
      expect(ozonetelService.unsubscribeOzonetelEvents).toHaveBeenCalledWith(
        'tenant-123',
      );

      // Reset mock
      ozonetelService.unsubscribeOzonetelEvents.mockClear();

      // Test ServiceUnavailableException
      const serviceUnavailableError = new ServiceUnavailableException(
        'Ozonetel service unavailable',
      );
      ozonetelService.unsubscribeOzonetelEvents.mockRejectedValue(
        serviceUnavailableError,
      );

      await expect(
        controller.handleOzonetelUnsubscribe(mockUnsubscriptionDto),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(ozonetelService.unsubscribeOzonetelEvents).toHaveBeenCalledWith(
        'tenant-123',
      );

      // Reset mock
      ozonetelService.unsubscribeOzonetelEvents.mockClear();

      // Test generic error
      const genericError = new Error('Generic error occurred');
      ozonetelService.unsubscribeOzonetelEvents.mockRejectedValue(genericError);

      await expect(
        controller.handleOzonetelUnsubscribe(mockUnsubscriptionDto),
      ).rejects.toThrow('Generic error occurred');
      expect(ozonetelService.unsubscribeOzonetelEvents).toHaveBeenCalledWith(
        'tenant-123',
      );
    });

    it('should call service with correct tenantId from DTO', async () => {
      // Arrange
      const customTenantId = 'custom-tenant-789';
      const customDto: OzonetelUnsubscriptionDto = {
        tenantId: customTenantId,
      };
      ozonetelService.unsubscribeOzonetelEvents.mockResolvedValue(true);

      // Act
      await controller.handleOzonetelUnsubscribe(customDto);

      // Assert
      expect(ozonetelService.unsubscribeOzonetelEvents).toHaveBeenCalledWith(
        customTenantId,
      );
      expect(ozonetelService.unsubscribeOzonetelEvents).toHaveBeenCalledTimes(
        1,
      );
    });
  });
});

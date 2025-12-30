import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CloudTelephonyController } from '../cloud-telephony.controller';
import { CloudTelephonyService } from '../../service/cloud-telephony.service';
import {
  CreateCloudTelephonyIntegrationDto,
  CloudTelephonyIntegrationResponseDto,
} from '../../dto/cloud-telephony.dto';
import { CloudTelephonyProvider } from '../../../common/constants/chat.constants';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { UserService } from '../../../user/service/user.service';
import { AppConfigService } from '../../../config/config.service';

describe('CloudTelephonyController', () => {
  let controller: CloudTelephonyController;
  let service: jest.Mocked<CloudTelephonyService>;

  const mockCloudTelephonyService = {
    createCloudTelephonyIntegration: jest.fn(),
  };

  const mockPermissionsService = {
    getUserRoles: jest.fn(),
  };

  const mockUserService = {
    getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
  };

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudTelephonyController],
      providers: [
        {
          provide: CloudTelephonyService,
          useValue: mockCloudTelephonyService,
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
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        RolesGuard,
      ],
    }).compile();

    controller = module.get<CloudTelephonyController>(CloudTelephonyController);
    service = module.get(CloudTelephonyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createCloudTelephonyIntegration', () => {
    const validCreateDto: CreateCloudTelephonyIntegrationDto = {
      provider: CloudTelephonyProvider.OZONETEL,
      credentials: {
        apiKey: 'test-api-key',
        username: 'test-username',
      },
      code: 'TEST_CODE',
      tenantId: 'test-tenant-id',
    };

    const expectedResponse: CloudTelephonyIntegrationResponseDto = {
      id: 'test-integration-id',
      provider: CloudTelephonyProvider.OZONETEL,
    };

    it('should successfully create a cloud telephony integration', async () => {
      // Arrange
      service.createCloudTelephonyIntegration.mockResolvedValue(
        expectedResponse,
      );

      // Act
      const result =
        await controller.createCloudTelephonyIntegration(validCreateDto);

      // Assert
      expect(service.createCloudTelephonyIntegration).toHaveBeenCalledWith(
        validCreateDto,
      );
      expect(service.createCloudTelephonyIntegration).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResponse);
    });

    it('should handle various service errors', async () => {
      // Test BadRequestException with specific message
      const badRequestError = new BadRequestException(
        'Missing required fields for Ozonetel credentials: apiKey',
      );
      service.createCloudTelephonyIntegration.mockRejectedValue(
        badRequestError,
      );

      await expect(
        controller.createCloudTelephonyIntegration(validCreateDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.createCloudTelephonyIntegration(validCreateDto),
      ).rejects.toThrow(
        'Missing required fields for Ozonetel credentials: apiKey',
      );

      expect(service.createCloudTelephonyIntegration).toHaveBeenCalledWith(
        validCreateDto,
      );

      // Reset mock
      service.createCloudTelephonyIntegration.mockClear();

      // Test generic BadRequestException
      const genericBadRequestError = new BadRequestException(
        'Failed to create cloud telephony integration',
      );
      service.createCloudTelephonyIntegration.mockRejectedValue(
        genericBadRequestError,
      );

      await expect(
        controller.createCloudTelephonyIntegration(validCreateDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.createCloudTelephonyIntegration(validCreateDto),
      ).rejects.toThrow('Failed to create cloud telephony integration');

      expect(service.createCloudTelephonyIntegration).toHaveBeenCalledWith(
        validCreateDto,
      );
    });

    it('should handle service throwing non-BadRequestException', async () => {
      // Arrange
      const genericError = new Error('Database connection failed');
      service.createCloudTelephonyIntegration.mockRejectedValue(genericError);

      // Act & Assert
      await expect(
        controller.createCloudTelephonyIntegration(validCreateDto),
      ).rejects.toThrow('Database connection failed');
      expect(service.createCloudTelephonyIntegration).toHaveBeenCalledWith(
        validCreateDto,
      );
      expect(service.createCloudTelephonyIntegration).toHaveBeenCalledTimes(1);
    });

    it('should handle various DTO and response formats', async () => {
      // Test custom DTO
      const customDto: CreateCloudTelephonyIntegrationDto = {
        provider: CloudTelephonyProvider.OZONETEL,
        credentials: {
          apiKey: 'custom-api-key',
          username: 'custom-username',
        },
        code: 'CUSTOM_CODE',
        tenantId: 'custom-tenant-id',
      };
      service.createCloudTelephonyIntegration.mockResolvedValue(
        expectedResponse,
      );

      await controller.createCloudTelephonyIntegration(customDto);

      expect(service.createCloudTelephonyIntegration).toHaveBeenCalledWith(
        customDto,
      );

      // Reset mock
      service.createCloudTelephonyIntegration.mockClear();

      // Test custom response
      const customResponse: CloudTelephonyIntegrationResponseDto = {
        id: 'custom-integration-id',
        provider: CloudTelephonyProvider.OZONETEL,
      };
      service.createCloudTelephonyIntegration.mockResolvedValue(customResponse);

      const result =
        await controller.createCloudTelephonyIntegration(validCreateDto);

      expect(result).toEqual(customResponse);
      expect(result.id).toBe(customResponse.id);
      expect(result.provider).toBe(customResponse.provider);
    });
  });
});

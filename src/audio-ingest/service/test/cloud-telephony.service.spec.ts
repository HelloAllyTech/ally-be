import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CloudTelephonyService } from '../cloud-telephony.service';
import { CloudTelephonyRepository } from '../../repository/cloud-telephony.repository';
import { CryptoService } from '../../../common/service/crypto.service';
import { AppConfigService } from '../../../config/config.service';
import { CloudTelephonyProvider } from '../../../common/constants/chat.constants';
import { IntegrationStatus } from '../../type/cloud-telephony.type';
import { CloudTelephonyIntegration } from '../../../common/entities/cloud-telephony-integration.entity';
import {
  CreateCloudTelephonyIntegrationDto,
  CloudTelephonyIntegrationResponseDto,
} from '../../dto/cloud-telephony.dto';

describe('CloudTelephonyService', () => {
  let service: CloudTelephonyService;
  let cloudTelephonyRepository: jest.Mocked<CloudTelephonyRepository>;
  let cryptoService: jest.Mocked<CryptoService>;

  const mockCloudTelephonyIntegration: CloudTelephonyIntegration = {
    id: 'test-id-123',
    provider: CloudTelephonyProvider.OZONETEL,
    credentials: 'encrypted-credentials',
    status: IntegrationStatus.ACTIVE,
    code: 'TEST_CODE',
    tenantId: 'tenant-123',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockOzonetelCredentials = {
    apiKey: 'test-api-key',
    username: 'test-username',
  };

  const mockCreateDto: CreateCloudTelephonyIntegrationDto = {
    provider: CloudTelephonyProvider.OZONETEL,
    credentials: mockOzonetelCredentials,
    code: 'TEST_CODE',
    tenantId: 'tenant-123',
  };

  beforeEach(async () => {
    const mockCloudTelephonyRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByCode: jest.fn(),
      findByTenantId: jest.fn(),
      updateById: jest.fn(),
    };

    const mockCryptoService = {
      encrypt: jest.fn(),
      decrypt: jest.fn(),
    };

    const mockAppConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudTelephonyService,
        {
          provide: CloudTelephonyRepository,
          useValue: mockCloudTelephonyRepository,
        },
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
        {
          provide: AppConfigService,
          useValue: mockAppConfigService,
        },
      ],
    }).compile();

    service = module.get<CloudTelephonyService>(CloudTelephonyService);
    cloudTelephonyRepository = module.get(CloudTelephonyRepository);
    cryptoService = module.get(CryptoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateCredentials', () => {
    it('should validate Ozonetel credentials successfully', () => {
      const credentials = {
        apiKey: 'test-api-key',
        username: 'test-username',
      };

      expect(() => {
        service['validateCredentials'](
          CloudTelephonyProvider.OZONETEL,
          credentials,
        );
      }).not.toThrow();
    });

    it('should throw BadRequestException for unsupported provider', () => {
      const credentials = { apiKey: 'test' };

      expect(() => {
        service['validateCredentials'](
          'UNSUPPORTED_PROVIDER' as CloudTelephonyProvider,
          credentials,
        );
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateCredentials'](
          'UNSUPPORTED_PROVIDER' as CloudTelephonyProvider,
          credentials,
        );
      }).toThrow('Unsupported provider: UNSUPPORTED_PROVIDER');
    });
  });

  describe('validateOzonetelCredentials', () => {
    it('should validate Ozonetel credentials with all required fields', () => {
      const credentials = {
        apiKey: 'test-api-key',
        username: 'test-username',
      };

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).not.toThrow();
    });

    it('should throw BadRequestException when apiKey is missing', () => {
      const credentials = {
        username: 'test-username',
      };

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow('Missing required fields for Ozonetel credentials: apiKey');
    });

    it('should throw BadRequestException when username is missing', () => {
      const credentials = {
        apiKey: 'test-api-key',
      };

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow('Missing required fields for Ozonetel credentials: username');
    });

    it('should throw BadRequestException when both apiKey and username are missing', () => {
      const credentials = {};

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(
        'Missing required fields for Ozonetel credentials: apiKey, username',
      );
    });

    it('should throw BadRequestException when apiKey is not a string', () => {
      const credentials = {
        apiKey: 123,
        username: 'test-username',
      };

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow('All Ozonetel credential fields must be strings');
    });

    it('should throw BadRequestException when username is not a string', () => {
      const credentials = {
        apiKey: 'test-api-key',
        username: 123,
      };

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow('All Ozonetel credential fields must be strings');
    });

    it('should throw BadRequestException when both fields are not strings', () => {
      const credentials = {
        apiKey: 123,
        username: 456,
      };

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow('All Ozonetel credential fields must be strings');
    });

    it('should throw BadRequestException when apiKey is empty string', () => {
      const credentials = {
        apiKey: '',
        username: 'test-username',
      };

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow('Missing required fields for Ozonetel credentials: apiKey');
    });

    it('should throw BadRequestException when username is empty string', () => {
      const credentials = {
        apiKey: 'test-api-key',
        username: '',
      };

      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow(BadRequestException);
      expect(() => {
        service['validateOzonetelCredentials'](credentials);
      }).toThrow('Missing required fields for Ozonetel credentials: username');
    });
  });

  describe('createCloudTelephonyIntegration', () => {
    it('should create cloud telephony integration successfully', async () => {
      const encryptedCredentials = 'encrypted-credentials-string';
      const expectedResponse: CloudTelephonyIntegrationResponseDto = {
        id: 'test-id-123',
        provider: CloudTelephonyProvider.OZONETEL,
      };

      cryptoService.encrypt.mockResolvedValue(encryptedCredentials);
      cloudTelephonyRepository.create.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );

      const result =
        await service.createCloudTelephonyIntegration(mockCreateDto);

      expect(cryptoService.encrypt).toHaveBeenCalledWith(
        JSON.stringify(mockOzonetelCredentials),
        undefined, // encryption key from config
      );
      expect(cloudTelephonyRepository.create).toHaveBeenCalledWith({
        credentials: encryptedCredentials,
        code: mockCreateDto.code,
        tenantId: mockCreateDto.tenantId,
        provider: mockCreateDto.provider,
      });
      expect(result).toEqual(expectedResponse);
    });

    it('should throw BadRequestException when crypto service fails', async () => {
      cryptoService.encrypt.mockRejectedValue(new Error('Encryption failed'));

      await expect(
        service.createCloudTelephonyIntegration(mockCreateDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createCloudTelephonyIntegration(mockCreateDto),
      ).rejects.toThrow('Failed to create cloud telephony integration');
    });

    it('should throw BadRequestException when repository fails', async () => {
      const encryptedCredentials = 'encrypted-credentials-string';
      cryptoService.encrypt.mockResolvedValue(encryptedCredentials);
      cloudTelephonyRepository.create.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.createCloudTelephonyIntegration(mockCreateDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createCloudTelephonyIntegration(mockCreateDto),
      ).rejects.toThrow('Failed to create cloud telephony integration');
    });

    it('should throw BadRequestException when credentials validation fails', async () => {
      const invalidDto = {
        ...mockCreateDto,
        credentials: { apiKey: 'test' }, // missing username
      };

      await expect(
        service.createCloudTelephonyIntegration(invalidDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createCloudTelephonyIntegration(invalidDto),
      ).rejects.toThrow(
        'Missing required fields for Ozonetel credentials: username',
      );
    });
  });

  describe('getCloudTelephonyIntegrationByCode', () => {
    it('should return cloud telephony integration with decrypted credentials', async () => {
      const decryptedCredentials = JSON.stringify(mockOzonetelCredentials);
      const expectedResult = {
        ...mockCloudTelephonyIntegration,
        credentials: mockOzonetelCredentials,
      };

      cloudTelephonyRepository.findByCode.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cryptoService.decrypt.mockResolvedValue(decryptedCredentials);

      const result =
        await service.getCloudTelephonyIntegrationByCode('TEST_CODE');

      expect(cloudTelephonyRepository.findByCode).toHaveBeenCalledWith(
        'TEST_CODE',
      );
      expect(cryptoService.decrypt).toHaveBeenCalledWith(
        mockCloudTelephonyIntegration.credentials,
        undefined, // encryption key from config
      );
      expect(result).toEqual(expectedResult);
    });

    it('should return null when code is empty string', async () => {
      const result = await service.getCloudTelephonyIntegrationByCode('');

      expect(cloudTelephonyRepository.findByCode).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when code is whitespace only', async () => {
      const result = await service.getCloudTelephonyIntegrationByCode('   ');

      expect(cloudTelephonyRepository.findByCode).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when code is null', async () => {
      const result = await service.getCloudTelephonyIntegrationByCode(
        null as any,
      );

      expect(cloudTelephonyRepository.findByCode).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when code is undefined', async () => {
      const result = await service.getCloudTelephonyIntegrationByCode(
        undefined as any,
      );

      expect(cloudTelephonyRepository.findByCode).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when integration is not found', async () => {
      cloudTelephonyRepository.findByCode.mockResolvedValue(null);

      const result =
        await service.getCloudTelephonyIntegrationByCode('NON_EXISTENT_CODE');

      expect(cloudTelephonyRepository.findByCode).toHaveBeenCalledWith(
        'NON_EXISTENT_CODE',
      );
      expect(cryptoService.decrypt).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle decryption errors gracefully', async () => {
      cloudTelephonyRepository.findByCode.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cryptoService.decrypt.mockRejectedValue(new Error('Decryption failed'));

      await expect(
        service.getCloudTelephonyIntegrationByCode('TEST_CODE'),
      ).rejects.toThrow('Decryption failed');
    });
  });

  describe('getCloudTelephonyIntegrationByTenantId', () => {
    it('should return cloud telephony integration with decrypted credentials', async () => {
      const decryptedCredentials = JSON.stringify(mockOzonetelCredentials);
      const expectedResult = {
        ...mockCloudTelephonyIntegration,
        credentials: mockOzonetelCredentials,
      };

      cloudTelephonyRepository.findByTenantId.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cryptoService.decrypt.mockResolvedValue(decryptedCredentials);

      const result =
        await service.getCloudTelephonyIntegrationByTenantId('tenant-123');

      expect(cloudTelephonyRepository.findByTenantId).toHaveBeenCalledWith(
        'tenant-123',
      );
      expect(cryptoService.decrypt).toHaveBeenCalledWith(
        mockCloudTelephonyIntegration.credentials,
        undefined, // encryption key from config
      );
      expect(result).toEqual(expectedResult);
    });

    it('should return null when tenantId is empty string', async () => {
      const result = await service.getCloudTelephonyIntegrationByTenantId('');

      expect(cloudTelephonyRepository.findByTenantId).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when tenantId is whitespace only', async () => {
      const result =
        await service.getCloudTelephonyIntegrationByTenantId('   ');

      expect(cloudTelephonyRepository.findByTenantId).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when tenantId is null', async () => {
      const result = await service.getCloudTelephonyIntegrationByTenantId(
        null as any,
      );

      expect(cloudTelephonyRepository.findByTenantId).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when tenantId is undefined', async () => {
      const result = await service.getCloudTelephonyIntegrationByTenantId(
        undefined as any,
      );

      expect(cloudTelephonyRepository.findByTenantId).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when integration is not found', async () => {
      cloudTelephonyRepository.findByTenantId.mockResolvedValue(null);

      const result = await service.getCloudTelephonyIntegrationByTenantId(
        'non-existent-tenant',
      );

      expect(cloudTelephonyRepository.findByTenantId).toHaveBeenCalledWith(
        'non-existent-tenant',
      );
      expect(cryptoService.decrypt).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle decryption errors gracefully', async () => {
      cloudTelephonyRepository.findByTenantId.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cryptoService.decrypt.mockRejectedValue(new Error('Decryption failed'));

      await expect(
        service.getCloudTelephonyIntegrationByTenantId('tenant-123'),
      ).rejects.toThrow('Decryption failed');
    });
  });

  describe('updateCloudTelephonyIntegration', () => {
    it('should update cloud telephony integration successfully', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      cloudTelephonyRepository.findById.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cloudTelephonyRepository.updateById.mockResolvedValue(undefined);

      await service.updateCloudTelephonyIntegration('test-id-123', updateData);

      expect(cloudTelephonyRepository.findById).toHaveBeenCalledWith(
        'test-id-123',
      );
      expect(cloudTelephonyRepository.updateById).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should throw NotFoundException when integration is not found', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      cloudTelephonyRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateCloudTelephonyIntegration('non-existent-id', updateData),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateCloudTelephonyIntegration('non-existent-id', updateData),
      ).rejects.toThrow('Cloud telephony integration not found');

      expect(cloudTelephonyRepository.findById).toHaveBeenCalledWith(
        'non-existent-id',
      );
      expect(cloudTelephonyRepository.updateById).not.toHaveBeenCalled();
    });

    it('should handle repository update errors', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      cloudTelephonyRepository.findById.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cloudTelephonyRepository.updateById.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.updateCloudTelephonyIntegration('test-id-123', updateData),
      ).rejects.toThrow('Database error');
    });

    it('should update with partial data', async () => {
      const updateData = { config: { callEventsEnabled: true } };
      cloudTelephonyRepository.findById.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cloudTelephonyRepository.updateById.mockResolvedValue(undefined);

      await service.updateCloudTelephonyIntegration('test-id-123', updateData);

      expect(cloudTelephonyRepository.findById).toHaveBeenCalledWith(
        'test-id-123',
      );
      expect(cloudTelephonyRepository.updateById).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should update with empty data object', async () => {
      const updateData = {};
      cloudTelephonyRepository.findById.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cloudTelephonyRepository.updateById.mockResolvedValue(undefined);

      await service.updateCloudTelephonyIntegration('test-id-123', updateData);

      expect(cloudTelephonyRepository.findById).toHaveBeenCalledWith(
        'test-id-123',
      );
      expect(cloudTelephonyRepository.updateById).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete flow from creation to retrieval', async () => {
      // Create integration
      const encryptedCredentials = 'encrypted-credentials-string';
      cryptoService.encrypt.mockResolvedValue(encryptedCredentials);
      cloudTelephonyRepository.create.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );

      const createResult =
        await service.createCloudTelephonyIntegration(mockCreateDto);
      expect(createResult.id).toBe('test-id-123');

      // Retrieve by code
      const decryptedCredentials = JSON.stringify(mockOzonetelCredentials);
      cloudTelephonyRepository.findByCode.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cryptoService.decrypt.mockResolvedValue(decryptedCredentials);

      const getByCodeResult =
        await service.getCloudTelephonyIntegrationByCode('TEST_CODE');
      expect(getByCodeResult?.credentials).toEqual(mockOzonetelCredentials);

      // Retrieve by tenant ID
      cloudTelephonyRepository.findByTenantId.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      const getByTenantResult =
        await service.getCloudTelephonyIntegrationByTenantId('tenant-123');
      expect(getByTenantResult?.credentials).toEqual(mockOzonetelCredentials);

      // Update integration
      cloudTelephonyRepository.findById.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
      cloudTelephonyRepository.updateById.mockResolvedValue(undefined);

      await service.updateCloudTelephonyIntegration('test-id-123', {
        status: IntegrationStatus.INACTIVE,
      });

      expect(cloudTelephonyRepository.updateById).toHaveBeenCalledWith(
        'test-id-123',
        {
          status: IntegrationStatus.INACTIVE,
        },
      );
    });
  });
});

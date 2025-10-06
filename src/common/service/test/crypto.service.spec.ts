import { CryptoService } from '../crypto.service';

// Mock crypto module completely
jest.mock('crypto', () => ({
  randomBytes: jest.fn(),
  createCipheriv: jest.fn(),
  createDecipheriv: jest.fn(),
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mock-hash'),
  })),
  constants: {
    RSA_PKCS1_OAEP_PADDING: 4,
  },
  publicEncrypt: jest.fn(),
  privateDecrypt: jest.fn(),
  createSign: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    sign: jest.fn().mockReturnValue('mock-signature'),
  })),
  createVerify: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    verify: jest.fn().mockReturnValue(true),
  })),
}));

// Mock LoggerService
const mockLoggerInstance = {
  debug: jest.fn(),
  error: jest.fn(),
};

jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => mockLoggerInstance),
  },
}));

describe('CryptoService', () => {
  let service: CryptoService;
  let mockConfigService: any;
  let mockCrypto: any;

  const mockEncryptionKey = 'a'.repeat(64); // 32 bytes hex-encoded

  beforeEach(() => {
    mockConfigService = {
      cloudTelephony: {
        credentialsEncryptionKey: mockEncryptionKey,
      },
    };

    mockCrypto = require('crypto');

    // Direct instantiation to avoid NestJS module compilation issues
    service = new CryptoService(mockConfigService);
  });

  describe('getEncryptionKey', () => {
    it('should throw error when no encryption key is available', () => {
      mockConfigService.cloudTelephony.credentialsEncryptionKey = undefined;

      expect(() => (service as any).getEncryptionKey()).toThrow(
        'No encryption key available',
      );
    });

    it('should throw error when encryption key has invalid length', () => {
      mockConfigService.cloudTelephony.credentialsEncryptionKey = 'invalid';

      expect(() => (service as any).getEncryptionKey()).toThrow(
        'Encryption key must be 32 bytes (hex-encoded 64 chars)',
      );
    });

    it('should return valid encryption key buffer', () => {
      const result = (service as any).getEncryptionKey();

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(32);
    });
  });

  describe('encrypt', () => {
    it('should throw error when encryption fails', async () => {
      const mockError = new Error('Crypto error');
      mockCrypto.createCipheriv.mockImplementation(() => {
        throw mockError;
      });

      await expect(service.encrypt('test data')).rejects.toThrow(
        'Failed to encrypt data',
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Encryption failed',
        mockError,
      );
    });

    it('should encrypt data successfully', async () => {
      const testData = 'test data';
      const mockIv = Buffer.from('mock-iv-data');
      const mockEncrypted = Buffer.from('encrypted-data');
      const mockTag = Buffer.from('mock-tag');
      const mockCombined = Buffer.from('combined-data');

      (mockCrypto.randomBytes as jest.Mock).mockReturnValue(mockIv);
      const mockCipher = {
        update: jest.fn().mockReturnValue(mockEncrypted),
        final: jest.fn().mockReturnValue(Buffer.alloc(0)),
        getAuthTag: jest.fn().mockReturnValue(mockTag),
      } as any;
      mockCrypto.createCipheriv.mockReturnValue(mockCipher);
      (Buffer.concat as jest.Mock) = jest.fn().mockReturnValue(mockCombined);

      const result = await service.encrypt(testData);

      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(12);
      expect(mockCrypto.createCipheriv).toHaveBeenCalledWith(
        'aes-256-gcm',
        expect.any(Buffer),
        mockIv,
      );
      expect(mockCipher.update).toHaveBeenCalledWith(testData, 'utf8');
      expect(mockCipher.final).toHaveBeenCalled();
      expect(mockCipher.getAuthTag).toHaveBeenCalled();
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        'Data encrypted successfully',
      );
      expect(result).toBe(mockCombined.toString('base64'));
    });
  });

  describe('decrypt', () => {
    it('should throw error when decryption fails', async () => {
      const mockError = new Error('Decryption error');
      mockCrypto.createDecipheriv.mockImplementation(() => {
        throw mockError;
      });

      await expect(service.decrypt('encrypted-data')).rejects.toThrow(
        'Failed to decrypt data',
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Decryption failed',
        mockError,
      );
    });

    it('should decrypt data successfully', async () => {
      const encryptedData = 'dGVzdC1kYXRh'; // base64 encoded
      const mockDecrypted = 'decrypted data';

      // Create a proper mock buffer that behaves like the real Buffer
      const mockCombined = {
        subarray: jest.fn((start: number, end?: number) => {
          if (start === 0 && end === 12) return Buffer.from('mock-iv');
          if (start === 12 && end === 28) return Buffer.from('mock-tag');
          if (start === 28) return Buffer.from('mock-encrypted');
          return Buffer.from('mock-data');
        }),
      };

      // Mock Buffer.from to return our mock buffer
      const originalBufferFrom = Buffer.from;
      Buffer.from = jest.fn((data: any, encoding?: any) => {
        if (encoding === 'base64') {
          return mockCombined as any;
        }
        return originalBufferFrom(data, encoding);
      });

      const mockDecipher = {
        setAuthTag: jest.fn(),
        update: jest.fn().mockReturnValue(mockDecrypted),
        final: jest.fn().mockReturnValue(''),
      };
      mockCrypto.createDecipheriv.mockReturnValue(mockDecipher as any);

      const result = await service.decrypt(encryptedData);

      expect(Buffer.from).toHaveBeenCalledWith(encryptedData, 'base64');
      expect(mockCrypto.createDecipheriv).toHaveBeenCalledWith(
        'aes-256-gcm',
        expect.any(Buffer),
        expect.any(Buffer),
      );
      expect(mockDecipher.setAuthTag).toHaveBeenCalled();
      expect(mockDecipher.update).toHaveBeenCalledWith(
        expect.any(Buffer),
        undefined,
        'utf8',
      );
      expect(mockDecipher.final).toHaveBeenCalledWith('utf8');
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        'Data decrypted successfully',
      );
      expect(result).toBe(mockDecrypted);

      // Restore original Buffer.from
      Buffer.from = originalBufferFrom;
    });
  });
});

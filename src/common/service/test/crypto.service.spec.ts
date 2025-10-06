import { CryptoService } from '../crypto.service';

// Mock crypto module
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

  const validEncryptionKey = 'a'.repeat(64); // 32 bytes hex-encoded

  beforeEach(() => {
    mockConfigService = {
      cloudTelephony: {
        credentialsEncryptionKey: validEncryptionKey,
      },
    };

    mockCrypto = require('crypto');

    // Direct instantiation to avoid NestJS module compilation issues
    service = new CryptoService(mockConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('encrypt', () => {
    it('should encrypt data successfully', async () => {
      const testData = 'test data';
      const mockIv = Buffer.from('mock-iv-12-bytes');
      const mockEncrypted = Buffer.from('encrypted-data');
      const mockTag = Buffer.from('mock-tag-16-bytes');
      const mockCombined = Buffer.from('combined-data');

      // Mock crypto functions
      mockCrypto.randomBytes.mockReturnValue(mockIv);
      const mockCipher = {
        update: jest.fn().mockReturnValue(mockEncrypted),
        final: jest.fn().mockReturnValue(Buffer.alloc(0)),
        getAuthTag: jest.fn().mockReturnValue(mockTag),
      };
      mockCrypto.createCipheriv.mockReturnValue(mockCipher);

      // Mock Buffer.concat
      const originalConcat = Buffer.concat;
      Buffer.concat = jest.fn().mockReturnValue(mockCombined);

      const result = await service.encrypt(testData, validEncryptionKey);

      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(12);
      expect(mockCrypto.createCipheriv).toHaveBeenCalledWith(
        'aes-256-gcm',
        expect.any(Buffer),
        mockIv,
      );
      expect(mockCipher.update).toHaveBeenCalledWith(testData, 'utf8');
      expect(mockCipher.final).toHaveBeenCalled();
      expect(mockCipher.getAuthTag).toHaveBeenCalled();
      expect(Buffer.concat).toHaveBeenCalled();
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        'Data encrypted successfully',
      );
      expect(result).toBe(mockCombined.toString('base64'));

      // Restore original Buffer.concat
      Buffer.concat = originalConcat;
    });

    it('should throw error when no encryption key is provided', async () => {
      await expect(service.encrypt('test data')).rejects.toThrow(
        'Failed to encrypt data',
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Encryption failed',
        expect.any(Error),
      );
    });

    it('should throw error when encryption key has invalid length', async () => {
      const invalidKey = 'invalid-key';
      await expect(service.encrypt('test data', invalidKey)).rejects.toThrow(
        'Failed to encrypt data',
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Encryption failed',
        expect.any(Error),
      );
    });

    it('should throw error when encryption key is not hex-encoded', async () => {
      const invalidKey = 'g'.repeat(64); // Invalid hex characters
      await expect(service.encrypt('test data', invalidKey)).rejects.toThrow(
        'Failed to encrypt data',
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Encryption failed',
        expect.any(Error),
      );
    });

    it('should handle crypto errors gracefully', async () => {
      const mockError = new Error('Crypto error');
      mockCrypto.createCipheriv.mockImplementation(() => {
        throw mockError;
      });

      await expect(
        service.encrypt('test data', validEncryptionKey),
      ).rejects.toThrow('Failed to encrypt data');
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Encryption failed',
        mockError,
      );
    });
  });

  describe('decrypt', () => {
    it('should decrypt data successfully', async () => {
      const encryptedData = 'dGVzdC1kYXRh'; // base64 encoded
      const mockDecrypted = 'decrypted data';
      const mockCombined = Buffer.from('mock-combined-data');

      // Mock Buffer.from for base64 decoding
      const originalBufferFrom = Buffer.from;
      Buffer.from = jest.fn((data: any, encoding?: any) => {
        if (encoding === 'base64') {
          return mockCombined;
        }
        return originalBufferFrom(data, encoding);
      });

      // Mock subarray method
      const mockIv = Buffer.from('mock-iv');
      const mockTag = Buffer.from('mock-tag');
      const mockEncrypted = Buffer.from('mock-encrypted');
      mockCombined.subarray = jest.fn((start: number, end?: number) => {
        if (start === 0 && end === 12) return mockIv;
        if (start === 12 && end === 28) return mockTag;
        if (start === 28) return mockEncrypted;
        return Buffer.from('mock-data');
      });

      const mockDecipher = {
        setAuthTag: jest.fn(),
        update: jest.fn().mockReturnValue(mockDecrypted),
        final: jest.fn().mockReturnValue(''),
      };
      mockCrypto.createDecipheriv.mockReturnValue(mockDecipher);

      const result = await service.decrypt(encryptedData, validEncryptionKey);

      expect(Buffer.from).toHaveBeenCalledWith(encryptedData, 'base64');
      expect(mockCombined.subarray).toHaveBeenCalledWith(0, 12); // IV
      expect(mockCombined.subarray).toHaveBeenCalledWith(12, 28); // Tag
      expect(mockCombined.subarray).toHaveBeenCalledWith(28); // Encrypted data
      expect(mockCrypto.createDecipheriv).toHaveBeenCalledWith(
        'aes-256-gcm',
        expect.any(Buffer),
        mockIv,
      );
      expect(mockDecipher.setAuthTag).toHaveBeenCalledWith(mockTag);
      expect(mockDecipher.update).toHaveBeenCalledWith(
        mockEncrypted,
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

    it('should throw error when no encryption key is provided', async () => {
      await expect(service.decrypt('encrypted-data')).rejects.toThrow(
        'Failed to decrypt data',
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Decryption failed',
        expect.any(Error),
      );
    });

    it('should throw error when encryption key has invalid length', async () => {
      const invalidKey = 'invalid-key';
      await expect(
        service.decrypt('encrypted-data', invalidKey),
      ).rejects.toThrow('Failed to decrypt data');
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Decryption failed',
        expect.any(Error),
      );
    });

    it('should throw error when encrypted data is invalid base64', async () => {
      const invalidBase64 = 'invalid-base64-data!';

      // Mock Buffer.from to throw an error for invalid base64
      const originalBufferFrom = Buffer.from;
      Buffer.from = jest.fn((data: any, encoding?: any) => {
        if (encoding === 'base64' && data === invalidBase64) {
          throw new Error('Invalid base64');
        }
        return originalBufferFrom(data, encoding);
      });

      await expect(
        service.decrypt(invalidBase64, validEncryptionKey),
      ).rejects.toThrow('Failed to decrypt data');
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Decryption failed',
        expect.any(Error),
      );

      // Restore original Buffer.from
      Buffer.from = originalBufferFrom;
    });

    it('should handle crypto errors gracefully', async () => {
      const mockError = new Error('Crypto error');
      mockCrypto.createDecipheriv.mockImplementation(() => {
        throw mockError;
      });

      await expect(
        service.decrypt('encrypted-data', validEncryptionKey),
      ).rejects.toThrow('Failed to decrypt data');
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Decryption failed',
        mockError,
      );
    });
  });

  describe('validateAndGetEncryptionKey (private method)', () => {
    it('should validate encryption key through encrypt method', async () => {
      // Test with valid key
      const mockIv = Buffer.from('mock-iv-12-bytes');
      const mockEncrypted = Buffer.from('encrypted-data');
      const mockTag = Buffer.from('mock-tag-16-bytes');
      const mockCombined = Buffer.from('combined-data');

      mockCrypto.randomBytes.mockReturnValue(mockIv);
      const mockCipher = {
        update: jest.fn().mockReturnValue(mockEncrypted),
        final: jest.fn().mockReturnValue(Buffer.alloc(0)),
        getAuthTag: jest.fn().mockReturnValue(mockTag),
      };
      mockCrypto.createCipheriv.mockReturnValue(mockCipher);

      const originalConcat = Buffer.concat;
      Buffer.concat = jest.fn().mockReturnValue(mockCombined);

      // Should not throw with valid key
      await expect(
        service.encrypt('test data', validEncryptionKey),
      ).resolves.toBeDefined();

      Buffer.concat = originalConcat;
    });

    it('should reject invalid encryption key lengths', async () => {
      const shortKey = 'a'.repeat(32); // 16 bytes, too short
      const longKey = 'a'.repeat(128); // 64 bytes, too long

      await expect(service.encrypt('test data', shortKey)).rejects.toThrow(
        'Failed to encrypt data',
      );
      await expect(service.encrypt('test data', longKey)).rejects.toThrow(
        'Failed to encrypt data',
      );
    });
  });

  describe('integration tests', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const testData = 'Hello, World!';

      // Mock successful encryption
      const mockIv = Buffer.from('mock-iv-12-bytes');
      const mockEncrypted = Buffer.from('encrypted-data');
      const mockTag = Buffer.from('mock-tag-16-bytes');
      const mockCombined = Buffer.from('combined-data');

      mockCrypto.randomBytes.mockReturnValue(mockIv);
      const mockCipher = {
        update: jest.fn().mockReturnValue(mockEncrypted),
        final: jest.fn().mockReturnValue(Buffer.alloc(0)),
        getAuthTag: jest.fn().mockReturnValue(mockTag),
      };
      mockCrypto.createCipheriv.mockReturnValue(mockCipher);

      const originalConcat = Buffer.concat;
      Buffer.concat = jest.fn().mockReturnValue(mockCombined);

      // Encrypt
      const encrypted = await service.encrypt(testData, validEncryptionKey);
      expect(encrypted).toBe(mockCombined.toString('base64'));

      // Mock successful decryption
      const originalBufferFrom = Buffer.from;
      Buffer.from = jest.fn((data: any, encoding?: any) => {
        if (encoding === 'base64') {
          return mockCombined;
        }
        return originalBufferFrom(data, encoding);
      });

      mockCombined.subarray = jest.fn((start: number, end?: number) => {
        if (start === 0 && end === 12) return mockIv;
        if (start === 12 && end === 28) return mockTag;
        if (start === 28) return mockEncrypted;
        return Buffer.from('mock-data');
      });

      const mockDecipher = {
        setAuthTag: jest.fn(),
        update: jest.fn().mockReturnValue(testData),
        final: jest.fn().mockReturnValue(''),
      };
      mockCrypto.createDecipheriv.mockReturnValue(mockDecipher);

      // Decrypt
      const decrypted = await service.decrypt(encrypted, validEncryptionKey);
      expect(decrypted).toBe(testData);

      // Restore originals
      Buffer.concat = originalConcat;
      Buffer.from = originalBufferFrom;
    });
  });
});

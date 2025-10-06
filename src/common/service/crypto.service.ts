import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import * as crypto from 'crypto';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class CryptoService {
  private readonly logger = LoggerService.getInstance(CryptoService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32;
  private readonly ivLength = 12;
  private readonly tagLength = 16;

  constructor(private readonly configService: AppConfigService) {}

  private validateAndGetEncryptionKey(encryptionKeyHex?: string): Buffer {
    if (!encryptionKeyHex) {
      throw new Error('No encryption key available');
    }

    const keyBuffer = Buffer.from(encryptionKeyHex, 'hex');
    if (keyBuffer.length !== this.keyLength) {
      throw new Error(
        `Encryption key must be ${this.keyLength} bytes (hex-encoded 64 chars)`,
      );
    }

    return keyBuffer;
  }

  async encrypt(data: string, encryptionKey?: string): Promise<string> {
    try {
      const key = this.validateAndGetEncryptionKey(encryptionKey);
      const iv = crypto.randomBytes(this.ivLength);

      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      let encrypted = cipher.update(data, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      const tag = cipher.getAuthTag();

      // Combine IV + tag + ciphertext
      const combined = Buffer.concat([iv, tag, encrypted]);

      this.logger.debug('Data encrypted successfully');
      return combined.toString('base64');
    } catch (error) {
      this.logger.error('Encryption failed', error);
      throw new Error('Failed to encrypt data');
    }
  }

  async decrypt(
    encryptedData: string,
    encryptionKey?: string,
  ): Promise<string> {
    try {
      const key = this.validateAndGetEncryptionKey(encryptionKey);
      const combined = Buffer.from(encryptedData, 'base64');

      const iv = combined.subarray(0, this.ivLength);
      const tag = combined.subarray(
        this.ivLength,
        this.ivLength + this.tagLength,
      );
      const encrypted = combined.subarray(this.ivLength + this.tagLength);

      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      this.logger.debug('Data decrypted successfully');
      return decrypted;
    } catch (error) {
      this.logger.error('Decryption failed', error);
      throw new Error('Failed to decrypt data');
    }
  }
}

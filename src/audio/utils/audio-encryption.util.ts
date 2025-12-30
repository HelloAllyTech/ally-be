import * as crypto from 'crypto';
import * as fs from 'fs';

export interface EncryptionMetadata {
  key: string; // hex string, store securely in KMS
  iv: string;
  authTag: string;
}

export class AudioEncryptionUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';

  /**
   * Create a cipher stream and write directly to encrypted file.
   */
  static createEncryptionStream(outputPath: string) {
    const key = crypto.randomBytes(32); // 256-bit key
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    const writeStream = fs.createWriteStream(outputPath);
    cipher.pipe(writeStream);

    return {
      cipher,
      writeStream,
      key,
      iv,
    };
  }

  /**
   * Finalize encryption, return metadata needed for decryption.
   */
  static async finalizeEncryption(
    cipher: crypto.CipherGCM,
    key: Buffer,
    iv: Buffer,
    writeStream: fs.WriteStream,
  ): Promise<EncryptionMetadata> {
    return new Promise((resolve, reject) => {
      cipher.end();
      writeStream.on('finish', () => {
        const authTag = cipher.getAuthTag();
        resolve({
          key: key.toString('hex'),
          iv: iv.toString('hex'),
          authTag: authTag.toString('hex'),
        });
      });
      writeStream.on('error', reject);
    });
  }

  /**
   * Create a decryption stream from encrypted file → raw PCM.
   */
  static createDecryptionStream(
    inputPath: string,
    outputPath: string,
    metadata: EncryptionMetadata,
  ) {
    const decipher = crypto.createDecipheriv(
      this.ALGORITHM,
      Buffer.from(metadata.key, 'hex'),
      Buffer.from(metadata.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(metadata.authTag, 'hex'));

    const readStream = fs.createReadStream(inputPath);
    const writeStream = fs.createWriteStream(outputPath);

    readStream.pipe(decipher).pipe(writeStream);

    return { readStream, decipher, writeStream };
  }

  /**
   * Decrypt file directly to buffer for S3 upload
   */
  static async decryptToBuffer(
    inputPath: string,
    metadata: EncryptionMetadata,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const decipher = crypto.createDecipheriv(
        this.ALGORITHM,
        Buffer.from(metadata.key, 'hex'),
        Buffer.from(metadata.iv, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(metadata.authTag, 'hex'));

      const readStream = fs.createReadStream(inputPath);
      const chunks: Buffer[] = [];

      readStream
        .pipe(decipher)
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .on('end', () => resolve(Buffer.concat(chunks)))
        .on('error', reject);
    });
  }
}

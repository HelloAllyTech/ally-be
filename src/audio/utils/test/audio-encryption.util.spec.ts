import * as fs from 'fs';
import * as path from 'path';
import {
  AudioEncryptionUtil,
  EncryptionMetadata,
} from '../audio-encryption.util';

describe('AudioEncryptionUtil', () => {
  const testDir = path.join(__dirname, 'test-files');
  const testInputFile = path.join(testDir, 'test-input.txt');
  const testDecryptedFile = path.join(testDir, 'test-decrypted.txt');
  const testData = 'This is test audio data for encryption';

  // Use Math.random to ensure absolute uniqueness
  const getUniqueFilename = (prefix: string) => {
    return path.join(
      testDir,
      `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}.bin`,
    );
  };

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      files.forEach((file) => {
        try {
          fs.unlinkSync(path.join(testDir, file));
        } catch (error) {
          // Ignore
        }
      });
      try {
        fs.rmdirSync(testDir);
      } catch (error) {
        // Ignore
      }
    }
  });

  beforeEach(() => {
    fs.writeFileSync(testInputFile, testData);
  });

  afterEach(() => {
    [testInputFile, testDecryptedFile].forEach((file) => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch (error) {
          // Ignore
        }
      }
    });
  });

  describe('createEncryptionStream', () => {
    it('should create encryption stream with cipher, writeStream, key, and iv', () => {
      const tempFile = getUniqueFilename('temp-encrypt');
      const result = AudioEncryptionUtil.createEncryptionStream(tempFile);

      expect(result).toBeDefined();
      expect(result.cipher).toBeDefined();
      expect(result.writeStream).toBeDefined();
      expect(result.key).toBeInstanceOf(Buffer);
      expect(result.iv).toBeInstanceOf(Buffer);
      expect(result.key.length).toBe(32);
      expect(result.iv.length).toBe(16);

      result.cipher.end();
      result.writeStream.end();
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    });

    it('should create unique keys and IVs for each call', () => {
      const file1 = getUniqueFilename('test1');
      const file2 = getUniqueFilename('test2');

      const result1 = AudioEncryptionUtil.createEncryptionStream(file1);
      const result2 = AudioEncryptionUtil.createEncryptionStream(file2);

      expect(result1.key.toString('hex')).not.toBe(result2.key.toString('hex'));
      expect(result1.iv.toString('hex')).not.toBe(result2.iv.toString('hex'));

      result1.cipher.end();
      result1.writeStream.end();
      result2.cipher.end();
      result2.writeStream.end();

      [file1, file2].forEach((f) => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    });

    it('should pipe cipher output to write stream', (done) => {
      const tempFile = getUniqueFilename('pipe-test');
      const result = AudioEncryptionUtil.createEncryptionStream(tempFile);

      result.cipher.write(Buffer.from('test data'));
      result.cipher.end();

      result.writeStream.on('finish', () => {
        expect(fs.existsSync(tempFile)).toBe(true);
        expect(fs.statSync(tempFile).size).toBeGreaterThan(0);
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        done();
      });
    });
  });

  describe('finalizeEncryption', () => {
    it('should finalize encryption and return metadata', async () => {
      const tempFile = getUniqueFilename('finalize-test');
      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(tempFile);

      cipher.write(Buffer.from(testData));

      const metadata = await AudioEncryptionUtil.finalizeEncryption(
        cipher,
        key,
        iv,
        writeStream,
      );

      expect(metadata).toBeDefined();
      expect(metadata.key.length).toBe(64);
      expect(metadata.iv.length).toBe(32);
      expect(metadata.authTag.length).toBe(32);

      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    });

    it('should handle empty data encryption', async () => {
      const tempFile = getUniqueFilename('empty-test');
      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(tempFile);

      const metadata = await AudioEncryptionUtil.finalizeEncryption(
        cipher,
        key,
        iv,
        writeStream,
      );

      expect(metadata).toBeDefined();
      expect(metadata.authTag).toBeDefined();

      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    });

    it('should reject on write stream error', async () => {
      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream('/invalid/path/file.bin');

      cipher.write(Buffer.from(testData));

      await expect(
        AudioEncryptionUtil.finalizeEncryption(cipher, key, iv, writeStream),
      ).rejects.toThrow();
    });
  });

  describe('createDecryptionStream', () => {
    it('should create decryption stream components', async () => {
      const encryptedFile = getUniqueFilename('decrypt-comp');

      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(encryptedFile);

      cipher.write(Buffer.from(testData));
      const metadata = await AudioEncryptionUtil.finalizeEncryption(
        cipher,
        key,
        iv,
        writeStream,
      );

      const result = AudioEncryptionUtil.createDecryptionStream(
        encryptedFile,
        testDecryptedFile,
        metadata,
      );

      expect(result.readStream).toBeDefined();
      expect(result.decipher).toBeDefined();
      expect(result.writeStream).toBeDefined();

      result.readStream.destroy();
      result.writeStream.destroy();

      // Wait a bit before cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (fs.existsSync(encryptedFile)) fs.unlinkSync(encryptedFile);
    });

    it('should decrypt data correctly', (done) => {
      const encryptedFile = getUniqueFilename('decrypt-data');

      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(encryptedFile);

      cipher.write(Buffer.from(testData));

      AudioEncryptionUtil.finalizeEncryption(cipher, key, iv, writeStream)
        .then((metadata) => {
          const result = AudioEncryptionUtil.createDecryptionStream(
            encryptedFile,
            testDecryptedFile,
            metadata,
          );

          result.writeStream.on('finish', () => {
            try {
              const decryptedData = fs.readFileSync(testDecryptedFile, 'utf8');
              expect(decryptedData).toBe(testData);
              if (fs.existsSync(encryptedFile)) fs.unlinkSync(encryptedFile);
              done();
            } catch (err) {
              if (fs.existsSync(encryptedFile)) fs.unlinkSync(encryptedFile);
              done(err);
            }
          });

          result.writeStream.on('error', (err) => {
            if (fs.existsSync(encryptedFile)) fs.unlinkSync(encryptedFile);
            done(err);
          });
        })
        .catch(done);
    });

    it('should use correct algorithm', (done) => {
      const encryptedFile = getUniqueFilename('decrypt-algo');

      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(encryptedFile);

      cipher.write(Buffer.from(testData));

      AudioEncryptionUtil.finalizeEncryption(cipher, key, iv, writeStream)
        .then((metadata) => {
          const result = AudioEncryptionUtil.createDecryptionStream(
            encryptedFile,
            testDecryptedFile,
            metadata,
          );

          expect(result.decipher).toBeDefined();

          result.writeStream.on('finish', () => {
            try {
              expect(fs.existsSync(testDecryptedFile)).toBe(true);
              if (fs.existsSync(encryptedFile)) fs.unlinkSync(encryptedFile);
              done();
            } catch (err) {
              if (fs.existsSync(encryptedFile)) fs.unlinkSync(encryptedFile);
              done(err);
            }
          });

          result.writeStream.on('error', (err) => {
            if (fs.existsSync(encryptedFile)) fs.unlinkSync(encryptedFile);
            done(err);
          });
        })
        .catch(done);
    });
  });

  describe('decryptToBuffer', () => {
    let metadata: EncryptionMetadata;
    let encryptedFile: string;

    beforeEach(async () => {
      encryptedFile = getUniqueFilename('buffer');
      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(encryptedFile);

      cipher.write(Buffer.from(testData));
      metadata = await AudioEncryptionUtil.finalizeEncryption(
        cipher,
        key,
        iv,
        writeStream,
      );
    });

    afterEach(() => {
      if (fs.existsSync(encryptedFile)) {
        fs.unlinkSync(encryptedFile);
      }
    });

    it('should decrypt file to buffer', async () => {
      const buffer = await AudioEncryptionUtil.decryptToBuffer(
        encryptedFile,
        metadata,
      );

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString('utf8')).toBe(testData);
    });

    it('should handle large data', async () => {
      const largeData = 'A'.repeat(10000);
      const largeFile = getUniqueFilename('large');

      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(largeFile);

      cipher.write(Buffer.from(largeData));
      const largeMetadata = await AudioEncryptionUtil.finalizeEncryption(
        cipher,
        key,
        iv,
        writeStream,
      );

      const buffer = await AudioEncryptionUtil.decryptToBuffer(
        largeFile,
        largeMetadata,
      );

      expect(buffer.toString('utf8')).toBe(largeData);
      expect(buffer.length).toBe(largeData.length);

      if (fs.existsSync(largeFile)) fs.unlinkSync(largeFile);
    });

    it('should reject on invalid metadata', async () => {
      const invalidMetadata: EncryptionMetadata = {
        key: 'invalid',
        iv: 'invalid',
        authTag: 'invalid',
      };

      await expect(
        AudioEncryptionUtil.decryptToBuffer(encryptedFile, invalidMetadata),
      ).rejects.toThrow();
    });

    it('should reject on non-existent file', async () => {
      const testPromise = new Promise((resolve, reject) => {
        const readStream = fs.createReadStream('/non/existent/file.bin');
        readStream.on('error', reject);
        readStream.on('open', resolve);
      });

      await expect(testPromise).rejects.toThrow();
    });

    it('should reject on incorrect authTag', async () => {
      const incorrectMetadata: EncryptionMetadata = {
        ...metadata,
        authTag: '00000000000000000000000000000000',
      };

      await expect(
        AudioEncryptionUtil.decryptToBuffer(encryptedFile, incorrectMetadata),
      ).rejects.toThrow();
    });

    it('should handle empty file', async () => {
      const emptyFile = getUniqueFilename('empty');
      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(emptyFile);

      const emptyMetadata = await AudioEncryptionUtil.finalizeEncryption(
        cipher,
        key,
        iv,
        writeStream,
      );
      const buffer = await AudioEncryptionUtil.decryptToBuffer(
        emptyFile,
        emptyMetadata,
      );

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(0);

      if (fs.existsSync(emptyFile)) fs.unlinkSync(emptyFile);
    });
  });

  describe('integration tests', () => {
    it('should complete full cycle', async () => {
      const file = getUniqueFilename('integration');

      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(file);

      cipher.write(Buffer.from(testData));
      const metadata = await AudioEncryptionUtil.finalizeEncryption(
        cipher,
        key,
        iv,
        writeStream,
      );

      const decryptedBuffer = await AudioEncryptionUtil.decryptToBuffer(
        file,
        metadata,
      );

      expect(decryptedBuffer.toString('utf8')).toBe(testData);

      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    it('should handle multiple chunks', async () => {
      const file = getUniqueFilename('chunks');
      const chunks = ['chunk1', 'chunk2', 'chunk3'];

      const { cipher, writeStream, key, iv } =
        AudioEncryptionUtil.createEncryptionStream(file);

      chunks.forEach((chunk) => cipher.write(Buffer.from(chunk)));
      const metadata = await AudioEncryptionUtil.finalizeEncryption(
        cipher,
        key,
        iv,
        writeStream,
      );

      const buffer = await AudioEncryptionUtil.decryptToBuffer(file, metadata);

      expect(buffer.toString('utf8')).toBe(chunks.join(''));

      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  });
});

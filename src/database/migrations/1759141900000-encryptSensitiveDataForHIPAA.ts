import { MigrationInterface, QueryRunner } from 'typeorm';
import { CryptoService } from '../../common/service/crypto.service';
import { AppConfigService } from '../../config/config.service';

export class EncryptSensitiveDataForHIPAA1759141900000
  implements MigrationInterface
{
  name = 'encryptSensitiveDataForHIPAA1759141900000';

  private cryptoService: CryptoService;

  constructor() {
    // Initialize the crypto service with config
    const configService = new AppConfigService({} as any);
    this.cryptoService = new CryptoService(configService);
  }

  private async encrypt(text: string): Promise<string> {
    if (!text) return text;

    try {
      // Use the same encryption key as the application
      const encryptionKey = process.env.PHI_DATA_ENCRYPTION_KEY;
      if (!encryptionKey) {
        throw new Error(
          'PHI_DATA_ENCRYPTION_KEY environment variable is not set',
        );
      }
      return await this.cryptoService.encrypt(text, encryptionKey);
    } catch (error) {
      console.warn('Encryption failed, keeping original text:', error.message);
      return text; // Return original text if encryption fails
    }
  }

  private async decrypt(encryptedText: string): Promise<string> {
    if (!encryptedText) return encryptedText;

    try {
      // Check if it's already encrypted (base64 format)
      if (this.isEncrypted(encryptedText)) {
        const encryptionKey = process.env.PHI_DATA_ENCRYPTION_KEY;
        if (!encryptionKey) {
          throw new Error(
            'PHI_DATA_ENCRYPTION_KEY environment variable is not set',
          );
        }
        return await this.cryptoService.decrypt(encryptedText, encryptionKey);
      }
      return encryptedText; // Not encrypted, return as is
    } catch (error) {
      console.warn(
        'Decryption failed, returning original text:',
        error.message,
      );
      return encryptedText; // Return original text if decryption fails
    }
  }

  private isEncrypted(str: string): boolean {
    try {
      // Check if it's base64 and has a reasonable length for encrypted data
      // Encrypted data should be at least 32 characters (IV + tag + some ciphertext)
      if (str.length < 32) return false;

      // Try to decode as base64
      const decoded = atob(str);

      // Check if the decoded data has the expected structure for our encrypted data
      // Our encrypted data should be at least 28 bytes (12 IV + 16 tag + some ciphertext)
      if (decoded.length < 28) return false;

      return btoa(decoded) === str;
    } catch (err) {
      return false;
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('🔐 Starting HIPAA encryption migration...');

    // 1. Encrypt message content
    console.log('Encrypting message content...');
    const messages = await queryRunner.query(
      'SELECT id, content FROM messages WHERE content IS NOT NULL',
    );

    for (const message of messages) {
      if (message.content && !this.isEncrypted(message.content)) {
        // Check if not already encrypted
        const encryptedContent = await this.encrypt(message.content);
        await queryRunner.query(
          'UPDATE messages SET content = $1 WHERE id = $2',
          [encryptedContent, message.id],
        );
      }
    }

    // 2. Encrypt call_details transcript
    console.log('Encrypting call transcripts...');
    const transcripts = await queryRunner.query(
      'SELECT id, transcript FROM call_details WHERE transcript IS NOT NULL',
    );

    for (const transcript of transcripts) {
      if (transcript.transcript && !this.isEncrypted(transcript.transcript)) {
        // Check if not already encrypted
        const encryptedTranscript = await this.encrypt(transcript.transcript);
        await queryRunner.query(
          'UPDATE call_details SET transcript = $1 WHERE id = $2',
          [encryptedTranscript, transcript.id],
        );
      }
    }

    // 3. Encrypt call_details summary (JSONB) - specifically sessionSummary field
    console.log('Encrypting call summaries...');
    const summaries = await queryRunner.query(
      'SELECT id, summary FROM call_details WHERE summary IS NOT NULL',
    );

    for (const summary of summaries) {
      if (
        summary.summary &&
        typeof summary.summary === 'object' &&
        summary.summary.sessionSummary
      ) {
        const sessionSummaryText = summary.summary.sessionSummary;
        if (
          typeof sessionSummaryText === 'string' &&
          !this.isEncrypted(sessionSummaryText)
        ) {
          // Check if not already encrypted
          const encryptedSessionSummary =
            await this.encrypt(sessionSummaryText);
          const updatedSummary = {
            ...summary.summary,
            sessionSummary: encryptedSessionSummary,
          };
          await queryRunner.query(
            'UPDATE call_details SET summary = $1::jsonb WHERE id = $2',
            [JSON.stringify(updatedSummary), summary.id],
          );
        }
      }
    }

    console.log('✅ HIPAA encryption migration completed successfully!');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log('🔓 Starting HIPAA decryption rollback...');

    // 3. Decrypt call_details summary (JSONB) - specifically sessionSummary field
    console.log('Decrypting call summaries...');
    const summaries = await queryRunner.query(
      'SELECT id, summary FROM call_details WHERE summary IS NOT NULL',
    );

    for (const summary of summaries) {
      if (
        summary.summary &&
        typeof summary.summary === 'object' &&
        summary.summary.sessionSummary &&
        typeof summary.summary.sessionSummary === 'string' &&
        this.isEncrypted(summary.summary.sessionSummary)
      ) {
        const decryptedSessionSummary = await this.decrypt(
          summary.summary.sessionSummary,
        );
        const updatedSummary = {
          ...summary.summary,
          sessionSummary: decryptedSessionSummary,
        };
        await queryRunner.query(
          'UPDATE call_details SET summary = $1::jsonb WHERE id = $2',
          [JSON.stringify(updatedSummary), summary.id],
        );
      }
    }

    // 2. Decrypt call_details transcript
    console.log('Decrypting call transcripts...');
    const transcripts = await queryRunner.query(
      'SELECT id, transcript FROM call_details WHERE transcript IS NOT NULL',
    );

    for (const transcript of transcripts) {
      if (transcript.transcript && this.isEncrypted(transcript.transcript)) {
        // Check if encrypted
        const decryptedTranscript = await this.decrypt(transcript.transcript);
        await queryRunner.query(
          'UPDATE call_details SET transcript = $1 WHERE id = $2',
          [decryptedTranscript, transcript.id],
        );
      }
    }

    // 1. Decrypt message content
    console.log('Decrypting message content...');
    const messages = await queryRunner.query(
      'SELECT id, content FROM messages WHERE content IS NOT NULL',
    );

    for (const message of messages) {
      if (message.content && this.isEncrypted(message.content)) {
        // Check if encrypted
        const decryptedContent = await this.decrypt(message.content);
        await queryRunner.query(
          'UPDATE messages SET content = $1 WHERE id = $2',
          [decryptedContent, message.id],
        );
      }
    }

    console.log('✅ HIPAA decryption rollback completed successfully!');
  }
}

import { Injectable } from '@nestjs/common';
import { CryptoService } from 'src/common/service/crypto.service';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_LIMITS,
  HELPLINE_RETENTION,
} from '../constants/helpline.constants';
import { HelplineTalker } from '../entity/helpline-talker.entity';

/**
 * Marks a value this class wrote. Anything without it is legacy plaintext
 * (rows written locally before encryption shipped) and is returned as is, so a
 * read never throws on an old row and never guesses from base64-looking text.
 */
export const HELPLINE_CIPHER_PREFIX = 'hlenc:v1:';

/** What a reader gets when a value carries the prefix but will not decrypt. */
export const HELPLINE_UNREADABLE = '[unreadable]';

/** `helpline_chat_summaries.fields` at rest: one ciphertext of the whole object. */
export interface EncryptedFields {
  enc: string;
}

/**
 * Helpline PHI at rest (contract §4): message bodies of every type, suggestion
 * text inside message metadata, summary fields, the talker's feedback comment,
 * a flag's outcome note and the talker's display name. AES-256-GCM through the
 * same CryptoService and key Scribe uses for transcripts.
 *
 * Rules:
 *  - The retention marker `[erased]` stays plaintext in both directions, so the
 *    blanking SQL and every "is this erased" check keep working without a key.
 *  - Encrypting without a key FAILS (never falls back to plaintext): a message
 *    that cannot be stored safely is not stored.
 *  - Decrypting never throws. Unprefixed text is legacy plaintext; a prefixed
 *    value that will not decrypt (wrong key, corruption) becomes
 *    `[unreadable]`. Logs name the field only — never the value.
 *  - Keyword screening, offsets and edit distances all work on the plaintext
 *    the callers hold in memory; only the database sees ciphertext.
 */
@Injectable()
export class HelplineContentCipher {
  private readonly logger = LoggerService.getInstance(
    HelplineContentCipher.name,
  );

  constructor(
    private readonly crypto: CryptoService,
    private readonly config: AppConfigService,
  ) {}

  static isEncrypted(value: unknown): value is string {
    return (
      typeof value === 'string' && value.startsWith(HELPLINE_CIPHER_PREFIX)
    );
  }

  private get key(): string | undefined {
    return this.config.phiData?.phiDataEncryptionKey;
  }

  async encrypt(plain: string): Promise<string> {
    // No "already encrypted?" shortcut: a talker could type the prefix, and
    // that text must be encrypted like any other. Callers encrypt exactly once.
    if (plain === HELPLINE_RETENTION.ERASED) return plain;
    if (!this.key) {
      this.logger.error(
        'PHI_DATA_ENCRYPTION_KEY is not set: helpline content cannot be stored',
      );
      throw new Error('Helpline content encryption is not configured');
    }
    return (
      HELPLINE_CIPHER_PREFIX + (await this.crypto.encrypt(plain, this.key))
    );
  }

  async encryptNullable(plain: string | null): Promise<string | null> {
    return plain == null ? null : this.encrypt(plain);
  }

  /** Never throws; `field` names what failed in the log (never the value). */
  async decrypt(stored: string, field = 'content'): Promise<string> {
    if (!HelplineContentCipher.isEncrypted(stored)) return stored;
    try {
      return await this.crypto.decrypt(
        stored.slice(HELPLINE_CIPHER_PREFIX.length),
        this.key,
      );
    } catch {
      this.logger.error(`Helpline decrypt failed (field=${field})`);
      return HELPLINE_UNREADABLE;
    }
  }

  async decryptNullable(
    stored: string | null | undefined,
    field?: string,
  ): Promise<string | null> {
    return stored == null ? null : this.decrypt(stored, field);
  }

  /** Summary fields → `{ enc }`. An empty object stays `{}` (retention writes it). */
  async encryptFields(
    fields: Record<string, string>,
  ): Promise<EncryptedFields | Record<string, never>> {
    if (!fields || !Object.keys(fields).length) return {};
    return { enc: await this.encrypt(JSON.stringify(fields)) };
  }

  /** `{ enc }` → fields; a legacy plain object is returned as its string values. */
  async decryptFields(stored: unknown): Promise<Record<string, string>> {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    const enc = (stored as Partial<EncryptedFields>).enc;
    if (typeof enc === 'string' && HelplineContentCipher.isEncrypted(enc)) {
      const text = await this.decrypt(enc, 'summary.fields');
      try {
        const parsed = JSON.parse(text) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? stringValues(parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return stringValues(stored as Record<string, unknown>);
  }

  /**
   * A message's `metadata` with every `suggestions[].text` encrypted (that text
   * is model output about the conversation). Other keys are ids, codes and
   * numbers and stay queryable.
   */
  async encryptMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown> | null> {
    if (!metadata) return metadata ?? null;
    const suggestions = metadata.suggestions;
    if (!Array.isArray(suggestions)) return metadata;
    return {
      ...metadata,
      suggestions: await Promise.all(
        suggestions.map(async (s) =>
          s && typeof s === 'object' && typeof s.text === 'string'
            ? { ...s, text: await this.encrypt(s.text) }
            : s,
        ),
      ),
    };
  }

  async decryptMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown> | null> {
    if (!metadata) return metadata ?? null;
    const suggestions = metadata.suggestions;
    if (!Array.isArray(suggestions)) return metadata;
    return {
      ...metadata,
      suggestions: await Promise.all(
        suggestions.map(async (s) =>
          s && typeof s === 'object' && typeof s.text === 'string'
            ? { ...s, text: await this.decrypt(s.text, 'metadata.suggestions') }
            : s,
        ),
      ),
    };
  }
}

function stringValues(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Decrypt a loaded talker's display name in place (encrypted at rest). */
export async function decryptTalker(
  cipher: HelplineContentCipher,
  talker: HelplineTalker,
): Promise<HelplineTalker> {
  talker.displayName =
    (await cipher.decryptNullable(
      talker.displayName,
      'helpline_talkers.display_name',
    )) ?? HELPLINE_LIMITS.DEFAULT_DISPLAY_NAME;
  return talker;
}

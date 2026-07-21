import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Languages } from 'src/language/entity/languages.entity';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { PromptSharedService } from './prompt-shared.service';

/**
 * Helpers that feed the translation trigger (Phase 2) and the runtime freshness
 * gate (Phase 3):
 *
 * - `hashEffectiveBody` / `hashBody` — the `sourceHash` of a prompt's *effective*
 *   English body (override-on version body vs. file — resolved via
 *   `getPromptByCode`). Runtime serves a translation only while its stored
 *   `sourceHash` still equals this, which is what keeps translations aligned to
 *   the current English source across both storage paths.
 * - `getEligibleTargetLanguages` — the target languages to translate into.
 */
@Injectable()
export class PromptTranslationTargetsService {
  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly sharedLanguageService: SharedLanguageService,
  ) {}

  /** SHA-256 hex (64 chars, matching `prompt_translations.sourceHash`). */
  hashBody(body: string): string {
    // Trim before hashing so the store-time hash (from getPromptByCode, which
    // returns the raw DB/version body) and the serve-time hash (from the
    // trimmed body shipped in room metadata) agree. Without this, any prompt
    // body with surrounding whitespace (a trailing newline is common) would
    // never match at serve time — silently serving English and re-translating
    // on every session.
    return createHash('sha256').update(body.trim(), 'utf8').digest('hex');
  }

  /**
   * Hash the current effective English body of a prompt, or null when the
   * prompt has no resolvable body.
   */
  async hashEffectiveBody(promptCode: string): Promise<string | null> {
    const body = await this.promptSharedService.getPromptByCode(promptCode);
    if (body === null || body === undefined) return null;
    return this.hashBody(body);
  }

  getEligibleTargetLanguages(): Promise<Languages[]> {
    return this.sharedLanguageService.getEligibleAppLanguages();
  }
}

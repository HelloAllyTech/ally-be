import { Injectable } from '@nestjs/common';
import { IsNull, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { WaKeywordTemplate } from '../entity/wa-keyword-template.entity';
import { WaTemplateKind, WaTemplateMatchType } from '../enum/whatsapp.enum';

/** The outcome of one matching pass. */
export interface TemplateMatch {
  template: WaKeywordTemplate;
  /** True when nothing else may run — crisis and opt-out. */
  terminal: boolean;
  /** True when retrieval must be skipped. */
  bypassRag: boolean;
}

@Injectable()
export class WhatsAppTemplateService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppTemplateService.name,
  );

  constructor(
    @InjectRepository(WaKeywordTemplate)
    private readonly templateRepository: Repository<WaKeywordTemplate>,
  ) {}

  /**
   * Normalise inbound text before matching.
   *
   * NFKC first so full-width and composed characters fold to their canonical forms — without it a
   * pasted or IME-typed keyword silently fails to match. Then lowercase, strip everything that is
   * not a letter, mark, number or space (so "suicide?" and "suicide!!" both match), and collapse
   * runs of whitespace.
   *
   * `\p{M}` — the Mark category — is NOT optional, and leaving it out is a bug that only shows up in
   * Indic languages. Devanagari vowel signs and the virama (आत्महत्या), and Tamil vowel signs
   * (தற்கொலை), are combining marks rather than letters, so a `\p{L}\p{N}` keep-set strips them and
   * turns "आत्महत्या" into "आत महत य" — which matches no crisis keyword at all. The bot answers in
   * Hindi, Tamil and Bengali, so this silently disables risk detection for most of its audience.
   *
   * (An ASCII `a-z0-9` keep-set would be worse still: it erases those words entirely.)
   */
  static normalise(text: string): string {
    return text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Find the first template that matches, in priority order.
   *
   * ONE ordered pass over all four kinds. The ordering is the safety-critical part: a crisis rule
   * that loses to an FAQ rule is a crisis reply that never gets sent. Ordering by
   * (priority, createdAt) makes it deterministic even when two rules share a priority, so the same
   * message cannot match different rules on different days.
   *
   * A regex that fails to compile is skipped and logged rather than thrown: one malformed rule an
   * admin saved must not take down every reply, including the crisis ones.
   */
  async match(
    text: string,
    language?: string | null,
  ): Promise<TemplateMatch | null> {
    const normalised = WhatsAppTemplateService.normalise(text);
    if (!normalised) return null;

    const templates = await this.templateRepository.find({
      where: { active: true, archivedAt: IsNull() },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });

    for (const template of templates) {
      // A language-scoped rule only applies to that language; an unscoped rule applies to all.
      if (
        template.languageCode &&
        language &&
        template.languageCode !== language
      ) {
        continue;
      }
      if (this.matches(template, normalised)) {
        return {
          template,
          terminal: template.terminal,
          bypassRag: template.bypassRag,
        };
      }
    }

    return null;
  }

  private matches(template: WaKeywordTemplate, normalised: string): boolean {
    const patterns = (template.patterns ?? []).filter(Boolean);
    if (!patterns.length) return false;

    switch (template.matchType) {
      case WaTemplateMatchType.EXACT:
        return patterns.some(
          (p) => WhatsAppTemplateService.normalise(p) === normalised,
        );

      case WaTemplateMatchType.CONTAINS:
        return patterns.some((p) => {
          const needle = WhatsAppTemplateService.normalise(p);
          return needle.length > 0 && normalised.includes(needle);
        });

      case WaTemplateMatchType.ANY_OF:
        // Whole-word matching. This is the default for crisis rules because a substring match on a
        // short word is how "therapist" fires a rule keyed on "rapist" — a false crisis reply to a
        // legitimate clinical question.
        return patterns.some((p) => {
          const needle = WhatsAppTemplateService.normalise(p);
          if (!needle) return false;
          const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'u').test(
            normalised,
          );
        });

      case WaTemplateMatchType.REGEX:
        return patterns.some((source) => {
          try {
            return new RegExp(source, 'iu').test(normalised);
          } catch {
            this.logger.error(
              `Template ${template.id} has an invalid regex and was skipped: ${source}`,
            );
            return false;
          }
        });

      default:
        return false;
    }
  }

  /** Templates of one kind, for the opt-in/opt-out lookups the consumer performs directly. */
  async findByKind(kind: WaTemplateKind): Promise<WaKeywordTemplate[]> {
    return this.templateRepository.find({
      where: { kind, active: true, archivedAt: IsNull() },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  HELPLINE_TIMINGS,
  HelplineKeywordMatchType,
  HelplineRiskFlagLevel,
} from '../constants/helpline.constants';
import { HelplineRiskKeywordRule } from '../entity/helpline-risk-keyword-rule.entity';
import {
  findPhrase,
  normaliseForMatching,
  normalisePhrase,
} from '../util/helpline-text-normaliser';

export interface CompiledKeywordRule {
  id: string;
  phrase: string;
  /** `phrase` normalised once, at load. */
  needle: string;
  language: string;
  matchType: HelplineKeywordMatchType;
  level: HelplineRiskFlagLevel;
}

export interface KeywordHit {
  rule: CompiledKeywordRule;
  /** Offsets into the ORIGINAL message body, end-exclusive. */
  start: number;
  end: number;
}

const LEVEL_RANK: Record<HelplineRiskFlagLevel, number> = {
  [HelplineRiskFlagLevel.HIGH]: 2,
  [HelplineRiskFlagLevel.ELEVATED]: 1,
};

/**
 * Pick the hit that becomes the flag: highest level, then earliest in the
 * message, then the longest (most specific) phrase.
 */
export function strongestHit(hits: KeywordHit[]): KeywordHit | null {
  return (
    [...hits].sort(
      (a, b) =>
        LEVEL_RANK[b.rule.level] - LEVEL_RANK[a.rule.level] ||
        a.start - b.start ||
        b.end - b.start - (a.end - a.start),
    )[0] ?? null
  );
}

/** Pure matcher over pre-compiled rules — what the keyword spec exercises. */
export function matchKeywordRules(
  text: string,
  rules: CompiledKeywordRule[],
): KeywordHit[] {
  if (!text) return [];
  const haystack = normaliseForMatching(text);
  if (!haystack.text) return [];
  const hits: KeywordHit[] = [];
  for (const rule of rules) {
    const match = findPhrase(haystack, rule.needle, rule.matchType);
    if (match) hits.push({ rule, start: match.start, end: match.end });
  }
  return hits;
}

export function compileKeywordRule(rule: {
  id: string;
  phrase: string;
  language: string;
  matchType: HelplineKeywordMatchType;
  level: HelplineRiskFlagLevel;
}): CompiledKeywordRule {
  return { ...rule, needle: normalisePhrase(rule.phrase) };
}

/**
 * Keyword risk screening (contract §9.2 step 1): platform defaults
 * (`tenant_id IS NULL`) plus the tenant's own rules, cached 60 s per tenant.
 *
 * Every language's rules are applied to every chat, not only the chat's
 * language and English: a talker who picked English in the UI and then writes
 * in Devanagari or Hinglish would otherwise be screened against nothing. Rules
 * cannot cross scripts by accident (a Tamil phrase cannot match Hindi text),
 * so the wider net costs no false positives.
 */
@Injectable()
export class HelplineRiskKeywordService {
  private readonly cache = new Map<
    string,
    { rules: CompiledKeywordRule[]; expires: number }
  >();

  constructor(
    @InjectRepository(HelplineRiskKeywordRule)
    private readonly rules: Repository<HelplineRiskKeywordRule>,
  ) {}

  async rulesFor(tenantId: string): Promise<CompiledKeywordRule[]> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expires > Date.now()) return cached.rules;
    const rows = await this.rules.find({
      where: [
        { tenantId: IsNull(), enabled: true },
        { tenantId, enabled: true },
      ],
    });
    const compiled = rows
      .map(compileKeywordRule)
      .filter((rule) => rule.needle.length > 0);
    this.cache.set(tenantId, {
      rules: compiled,
      expires: Date.now() + HELPLINE_TIMINGS.RULE_CACHE_MS,
    });
    return compiled;
  }

  /** The strongest hit in `text`, or null. Never returns or logs the text. */
  async screen(tenantId: string, text: string): Promise<KeywordHit | null> {
    const rules = await this.rulesFor(tenantId);
    return strongestHit(matchKeywordRules(text, rules));
  }
}

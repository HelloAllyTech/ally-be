import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { excludeTestTenants } from 'src/analytics/util/test-tenant.util';
import { Languages } from '../entity/languages.entity';
import {
  LanguageVarietyProfile,
  VarietyProfileStatus,
} from '../entity/language-variety-profile.entity';
import { VarietyProfileAttachment } from '../entity/variety-profile-attachment.entity';
import { LanguagesRepository } from '../repository/languages.repository';
import {
  extractVarietyFeatures,
  getLanguageInventories,
  profileSimilarity,
  PROFILE_MATCH_THRESHOLD,
  tokenize,
  varietyTargetDescriptor,
  VarietyFeatures,
} from '../util/variety-feature.util';

/** Minimum judged sessions / learner turns before a profile is inferable. */
const MIN_SESSIONS = 10;
const MIN_TURNS = 200;
/** Corpus caps — most recent turns win; keeps memory bounded. */
const TURN_CAP = 20000;
const DEFAULT_WINDOW_DAYS = 90;
/** Exemplar selection bounds (tokens per turn). */
const EXEMPLAR_MIN_TOKENS = 6;
const EXEMPLAR_MAX_TOKENS = 30;
const EXEMPLAR_COUNT = 5;

export interface InferProfileResult {
  profile: LanguageVarietyProfile;
  attachment: VarietyProfileAttachment;
  /** True when the tenant matched an existing profile instead of creating one. */
  matched: boolean;
  similarity: number | null;
}

export interface ProfileListView {
  profile: LanguageVarietyProfile;
  attachments: VarietyProfileAttachment[];
}

/**
 * Language variety profile inference (variety-profiles phase 1) — computes
 * how a tenant's population actually speaks a language from the LEARNER side
 * of its judged-session transcripts, then matches the result against the
 * language's existing profiles (attach) or creates a new one.
 *
 * Population = judged sessions (language_judgment_sessions), the same corpus
 * the consolidation loop mines, so profile and glossary always describe the
 * same traffic. The contrast corpus for characteristic-lexeme extraction is
 * every OTHER non-test tenant's judged turns in the language — weighted
 * log-odds against it surfaces variety markers instead of the org's domain
 * vocabulary.
 *
 * v1 is inference + storage only: nothing reads profiles at runtime yet.
 */
@Injectable()
export class VarietyProfileService {
  private readonly logger = new Logger(VarietyProfileService.name);

  constructor(
    @InjectRepository(LanguageVarietyProfile)
    private readonly profileRepository: Repository<LanguageVarietyProfile>,
    @InjectRepository(VarietyProfileAttachment)
    private readonly attachmentRepository: Repository<VarietyProfileAttachment>,
    private readonly languagesRepository: LanguagesRepository,
    private readonly dataSource: DataSource,
  ) {}

  async listProfiles(languageId: number): Promise<ProfileListView[]> {
    await this.assertLanguageExists(languageId);
    const profiles = await this.profileRepository.find({
      where: { languageId },
      order: { createdAt: 'ASC' },
    });
    if (profiles.length === 0) return [];
    const attachments = await this.attachmentRepository.find({
      where: { languageId },
    });
    return profiles.map((profile) => ({
      profile,
      attachments: attachments.filter((a) => a.profileId === profile.id),
    }));
  }

  async inferProfile(
    languageId: number,
    tenantId: string,
    windowDays: number = DEFAULT_WINDOW_DAYS,
    createdBy?: string,
  ): Promise<InferProfileResult> {
    const language = await this.assertLanguageExists(languageId);

    const { turns, sessionCount } = await this.fetchLearnerTurns(
      language.value,
      tenantId,
      windowDays,
    );
    if (sessionCount < MIN_SESSIONS || turns.length < MIN_TURNS) {
      throw new BadRequestException(
        `Not enough data to infer a ${language.label} profile for this tenant: ` +
          `${sessionCount} judged sessions / ${turns.length} learner turns in ` +
          `${windowDays} days (need ≥${MIN_SESSIONS} sessions and ≥${MIN_TURNS} turns)`,
      );
    }
    const contrastTurns = await this.fetchContrastTurns(
      language.value,
      tenantId,
      windowDays,
    );

    const features = extractVarietyFeatures(
      turns,
      language.value,
      contrastTurns.length ? contrastTurns : null,
    );
    const exemplars = this.pickExemplars(turns, language.value, features);
    const description = this.describeFeatures(features, {
      sessionCount,
      turnCount: turns.length,
      windowDays,
    });

    // Match against the language's existing (non-archived) profiles.
    const existing = await this.profileRepository.find({
      where: { languageId },
    });
    let best: { profile: LanguageVarietyProfile; similarity: number } | null =
      null;
    for (const profile of existing) {
      if (profile.status === VarietyProfileStatus.ARCHIVED) continue;
      const similarity = profileSimilarity(features, profile.features);
      if (!best || similarity > best.similarity) best = { profile, similarity };
    }

    let profile: LanguageVarietyProfile;
    let matched = false;
    let similarity: number | null = null;
    if (best && best.similarity >= PROFILE_MATCH_THRESHOLD) {
      profile = best.profile;
      matched = true;
      similarity = best.similarity;
    } else {
      profile = await this.profileRepository.save(
        this.profileRepository.create({
          languageId,
          name: `${language.label} — inferred ${existing.length + 1}`,
          description,
          status: VarietyProfileStatus.INFERRED,
          features,
          exemplars,
          source: {
            inferredFromTenantId: tenantId,
            windowDays,
            sessionCount,
            turnCount: turns.length,
            contrastTurnCount: contrastTurns.length,
          },
          createdBy,
        }),
      );
    }

    // One active attachment per (tenant, language): re-inference re-points it.
    const existingAttachment = await this.attachmentRepository.findOne({
      where: { tenantId, languageId },
    });
    const attachment = await this.attachmentRepository.save(
      this.attachmentRepository.create({
        ...(existingAttachment ?? {}),
        profileId: profile.id,
        tenantId,
        languageId,
        attachedBy: 'inferred',
        similarity: similarity ?? undefined,
      }),
    );

    this.logger.log(
      `[VARIETY_PROFILE] language=${language.value} tenant=${tenantId} ` +
        `sessions=${sessionCount} turns=${turns.length} contrast=${contrastTurns.length} ` +
        `${matched ? `matched=${profile.id} sim=${similarity?.toFixed(3)}` : `created=${profile.id}`}`,
    );
    return { profile, attachment, matched, similarity };
  }

  /**
   * The judge-side hook: the target-variety descriptor for a tenant's
   * sessions in a language, derived from the variety profile the tenant is
   * attached to. Null when unattached (or the profile is archived) — the
   * judge then falls back to the language's seeded targetVariety. Dual-key
   * tenant match (tenants.id-as-text or code), same as the platform's other
   * tenant refs.
   */
  async resolveVarietyOverride(
    languageValue: string,
    tenantRef: string | null | undefined,
  ): Promise<string | null> {
    if (!tenantRef) return null;
    const language = await this.languagesRepository.findOne({
      where: { value: languageValue },
    });
    if (!language) return null;
    const rows: { profileId: string }[] = await this.dataSource.query(
      `SELECT a."profileId"
         FROM variety_profile_attachments a
        WHERE a."languageId" = $1
          AND (a."tenantId" = $2
               OR a."tenantId" IN (SELECT id::text FROM tenants WHERE code = $2)
               OR a."tenantId" IN (SELECT code FROM tenants WHERE id::text = $2))
        LIMIT 1`,
      [language.id, tenantRef],
    );
    if (!rows[0]) return null;
    const profile = await this.profileRepository.findOne({
      where: { id: rows[0].profileId },
    });
    if (!profile || profile.status === VarietyProfileStatus.ARCHIVED) {
      return null;
    }
    const base =
      (language.evalConfig as Record<string, any> | null)?.targetVariety ??
      `colloquial spoken ${language.label}`;
    return varietyTargetDescriptor(base, profile.features);
  }

  /** Learner (senderId > 0) turns from the tenant's judged sessions. */
  private async fetchLearnerTurns(
    languageValue: string,
    tenantId: string,
    windowDays: number,
  ): Promise<{ turns: string[]; sessionCount: number }> {
    const sessions: { sid: string }[] = await this.dataSource.query(
      `SELECT DISTINCT ljs."scenarioSessionId" AS sid
         FROM language_judgment_sessions ljs
        WHERE ljs.language = $1 AND ljs.tenant_id = $2
          AND ljs."createdAt" > now() - ($3 * interval '1 day')`,
      [languageValue, tenantId, windowDays],
    );
    if (sessions.length === 0) return { turns: [], sessionCount: 0 };
    const rows: { content: string }[] = await this.dataSource.query(
      `SELECT m.content
         FROM scenario_session_messages m
        WHERE m."scenarioSessionId" = ANY($1::uuid[]) AND m."senderId" > 0
        ORDER BY m."createdAt" DESC
        LIMIT $2`,
      [sessions.map((s) => s.sid), TURN_CAP],
    );
    return {
      turns: rows.map((r) => r.content ?? '').filter(Boolean),
      sessionCount: sessions.length,
    };
  }

  /**
   * Learner turns from every OTHER non-test tenant's judged sessions in the
   * language — the log-odds contrast corpus.
   */
  private async fetchContrastTurns(
    languageValue: string,
    tenantId: string,
    windowDays: number,
  ): Promise<string[]> {
    const rows: { content: string }[] = await this.dataSource.query(
      `SELECT m.content
         FROM scenario_session_messages m
        WHERE m."senderId" > 0
          AND m."scenarioSessionId" IN (
            SELECT DISTINCT ljs."scenarioSessionId"
              FROM language_judgment_sessions ljs
             WHERE ljs.language = $1 AND ljs.tenant_id <> $2
               AND ljs."createdAt" > now() - ($3 * interval '1 day')
               AND ${excludeTestTenants('ljs."tenant_id"')})
        ORDER BY m."createdAt" DESC
        LIMIT $4`,
      [languageValue, tenantId, windowDays, TURN_CAP],
    );
    return rows.map((r) => r.content ?? '').filter(Boolean);
  }

  /**
   * Representative learner utterances: mid-length turns carrying at least one
   * variety marker (address form or characteristic lexeme), deduped.
   */
  private pickExemplars(
    turns: string[],
    languageValue: string,
    features: VarietyFeatures,
  ): string[] {
    const markers = new Set([
      ...Object.keys(getLanguageInventories(languageValue).addressForms),
      ...features.characteristicLexemes.items.slice(0, 10).map((i) => i.token),
    ]);
    const seen = new Set<string>();
    const exemplars: string[] = [];
    for (const turn of turns) {
      const tokens = tokenize(turn);
      if (
        tokens.length < EXEMPLAR_MIN_TOKENS ||
        tokens.length > EXEMPLAR_MAX_TOKENS
      ) {
        continue;
      }
      if (!tokens.some((t) => markers.has(t))) continue;
      const key = tokens.join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      exemplars.push(turn.trim());
      if (exemplars.length >= EXEMPLAR_COUNT) break;
    }
    return exemplars;
  }

  /** Deterministic plain-words summary — no LLM call. */
  private describeFeatures(
    features: VarietyFeatures,
    source: { sessionCount: number; turnCount: number; windowDays: number },
  ): string {
    const parts: string[] = [];
    const { formalShare, informal, formal } = features.addressForms;
    if (formalShare !== null) {
      const pct = Math.round(formalShare * 100);
      parts.push(
        `Address: ${pct}% formal / ${100 - pct}% informal second-person forms ` +
          `(${formal} formal, ${informal} informal observations)`,
      );
    } else {
      parts.push('Address: no second-person forms observed');
    }
    parts.push(
      `Code-mix: ${(features.codeMix.latinTokenShare * 100).toFixed(1)}% Latin-script tokens`,
    );
    const top = features.characteristicLexemes.items
      .slice(0, 8)
      .map((i) => i.token);
    if (top.length) {
      const label =
        features.characteristicLexemes.method === 'log_odds'
          ? 'Distinctive vocabulary vs other orgs'
          : 'Most frequent vocabulary (no contrast corpus available)';
      parts.push(`${label}: ${top.join(', ')}`);
    }
    parts.push(
      `Avg turn length ${features.turnStats.avgTokensPerTurn.toFixed(1)} tokens`,
    );
    parts.push(
      `Inferred from ${source.sessionCount} judged sessions / ` +
        `${source.turnCount} learner turns (${source.windowDays}d window)`,
    );
    return parts.join('. ') + '.';
  }

  private async assertLanguageExists(languageId: number): Promise<Languages> {
    const language = await this.languagesRepository.findOne({
      where: { id: languageId },
    });
    if (!language) {
      throw new NotFoundException(`Language ${languageId} not found`);
    }
    return language;
  }
}

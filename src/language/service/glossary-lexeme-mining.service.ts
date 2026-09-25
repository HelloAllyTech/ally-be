import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { excludeTestTenants } from 'src/analytics/util/test-tenant.util';
import { LlmProviderFactory } from 'src/ai-chat/provider/llm-provider.factory';
import {
  GLOSSARY_LEXEME_PAIRING_PROMPT_CODE,
  GLOSSARY_LEXICAL_CONTRADICTION_MIN,
  LEXEME_MINING_SESSION_CAP,
  LEXEME_PAIRING_CHUNK,
  LEXEME_MINING_TOP_K,
  LEXEME_MINING_WINDOW_DAYS,
} from '../constants/glossary.constants';
import {
  ConsolidationBatchEntry,
  GlossaryConsolidationBatch,
} from '../entity/glossary-consolidation-batch.entity';
import {
  GlossaryEntryStatus,
  LanguageGlossarySection,
} from '../entity/language-glossary-section.entity';
import { LanguageGlossaryRepository } from '../repository/language-glossary.repository';
import {
  LexicalEvidence,
  scoreLexicalEvidence,
} from '../util/construct-class.util';
import { GlossaryDedupeIndex } from '../util/glossary-dedupe.util';
import {
  isSwapSafe,
  LEXEME_WORD_CLASSES,
  LexemeCandidate,
  LexemeMiningResult,
  MiningSession,
  mineBookishLexemes,
  scoreTokenEvidence,
} from '../util/lexeme-mining.util';
import { getLanguageInventories, tokenize } from '../util/variety-feature.util';
import { LanguageGlossaryService } from './language-glossary.service';

export interface MineLexemesOptions {
  /** Default true: report only, write nothing. */
  dryRun?: boolean;
  sinceDays?: number;
  sessionCap?: number;
  topK?: number;
}

export interface LexemeProposal {
  token: string;
  say: string;
  meaning: string;
  wordClass: string;
  reason: string;
  markdown: string;
  swapSafe: boolean;
  evidence: LexicalEvidence | null;
  candidate: Omit<LexemeCandidate, 'contexts' | 'token'>;
  /** Why the proposal was not (or would not be) written, if it wasn't. */
  skipped?: 'duplicate' | 'contradicted';
  duplicateOf?: string;
}

export interface MineLexemesResult {
  dryRun: boolean;
  language: string;
  stats: LexemeMiningResult['stats'] & {
    candidates: number;
    paired: number;
    kept: number;
    undecided: number;
    written: number;
  };
  /** The section proposals are (or would be) queued into. */
  targetSection: string | null;
  proposals: LexemeProposal[];
  kept: { token: string; reason: string }[];
  /** Candidates the model returned no verdict for. */
  undecided: string[];
  candidates: LexemeCandidate[];
  learnerLexicon: { token: string; count: number }[];
  batchId: string | null;
}

interface PairingVerdict {
  index: number;
  verdict: 'pair' | 'keep';
  avoid?: string;
  say?: string;
  meaning?: string;
  wordClass?: string;
  reason?: string;
}

/**
 * Bookish-word mining: the open-vocabulary complement to annotation
 * consolidation. Consolidation learns only from errors a judge flagged; this
 * job compares the agent's word frequencies with the counsellors' own speech
 * (lexeme-mining.util — echo-corrected, scenario-bound words dropped), asks the
 * pairing prompt which over-used words are register problems and what people
 * say instead, and queues the pairs as ordinary PROPOSED glossary entries in a
 * consolidation batch — so review, adjudication and batch rollback all apply
 * unchanged.
 *
 * Never auto-accepts. Note that in an environment running the adjudication
 * scheduler in `apply` mode, queued proposals ARE decided automatically on its
 * next pass — the dry run is the human checkpoint.
 */
@Injectable()
export class GlossaryLexemeMiningService {
  private readonly logger = new Logger(GlossaryLexemeMiningService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly glossaryService: LanguageGlossaryService,
    private readonly glossaryRepository: LanguageGlossaryRepository,
    @InjectRepository(GlossaryConsolidationBatch)
    private readonly batchRepository: Repository<GlossaryConsolidationBatch>,
    private readonly llmProviderFactory: LlmProviderFactory,
  ) {}

  async mineLexemes(
    languageId: number,
    options: MineLexemesOptions = {},
    createdBy?: string,
  ): Promise<MineLexemesResult> {
    const dryRun = options.dryRun !== false;
    const language =
      await this.glossaryService.assertLanguageExists(languageId);
    const sections =
      await this.glossaryRepository.findAllForLanguage(languageId);
    const globalSections = sections.filter((s) => !s.profileId);

    const sessions = await this.fetchSessions(
      language.value,
      options.sinceDays ?? LEXEME_MINING_WINDOW_DAYS,
      options.sessionCap ?? LEXEME_MINING_SESSION_CAP,
    );
    const mined = mineBookishLexemes(sessions, {
      topK: options.topK ?? LEXEME_MINING_TOP_K,
      excludeTokens: this.glossaryTokens(sections),
    });

    const targetSection = this.pickTargetSection(globalSections);
    const result: MineLexemesResult = {
      dryRun,
      language: language.value,
      stats: {
        ...mined.stats,
        candidates: mined.candidates.length,
        paired: 0,
        kept: 0,
        undecided: 0,
        written: 0,
      },
      targetSection: targetSection?.sectionCode ?? null,
      proposals: [],
      kept: [],
      undecided: [],
      candidates: mined.candidates,
      learnerLexicon: mined.learnerLexicon,
      batchId: null,
    };
    if (mined.candidates.length === 0) return result;

    const verdicts = await this.pair(
      language,
      mined,
      this.glossaryService.summarizeGlossary(globalSections),
    );

    const dedupe = new GlossaryDedupeIndex();
    for (const section of sections) {
      dedupe.addContent(section.content);
      for (const entry of section.entries ?? []) dedupe.add(entry.markdown);
    }
    const addressForms = Object.keys(
      getLanguageInventories(language.value).addressForms,
    );

    const decided = new Set<number>();
    for (const v of verdicts) {
      const candidate = mined.candidates[v.index - 1];
      if (!candidate || decided.has(v.index)) continue;
      decided.add(v.index);
      if (v.verdict !== 'pair') {
        result.kept.push({ token: candidate.token, reason: v.reason ?? '' });
        continue;
      }
      // One form only: the model sometimes offers alternatives
      // ("ராத்திரி, நைட்"), which is neither a canonical rule nor countable.
      const say = (v.say ?? '')
        .normalize('NFC')
        .split(/[,/;|]/)[0]
        .replace(/[.…]+$/u, '')
        .trim();
      // The model may only pair the word it was given: `avoid` is what the
      // adherence scan will count, so a paraphrased avoid-term would measure
      // something the miner never observed.
      if (!say || tokenize(say).join(' ') === candidate.token) {
        result.kept.push({
          token: candidate.token,
          reason: `pairing returned no usable replacement (${v.reason ?? 'no reason'})`,
        });
        continue;
      }
      const wordClass = (LEXEME_WORD_CLASSES as readonly string[]).includes(
        v.wordClass ?? '',
      )
        ? v.wordClass!
        : 'other';
      const meaning = (v.meaning ?? '').trim() || candidate.token;
      const markdown = `- ${meaning}: say \`${say}\` (avoid: \`${candidate.token}\`)`;
      const evidence = requireSayEvidence(
        scoreTokenEvidence(
          say,
          candidate.token,
          mined.tokenCounts,
          GLOSSARY_LEXICAL_CONTRADICTION_MIN,
        ) ??
          scoreLexicalEvidence(
            markdown,
            mined.corpora.learner,
            mined.corpora.agent,
            GLOSSARY_LEXICAL_CONTRADICTION_MIN,
          ),
      );
      const counts = {
        agentCount: candidate.agentCount,
        learnerCount: candidate.learnerCount,
        learnerEchoCount: candidate.learnerEchoCount,
        scenarioSpread: candidate.scenarioSpread,
        sessionSpread: candidate.sessionSpread,
        z: candidate.z,
      };
      const proposal: LexemeProposal = {
        token: candidate.token,
        say,
        meaning,
        wordClass,
        reason: v.reason ?? '',
        markdown,
        swapSafe: isSwapSafe(wordClass, candidate.token, say, addressForms),
        evidence,
        candidate: counts,
      };
      const duplicate = dedupe.duplicateOf(markdown);
      if (duplicate) {
        proposal.skipped = 'duplicate';
        proposal.duplicateOf = duplicate.line;
      } else if (evidence?.verdict === 'contradicted') {
        // The population itself says the "bookish" word — don't fight it.
        proposal.skipped = 'contradicted';
      } else {
        dedupe.add(markdown);
      }
      result.proposals.push(proposal);
    }
    result.undecided = mined.candidates
      .filter((_, i) => !decided.has(i + 1))
      .map((c) => c.token);
    result.stats.paired = result.proposals.length;
    result.stats.kept = result.kept.length;
    result.stats.undecided = result.undecided.length;

    if (!dryRun && targetSection) {
      await this.writeProposals(languageId, targetSection, result, createdBy);
    }

    this.logger.log(
      `[GLOSSARY_LEXEME_MINING] language=${language.value} dryRun=${dryRun} ` +
        `sessions=${mined.stats.sessions} candidates=${mined.candidates.length} ` +
        `paired=${result.stats.paired} kept=${result.stats.kept} ` +
        `undecided=${result.stats.undecided} written=${result.stats.written} ` +
        `echoShare=${mined.stats.agentLeaningEchoShare} batch=${result.batchId}`,
    );
    return result;
  }

  /**
   * Judged sessions from non-test tenants in the window, newest first, as
   * ordered agent/learner turns. Judged sessions are the population the judge
   * and the consolidation evidence gate already read, so all three reason
   * about the same traffic.
   */
  private async fetchSessions(
    languageValue: string,
    sinceDays: number,
    sessionCap: number,
  ): Promise<MiningSession[]> {
    const sessions: { sid: string; scenarioId: number | null }[] =
      await this.dataSource.query(
        `SELECT s.id::text AS sid, s."scenarioId" AS "scenarioId"
           FROM scenario_sessions s
          WHERE s.id IN (
                SELECT ljs."scenarioSessionId"
                  FROM language_judgment_sessions ljs
                 WHERE ljs.language = $1
                   AND ljs."createdAt" > now() - ($2 * interval '1 day')
                   AND ${excludeTestTenants('ljs."tenant_id"')})
          ORDER BY s."createdAt" DESC
          LIMIT $3`,
        [languageValue, sinceDays, sessionCap],
      );
    if (sessions.length === 0) return [];
    const rows: { sid: string; senderId: number; content: string }[] =
      await this.dataSource.query(
        `SELECT m."scenarioSessionId"::text AS sid, m."senderId" AS "senderId", m.content
           FROM scenario_session_messages m
          WHERE m."scenarioSessionId" = ANY($1::uuid[])
            AND m.content <> ''
          ORDER BY m."scenarioSessionId", m."createdAt", m.id`,
        [sessions.map((s) => s.sid)],
      );
    const bySession = new Map<string, MiningSession>(
      sessions.map((s) => [
        s.sid,
        { sessionId: s.sid, scenarioId: s.scenarioId, turns: [] },
      ]),
    );
    for (const row of rows) {
      // senderId -1 is the agent, > 0 a learner; anything else (system rows)
      // is neither side's speech.
      const role =
        row.senderId === -1 ? 'agent' : row.senderId > 0 ? 'learner' : null;
      if (!role || !row.content) continue;
      bySession.get(row.sid)?.turns.push({ role, text: row.content });
    }
    return [...bySession.values()].filter((s) => s.turns.length > 0);
  }

  /** Every word the glossary already mentions, in any section or proposal. */
  private glossaryTokens(sections: LanguageGlossarySection[]): Set<string> {
    const tokens = new Set<string>();
    for (const section of sections) {
      for (const t of tokenize(section.content ?? '')) tokens.add(t);
      for (const entry of section.entries ?? []) {
        for (const t of tokenize(entry.markdown ?? '')) tokens.add(t);
      }
    }
    return tokens;
  }

  /**
   * Word-choice pairs belong with the language's register rules: `core_style`
   * when it exists, otherwise the first global section. Retier moves the
   * section between tiers on its own evidence afterwards.
   */
  private pickTargetSection(
    globalSections: LanguageGlossarySection[],
  ): LanguageGlossarySection | null {
    return (
      globalSections.find((s) => s.sectionCode === 'core_style') ??
      globalSections[0] ??
      null
    );
  }

  /**
   * Ask the pairing prompt for a verdict on every candidate, in parallel
   * chunks. One 40-candidate call to a thinking model ran past the API
   * gateway's request timeout and returned output that did not parse (first
   * prod dry run, 2026-09-25); chunks keep each reply short and the whole
   * pass inside one request. Verdict indexes are chunk-local and mapped back.
   */
  private async pair(
    language: { label: string; value: string },
    mined: LexemeMiningResult,
    existingGlossary: string,
  ): Promise<PairingVerdict[]> {
    const { systemPrompt, engine } =
      await this.glossaryService.resolvePromptByCode(
        GLOSSARY_LEXEME_PAIRING_PROMPT_CODE,
      );
    const lexicon = mined.learnerLexicon
      .map((l) => `${l.token} (${l.count})`)
      .join(', ');
    const base = systemPrompt
      .split('{{languageName}}')
      .join(language.label)
      .split('{{languageCode}}')
      .join(language.value)
      .split('{{existingGlossary}}')
      .join(existingGlossary)
      .split('{{learnerLexicon}}')
      .join(lexicon || '(no counsellor speech in the window)');

    const chunks: { offset: number; items: LexemeCandidate[] }[] = [];
    for (let i = 0; i < mined.candidates.length; i += LEXEME_PAIRING_CHUNK) {
      chunks.push({
        offset: i,
        items: mined.candidates.slice(i, i + LEXEME_PAIRING_CHUNK),
      });
    }
    const results = await Promise.all(
      chunks.map(async ({ offset, items }) => {
        const listing = items
          .map((c, i) => {
            const echo = c.learnerEchoCount
              ? ` (+${c.learnerEchoCount} repeated back after the AI)`
              : '';
            const examples = c.contexts.map((x) => `   AI: "${x}"`).join('\n');
            return (
              `${i + 1}. ${c.token} — AI ${c.agentCount}×, counsellors ${c.learnerCount}×${echo}, ` +
              `${c.scenarioSpread} scenarios\n${examples}`
            );
          })
          .join('\n');
        const raw = await this.llmProviderFactory
          .getProvider(engine.provider)
          .getCompletion(
            [
              {
                role: 'system',
                content: base.split('{{candidates}}').join(listing),
              },
              {
                role: 'user',
                content: `Decide the ${items.length} candidates for ${language.label} (${language.value}).`,
              },
            ],
            {
              model: engine.model,
              temperature: engine.temperature,
              maxTokens: engine.maxTokens,
            },
          );
        try {
          return parsePairingOutput(raw).map((v) => ({
            ...v,
            index: v.index + offset,
          }));
        } catch (error) {
          // The raw reply is the only evidence of WHY it failed (truncation
          // reads as a cut-off tail, prose as a sentence before the array).
          this.logger.warn(
            `[GLOSSARY_LEXEME_MINING] unparseable pairing reply language=${language.value} ` +
              `chunk=${offset / LEXEME_PAIRING_CHUNK} length=${raw?.length ?? 0} ` +
              `head=${JSON.stringify((raw ?? '').slice(0, 300))} ` +
              `tail=${JSON.stringify((raw ?? '').slice(-300))}`,
          );
          throw error;
        }
      }),
    );
    return results.flat();
  }

  private async writeProposals(
    languageId: number,
    section: LanguageGlossarySection,
    result: MineLexemesResult,
    createdBy?: string,
  ): Promise<void> {
    const toWrite = result.proposals.filter((p) => !p.skipped);
    const batch = await this.batchRepository.save(
      this.batchRepository.create({
        languageId,
        autoAccepted: false,
        trigger: 'lexeme_mining',
        createdBy,
      }),
    );
    const newEntries = toWrite.map((p) => ({
      id: randomUUID(),
      markdown: p.markdown,
      status: GlossaryEntryStatus.PROPOSED,
      importance: 3,
      provenance: {
        source: 'lexeme_mining' as const,
        batchId: batch.id,
        ...(p.evidence ? { evidence: p.evidence } : {}),
        lexeme: {
          agentCount: p.candidate.agentCount,
          learnerCount: p.candidate.learnerCount,
          learnerEchoCount: p.candidate.learnerEchoCount,
          scenarioSpread: p.candidate.scenarioSpread,
          wordClass: p.wordClass,
          swapSafe: p.swapSafe,
        },
      },
    }));
    const batchEntries: ConsolidationBatchEntry[] = [];
    if (newEntries.length > 0) {
      section.entries = [...(section.entries ?? []), ...newEntries];
      section.version = (section.version ?? 0) + 1;
      section.updatedBy = createdBy;
      const saved = await this.glossaryRepository.save(section);
      for (const entry of newEntries) {
        batchEntries.push({
          sectionId: saved.id,
          sectionCode: saved.sectionCode,
          profileId: null,
          entryId: entry.id,
          markdown: entry.markdown,
          accepted: false,
        });
      }
    }
    batch.entries = batchEntries;
    batch.stats = {
      // The batch schema counts "annotations considered"; for this job the
      // unit considered is a mined candidate word.
      annotationsConsidered: result.stats.candidates,
      tenants: 0,
      proposed: newEntries.length,
      autoAccepted: 0,
      skippedDuplicates: result.proposals.filter(
        (p) => p.skipped === 'duplicate',
      ).length,
      overlayEntries: 0,
    };
    await this.batchRepository.save(batch);
    result.batchId = batch.id;
    result.stats.written = newEntries.length;
  }
}

/**
 * A mined pair is `confirmed` only when counsellors say the replacement. The
 * shared substring scorer (multi-word pairs) also confirms on "the agent says
 * the avoid-term", which every mined candidate does by construction, so here
 * that alone downgrades to `unverified`.
 */
export function requireSayEvidence(
  evidence: LexicalEvidence | null,
): LexicalEvidence | null {
  if (evidence?.verdict === 'confirmed' && evidence.sayLearnerCount === 0) {
    return { ...evidence, verdict: 'unverified' };
  }
  return evidence;
}

/**
 * Parse the pairing JSON array, tolerating a markdown fence. Unparseable
 * output throws rather than returning [] — an empty verdict list would read
 * as "the model kept every candidate", which is a finding, not a failure.
 */
export function parsePairingOutput(raw: string): PairingVerdict[] {
  const cleaned = (raw ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // A sentence before or after the array is common; the array itself is
    // still usable.
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    try {
      if (start === -1 || end <= start) throw new Error('no array');
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      parsed = undefined;
    }
  }
  if (parsed === undefined) {
    throw new BadRequestException(
      'Lexeme pairing returned unparseable output; retry or adjust the glossary_lexeme_pairing prompt',
    );
  }
  if (!Array.isArray(parsed)) {
    throw new BadRequestException('Lexeme pairing output is not an array');
  }
  return parsed.filter(
    (v): v is PairingVerdict =>
      !!v &&
      typeof v === 'object' &&
      Number.isInteger((v as PairingVerdict).index) &&
      ((v as PairingVerdict).verdict === 'pair' ||
        (v as PairingVerdict).verdict === 'keep'),
  );
}

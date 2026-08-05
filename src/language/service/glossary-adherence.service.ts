import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LanguageGlossarySection } from '../entity/language-glossary-section.entity';
import {
  GlossaryAdherenceReport,
  GlossaryAdherenceViolation,
} from '../entity/glossary-adherence-report.entity';
import { LanguageGlossaryRepository } from '../repository/language-glossary.repository';

/** One avoid-listed term with the section it came from. */
export interface AvoidTerm {
  term: string;
  sectionCode: string;
}

export interface BackfillAdherenceResult {
  scanned: number;
  reported: number;
  skipped: number;
}

/** Max context characters kept around a violation occurrence in `examples`. */
const EXAMPLE_CONTEXT_CHARS = 40;
/** Max example snippets stored per violated term. */
const MAX_EXAMPLES_PER_TERM = 3;
/** Backfill bounds — derived data, so re-runs can always widen the window. */
const BACKFILL_DEFAULT_DAYS = 30;
const BACKFILL_DEFAULT_LIMIT = 200;

/**
 * Deterministic glossary-adherence scan (LANGUAGE_GLOSSARY_DESIGN.md §9/§10).
 *
 * The glossary's term pairs are a machine-checkable lexicon: every
 * `say "X" (avoid: "Y")` line names words the agent must NOT say. This
 * service counts those avoid-terms in the agent's transcript per session —
 * a judge-independent adherence signal (the LLM judge measures style
 * quality; this measures literal rule-following, and needs no model call).
 *
 * Reports are derived data keyed by session (upsert) — safe to rebuild after
 * glossary edits. Sessions are attributed to the glossary versions recorded
 * in start_metrics provenance when present (exact), else the currently
 * published set (approximate, flagged by absence of provenance in metrics).
 */
@Injectable()
export class GlossaryAdherenceService {
  private readonly logger = new Logger(GlossaryAdherenceService.name);

  constructor(
    private readonly glossaryRepository: LanguageGlossaryRepository,
    @InjectRepository(GlossaryAdherenceReport)
    private readonly reportRepository: Repository<GlossaryAdherenceReport>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Extract avoid-listed terms from published section markdown.
   *
   * Matches the `(avoid: …)` groups the generation prompt emits, accepting
   * both quoting styles seen in real content: double quotes ("பதட்டம்") and
   * backticks (`वार्तालाप करना`). Terms are NFC-normalized (Indic scripts
   * have multiple byte encodings of identical glyphs) and deduped — the
   * first section to list a term owns it.
   */
  parseAvoidTerms(sections: LanguageGlossarySection[]): AvoidTerm[] {
    const seen = new Set<string>();
    const terms: AvoidTerm[] = [];
    for (const section of sections) {
      const content = section.content ?? '';
      for (const group of content.matchAll(/\(avoid:([^)]*)\)/g)) {
        for (const quoted of group[1].matchAll(/"([^"]+)"|`([^`]+)`/g)) {
          const term = (quoted[1] ?? quoted[2] ?? '').normalize('NFC').trim();
          if (!term || seen.has(term)) continue;
          seen.add(term);
          terms.push({ term, sectionCode: section.sectionCode });
        }
      }
    }
    return terms;
  }

  /** Count avoid-term occurrences in the agent's messages. Exposed for tests. */
  scanMessages(
    messages: string[],
    avoidTerms: AvoidTerm[],
  ): GlossaryAdherenceViolation[] {
    const violations = new Map<string, GlossaryAdherenceViolation>();
    for (const raw of messages) {
      const text = (raw ?? '').normalize('NFC');
      for (const { term, sectionCode } of avoidTerms) {
        let from = 0;
        for (;;) {
          const at = text.indexOf(term, from);
          if (at === -1) break;
          from = at + term.length;
          let v = violations.get(term);
          if (!v) {
            v = { term, sectionCode, count: 0, examples: [] };
            violations.set(term, v);
          }
          v.count++;
          if (v.examples.length < MAX_EXAMPLES_PER_TERM) {
            const start = Math.max(0, at - EXAMPLE_CONTEXT_CHARS);
            const end = Math.min(
              text.length,
              at + term.length + EXAMPLE_CONTEXT_CHARS,
            );
            v.examples.push(
              `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
            );
          }
        }
      }
    }
    return [...violations.values()].sort((a, b) => b.count - a.count);
  }

  /**
   * Scan one session's agent transcript against its language's avoid-lists.
   * Returns null (no report) when the session has no language, the language
   * has no published glossary, or the glossary defines no avoid-terms —
   * nothing measurable in each case.
   */
  async analyzeSession(
    scenarioSessionId: string,
  ): Promise<GlossaryAdherenceReport | null> {
    const [session] = await this.dataSource.query(
      `SELECT id, NULLIF(metadata->>'languageId', '')::int AS "languageId"
       FROM scenario_sessions WHERE id = $1::uuid`,
      [scenarioSessionId],
    );
    if (!session) {
      throw new NotFoundException(`Session ${scenarioSessionId} not found`);
    }
    if (!session.languageId) return null;

    const sections = await this.glossaryRepository.findPublishedByLanguage(
      session.languageId,
    );
    const avoidTerms = this.parseAvoidTerms(sections);
    if (avoidTerms.length === 0) return null;

    // senderId -1 is the voice agent (see roleplay-session-logs repository).
    const messageRows: { content: string }[] = await this.dataSource.query(
      `SELECT content FROM scenario_session_messages
       WHERE "scenarioSessionId" = $1::uuid AND "senderId" = -1
       ORDER BY "createdAt" ASC`,
      [scenarioSessionId],
    );
    const messages = messageRows.map((r) => r.content ?? '');
    const violations = this.scanMessages(messages, avoidTerms);

    // Prefer the exact glossary the session ran with (start_metrics
    // provenance); fall back to the published set at scan time.
    const [metricsRow] = await this.dataSource.query(
      `SELECT metadata->'glossary'->'versions' AS versions
       FROM scenario_session_start_metrics
       WHERE "scenarioSessionId" = $1::uuid
       ORDER BY "createdAt" DESC LIMIT 1`,
      [scenarioSessionId],
    );
    const glossaryVersions: Record<string, number> =
      metricsRow?.versions ??
      Object.fromEntries(sections.map((s) => [s.sectionCode, s.version]));

    const report = this.reportRepository.create({
      ...((await this.reportRepository.findOne({
        where: { scenarioSessionId },
      })) ?? { scenarioSessionId }),
      languageId: session.languageId,
      glossaryVersions,
      agentMessageCount: messages.length,
      totalViolations: violations.reduce((sum, v) => sum + v.count, 0),
      violations,
    });
    return this.reportRepository.save(report);
  }

  /**
   * Scan recent genuine sessions of a language (ENDED, non-preview,
   * non-seed). Per-session failures are logged, never thrown — same
   * fire-and-forget contract as the seed/consolidation jobs.
   */
  async backfillLanguage(
    languageId: number,
    options?: { sinceDays?: number; limit?: number },
  ): Promise<BackfillAdherenceResult> {
    const sinceDays = options?.sinceDays ?? BACKFILL_DEFAULT_DAYS;
    const limit = options?.limit ?? BACKFILL_DEFAULT_LIMIT;
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM scenario_sessions
       WHERE status = 'ENDED'
         AND NULLIF(metadata->>'languageId', '')::int = $1
         AND "roomId" NOT LIKE 'preview-%'
         AND "roomId" NOT LIKE 'seed-room-%'
         AND "createdAt" > now() - ($2 || ' days')::interval
       ORDER BY "createdAt" DESC
       LIMIT $3`,
      [languageId, String(sinceDays), limit],
    );

    let reported = 0;
    let skipped = 0;
    for (const { id } of rows) {
      try {
        const report = await this.analyzeSession(id);
        if (report) {
          reported++;
        } else {
          skipped++;
        }
      } catch (error) {
        skipped++;
        this.logger.warn(
          `[GLOSSARY_ADHERENCE] session ${id} scan failed: ${error}`,
        );
      }
    }
    this.logger.log(
      `[GLOSSARY_ADHERENCE] language=${languageId} scanned=${rows.length} reported=${reported} skipped=${skipped}`,
    );
    return { scanned: rows.length, reported, skipped };
  }

  /** Per-language rollup: session counts, violation rate, top violated terms. */
  async languageSummary(languageId: number) {
    const [totals] = await this.dataSource.query(
      `SELECT count(*)::int AS "sessionCount",
              COALESCE(sum("totalViolations"), 0)::int AS "totalViolations",
              COALESCE(round(avg("totalViolations"), 2), 0)::float AS "avgViolationsPerSession",
              count(*) FILTER (WHERE "totalViolations" = 0)::int AS "cleanSessions"
       FROM glossary_adherence_reports WHERE "languageId" = $1`,
      [languageId],
    );
    const topTerms = await this.dataSource.query(
      `SELECT v->>'term' AS term,
              v->>'sectionCode' AS "sectionCode",
              sum((v->>'count')::int)::int AS count
       FROM glossary_adherence_reports r,
            jsonb_array_elements(r.violations) v
       WHERE r."languageId" = $1
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`,
      [languageId],
    );
    return { ...totals, topTerms };
  }
}

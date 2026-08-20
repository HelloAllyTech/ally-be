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
 * Catch-up bounds.
 *
 * The window matches the judge drainer's, because this scan answers a question
 * about the same population: 664 eligible sessions predate the per-session
 * auto-scan and were never scanned, which left the adherence signal readable on
 * 1.5% of eligible sessions. The scan is deterministic string matching with no
 * model call, so the only real cost is the transcript read — hence a chunk large
 * enough to drain that backlog in a handful of ticks rather than over days.
 */
const CATCHUP_WINDOW_DAYS = 150;
const CATCHUP_CHUNK = 150;

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
   * Shared scan: session's language + published avoid-terms + agent
   * transcript + provenance. Returns null when the session has no language,
   * the language has no published glossary, or the glossary defines no
   * avoid-terms — nothing measurable in each case. Pure read — no writes.
   */
  private async computeAdherence(scenarioSessionId: string): Promise<{
    languageId: number;
    glossaryVersions: Record<string, number>;
    agentMessageCount: number;
    totalViolations: number;
    violations: GlossaryAdherenceViolation[];
  } | null> {
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

    return {
      languageId: session.languageId,
      glossaryVersions,
      agentMessageCount: messages.length,
      totalViolations: violations.reduce((sum, v) => sum + v.count, 0),
      violations,
    };
  }

  /**
   * Scan one session's agent transcript against its language's avoid-lists
   * and persist (upsert) the result. Used by the explicit backfill job — the
   * write makes the language-level rollup (`languageSummary`) materialized
   * and cheap to query repeatedly.
   */
  async analyzeSession(
    scenarioSessionId: string,
  ): Promise<GlossaryAdherenceReport | null> {
    const computed = await this.computeAdherence(scenarioSessionId);
    if (!computed) return null;

    const report = this.reportRepository.create({
      ...((await this.reportRepository.findOne({
        where: { scenarioSessionId },
      })) ?? { scenarioSessionId }),
      languageId: computed.languageId,
      glossaryVersions: computed.glossaryVersions,
      agentMessageCount: computed.agentMessageCount,
      totalViolations: computed.totalViolations,
      violations: computed.violations,
    });
    return this.reportRepository.save(report);
  }

  /**
   * Read-only adherence preview for a single session — the same scan as
   * {@link analyzeSession}, without the upsert. Backs the Roleplay Session
   * Log detail view, so opening a session's page never writes to the DB;
   * `glossary_adherence_reports` stays populated only by the explicit
   * backfill (which feeds the language-level rollup).
   */
  async previewAdherence(scenarioSessionId: string): Promise<{
    agentMessageCount: number;
    totalViolations: number;
    violations: GlossaryAdherenceViolation[];
  } | null> {
    const computed = await this.computeAdherence(scenarioSessionId);
    if (!computed) return null;
    return {
      agentMessageCount: computed.agentMessageCount,
      totalViolations: computed.totalViolations,
      violations: computed.violations,
    };
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

  /**
   * Scan eligible sessions that have never been scanned, newest first.
   *
   * Why this is not `backfillLanguage` with a wider window: that method re-scans
   * everything in its window, so it cannot drain a backlog — each run repeats
   * the previous run's work and a bounded run never advances.
   *
   * The eligibility gates are in the QUERY, not left to `analyzeSession`'s
   * `return null`. A session with no language, no published glossary, or a
   * glossary with no avoid-terms produces no report row, so a selector keyed on
   * "no report exists" would re-select it on every tick forever — the same
   * mistake that once stalled the language judge, where 25 sessions with no AI
   * turns were reselected each tick and nothing else got judged. Here the
   * language must have a published section that actually contains an
   * `(avoid: …)` group, and the session must have at least one agent message.
   */
  async catchUpUnscanned(options?: {
    sinceDays?: number;
    limit?: number;
  }): Promise<BackfillAdherenceResult> {
    const sinceDays = options?.sinceDays ?? CATCHUP_WINDOW_DAYS;
    const limit = options?.limit ?? CATCHUP_CHUNK;
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT s.id FROM scenario_sessions s
        WHERE s.status = 'ENDED'
          AND s."roomId" NOT LIKE 'preview-%'
          AND s."roomId" NOT LIKE 'seed-room-%'
          AND s."createdAt" > now() - ($1 || ' days')::interval
          AND NULLIF(s.metadata->>'languageId', '') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM language_glossary_sections g
             WHERE g."languageId" = NULLIF(s.metadata->>'languageId', '')::int
               AND g.status = 'published'
               AND g.content LIKE '%(avoid:%')
          AND EXISTS (
            SELECT 1 FROM scenario_session_messages m
             WHERE m."scenarioSessionId" = s.id AND m."senderId" = -1)
          AND NOT EXISTS (
            SELECT 1 FROM glossary_adherence_reports r
             WHERE r."scenarioSessionId" = s.id)
        ORDER BY s."createdAt" DESC
        LIMIT $2`,
      [String(sinceDays), limit],
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
          `[GLOSSARY_ADHERENCE] catch-up session ${id} scan failed: ${error}`,
        );
      }
    }
    if (rows.length > 0) {
      this.logger.log(
        `[GLOSSARY_ADHERENCE] catch-up scanned=${rows.length} ` +
          `reported=${reported} skipped=${skipped}`,
      );
    }
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

  /**
   * Rollup across every language with at least one scanned session — the
   * dashboard's landing view (analogous to the Language-quality tab's
   * all-languages table). Languages never backfilled are simply absent, not
   * shown as zero: `glossary_adherence_reports` is populated only by an
   * explicit backfill run, so an absent language usually means "not scanned
   * yet", not "clean".
   */
  async languageSummaryOverview(): Promise<
    {
      languageId: number;
      languageLabel: string;
      languageValue: string;
      sessionCount: number;
      totalViolations: number;
      avgViolationsPerSession: number;
      cleanSessions: number;
    }[]
  > {
    return this.dataSource.query(
      `SELECT r."languageId" AS "languageId",
              l.label AS "languageLabel",
              l.value AS "languageValue",
              count(*)::int AS "sessionCount",
              COALESCE(sum(r."totalViolations"), 0)::int AS "totalViolations",
              COALESCE(round(avg(r."totalViolations"), 2), 0)::float AS "avgViolationsPerSession",
              count(*) FILTER (WHERE r."totalViolations" = 0)::int AS "cleanSessions"
       FROM glossary_adherence_reports r
       JOIN languages l ON l.id = r."languageId"
       GROUP BY r."languageId", l.label, l.value
       ORDER BY "totalViolations" DESC`,
    );
  }
}

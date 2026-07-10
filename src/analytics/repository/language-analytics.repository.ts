import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface LanguageAnalyticsFilters {
  start: Date;
  language?: string | null;
  judgeModel: string;
  judgePromptVersion: string;
}

/**
 * Read-side aggregations for the language-quality dashboard tab.
 *
 * Aggregates the SAME per-session rows the Roleplay Session Logs detail reads
 * raw (language_judgment_sessions + language_error_annotations) — single write
 * path, two read surfaces. All rates are computed in the service from the
 * counts returned here; nothing here or downstream ever emits a 1-5 score.
 *
 * Every query is pinned to ONE (judgeModel, judgePromptVersion) — mixing judge
 * versions double-counts sessions and makes numbers incomparable (NFR3).
 * Windowing uses COALESCE(occurredAt, createdAt) on the SESSION time, same
 * rationale as drift-analytics.
 */
@Injectable()
export class LanguageAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Most recent judge version with rows — the version the dashboard pins to. */
  async latestJudgeVersion(): Promise<{
    judgeModel: string;
    judgePromptVersion: string;
  } | null> {
    const rows = await this.dataSource.query(
      `SELECT "judgeModel" AS judge_model,
              "judgePromptVersion" AS judge_prompt_version
         FROM language_judgment_sessions
        ORDER BY "updatedAt" DESC LIMIT 1`,
    );
    if (!rows?.length) return null;
    return {
      judgeModel: rows[0].judge_model,
      judgePromptVersion: rows[0].judge_prompt_version,
    };
  }

  private sessionWhere(f: LanguageAnalyticsFilters, params: unknown[]): string {
    params.push(f.start, f.judgeModel, f.judgePromptVersion);
    let where = `COALESCE(s."occurredAt", s."createdAt") >= $1
      AND s."judgeModel" = $2 AND s."judgePromptVersion" = $3`;
    if (f.language) {
      params.push(f.language);
      where += ` AND s."language" = $${params.length}`;
    }
    return where;
  }

  private annotationWhere(
    f: LanguageAnalyticsFilters,
    params: unknown[],
  ): string {
    params.push(f.start, f.judgeModel, f.judgePromptVersion);
    let where = `COALESCE(a."occurredAt", a."createdAt") >= $1
      AND a."judgeModel" = $2 AND a."judgePromptVersion" = $3`;
    if (f.language) {
      params.push(f.language);
      where += ` AND a."language" = $${params.length}`;
    }
    return where;
  }

  /** Session denominators, per language: sessions, turns, garbled turns. */
  async sessionTotalsByLanguage(f: LanguageAnalyticsFilters): Promise<
    Array<{
      language: string | null;
      sessions: string;
      turns: string;
      turns_garbled: string;
      script_fidelity: string | null;
    }>
  > {
    const params: unknown[] = [];
    const where = this.sessionWhere(f, params);
    return this.dataSource.query(
      `SELECT s."language" AS language,
              COUNT(*) AS sessions,
              COALESCE(SUM(s."turnsJudged"), 0) AS turns,
              COALESCE(SUM(s."turnsGarbled"), 0) AS turns_garbled,
              AVG(s."scriptFidelityPct") AS script_fidelity
         FROM language_judgment_sessions s
        WHERE ${where}
        GROUP BY s."language"`,
      params,
    );
  }

  /**
   * Error counts by (dimension, category, severity), conditioned-out rows
   * excluded — the single source for by-dimension and by-category rollups.
   */
  async annotationCounts(f: LanguageAnalyticsFilters): Promise<
    Array<{
      dimension: string;
      category: string;
      severity: string;
      count: string;
    }>
  > {
    const params: unknown[] = [];
    const where = this.annotationWhere(f, params);
    return this.dataSource.query(
      `SELECT a."dimension" AS dimension,
              a."category" AS category,
              a."severity" AS severity,
              COUNT(*) AS count
         FROM language_error_annotations a
        WHERE ${where} AND a."conditionedOut" = false
        GROUP BY a."dimension", a."category", a."severity"`,
      params,
    );
  }

  /** Weighted error sums per language (conditioned-out excluded). */
  async weightedByLanguage(
    f: LanguageAnalyticsFilters,
  ): Promise<
    Array<{ language: string | null; severity: string; count: string }>
  > {
    const params: unknown[] = [];
    const where = this.annotationWhere(f, params);
    return this.dataSource.query(
      `SELECT a."language" AS language,
              a."severity" AS severity,
              COUNT(*) AS count
         FROM language_error_annotations a
        WHERE ${where} AND a."conditionedOut" = false
        GROUP BY a."language", a."severity"`,
      params,
    );
  }

  /** Prompt-vs-model attribution split (all annotations, incl. conditioned). */
  async isolationBasisCounts(
    f: LanguageAnalyticsFilters,
  ): Promise<Array<{ basis: string | null; count: string }>> {
    const params: unknown[] = [];
    const where = this.annotationWhere(f, params);
    return this.dataSource.query(
      `SELECT a."isolationBasis" AS basis, COUNT(*) AS count
         FROM language_error_annotations a
        WHERE ${where}
        GROUP BY a."isolationBasis"`,
      params,
    );
  }

  /**
   * Session denominators grouped by an experiment dimension column
   * (whitelisted — interpolated into SQL). Average script fidelity rides along
   * (null until Phase 2 populates it).
   */
  async sessionTotalsBy(
    f: LanguageAnalyticsFilters,
    column: 'scenarioVersionId' | 'promptVersion' | 'llmModel' | 'engine',
  ): Promise<
    Array<{
      value: string | null;
      sessions: string;
      turns: string;
      turns_garbled: string;
      script_fidelity: string | null;
    }>
  > {
    const params: unknown[] = [];
    const where = this.sessionWhere(f, params);
    return this.dataSource.query(
      `SELECT s."${column}"::text AS value,
              COUNT(*) AS sessions,
              COALESCE(SUM(s."turnsJudged"), 0) AS turns,
              COALESCE(SUM(s."turnsGarbled"), 0) AS turns_garbled,
              AVG(s."scriptFidelityPct") AS script_fidelity
         FROM language_judgment_sessions s
        WHERE ${where}
        GROUP BY s."${column}"`,
      params,
    );
  }

  /** Weighted error counts grouped by an experiment dimension column. */
  async weightedBy(
    f: LanguageAnalyticsFilters,
    column: 'scenarioVersionId' | 'promptVersion' | 'llmModel' | 'engine',
  ): Promise<Array<{ value: string | null; severity: string; count: string }>> {
    const params: unknown[] = [];
    const where = this.annotationWhere(f, params);
    return this.dataSource.query(
      `SELECT a."${column}"::text AS value,
              a."severity" AS severity,
              COUNT(*) AS count
         FROM language_error_annotations a
        WHERE ${where} AND a."conditionedOut" = false
        GROUP BY a."${column}", a."severity"`,
      params,
    );
  }

  /** Judged turns per week bucket (trend denominator). */
  async turnsByBucket(
    f: LanguageAnalyticsFilters,
  ): Promise<Array<{ bucket: Date; turns: string; turns_garbled: string }>> {
    const params: unknown[] = [];
    const where = this.sessionWhere(f, params);
    return this.dataSource.query(
      `SELECT date_trunc('week', COALESCE(s."occurredAt", s."createdAt")) AS bucket,
              COALESCE(SUM(s."turnsJudged"), 0) AS turns,
              COALESCE(SUM(s."turnsGarbled"), 0) AS turns_garbled
         FROM language_judgment_sessions s
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /** Error counts per (week bucket, dimension, severity) — trend numerator. */
  async countsByBucketAndDimension(
    f: LanguageAnalyticsFilters,
  ): Promise<
    Array<{ bucket: Date; dimension: string; severity: string; count: string }>
  > {
    const params: unknown[] = [];
    const where = this.annotationWhere(f, params);
    return this.dataSource.query(
      `SELECT date_trunc('week', COALESCE(a."occurredAt", a."createdAt")) AS bucket,
              a."dimension" AS dimension,
              a."severity" AS severity,
              COUNT(*) AS count
         FROM language_error_annotations a
        WHERE ${where} AND a."conditionedOut" = false
        GROUP BY 1, 2, 3 ORDER BY 1`,
      params,
    );
  }

  /** Recent annotations for the error-log table (deep-links to session logs). */
  async errorLog(
    f: LanguageAnalyticsFilters,
    limit = 50,
  ): Promise<
    Array<{
      scenario_session_id: string;
      turn_index: number;
      language: string | null;
      dimension: string;
      category: string;
      severity: string;
      isolation_basis: string | null;
      evidence_quote: string | null;
      reasoning: string | null;
      ai_text: string | null;
      occurred_at: Date | null;
    }>
  > {
    const params: unknown[] = [];
    const where = this.annotationWhere(f, params);
    params.push(limit);
    return this.dataSource.query(
      `SELECT a."scenarioSessionId" AS scenario_session_id,
              a."turnIndex" AS turn_index,
              a."language" AS language,
              a."dimension" AS dimension,
              a."category" AS category,
              a."severity" AS severity,
              a."isolationBasis" AS isolation_basis,
              a."evidenceQuote" AS evidence_quote,
              a."reasoning" AS reasoning,
              a."aiText" AS ai_text,
              COALESCE(a."occurredAt", a."createdAt") AS occurred_at
         FROM language_error_annotations a
        WHERE ${where}
        ORDER BY COALESCE(a."occurredAt", a."createdAt") DESC
        LIMIT $${params.length}`,
      params,
    );
  }
}

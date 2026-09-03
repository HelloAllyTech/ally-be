import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { excludeTestTenants } from '../util/test-tenant.util';

/** One language's glossary go-live, derived — never passed in. */
export interface GlossaryGoLiveRow {
  languageId: number;
  languageValue: string;
  languageLabel: string | null;
  goLiveAt: Date;
}

export interface GlossaryEffectFilters {
  judgeModel: string;
  judgePromptVersion: string;
  language?: string | null;
  /** Include internal/demo/QA orgs. Default false, as everywhere else. */
  includeTestOrganizations?: boolean;
}

/** Denominators and the deterministic numerator, at the reporting grain. */
export interface GlossaryEffectTotalsRow {
  languageValue: string;
  period: 'before' | 'after';
  agentModel: string;
  sessions: string;
  turns: string;
  agentMessages: string;
  avoidTermViolations: string;
  /** Sessions dropped as test-org traffic — so a thin cell reads as
   * "excluded", not "clean". */
  testSessionsExcluded: string;
}

/** Style-annotation counts by severity; weighting happens in the service. */
export interface GlossaryEffectStyleRow {
  languageValue: string;
  period: 'before' | 'after';
  agentModel: string;
  severity: string;
  count: string;
}

/**
 * The glossary's measured effect, as ONE definition every consumer reads.
 *
 * Two metrics on the same sessions:
 *   - adherence   — deterministic avoid-term hits per 100 AGENT MESSAGES
 *                   (`glossary_adherence_reports`, no model in the loop)
 *   - naturalness — severity-weighted STYLE error rate per 100 TURNS
 *                   (the language judge; weighting applied in the service)
 * The denominators genuinely differ: adherence is a property of what the agent
 * wrote, naturalness is scored per judged turn. Do not divide one by the other.
 *
 * WHY THIS EXISTS AS ONE PLACE. Reading these numbers ad hoc produced four
 * false results in a single afternoon (2026-09-02), each a moving ruler rather
 * than a real change:
 *   1. avoid-term parser matched only `(avoid: …)`, so Kannada's most-violated
 *      term stopped being counted when its rule was reworded and the rate
 *      "fell" 47.7 → 0.0 while the rule was still in force;
 *   2. the judge rubric mix shifted (v1 share 11% → 49% → 0% across periods);
 *   3. the AGENT model mix moved underneath every pooled average — pooled
 *      naturalness looked like −66%/−82%/−81%, and segmenting erased it;
 *   4. a single platform-wide "go-live" date was applied to every language,
 *      although English published its glossary on 2026-08-20 and the others on
 *      2026-07-22 — which manufactured a fake English regression and nearly
 *      got a working glossary switched off.
 *
 * So the confounders are part of the GRAIN, not something a caller must
 * remember to filter: every row is keyed by (language, period, agentModel) and
 * the judge tuple is pinned by the caller. A cross-model pooled number cannot
 * be produced by accident — only by deliberately summing rows.
 *
 * `period` is relative to EACH LANGUAGE'S OWN go-live, derived in SQL from the
 * earliest published section. That is what stops (4) recurring: there is no
 * date parameter to get wrong.
 */
@Injectable()
export class GlossaryEffectAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * When each language's glossary went live: the earliest published GLOBAL
   * section. Tenant/variety-profile overlay rows (`profileId` non-null) are
   * excluded — they are published independently, per tenant, by
   * consolidation, and an early overlay must not become the date every
   * tenant's sessions get bucketed against (confounder #4 above).
   *
   * Sections are versioned in place, so `createdAt` survives later edits and
   * republishes — which is what makes it a stable intervention date. A
   * language with no published global section is absent, not dated `now()`.
   */
  async goLiveByLanguage(): Promise<GlossaryGoLiveRow[]> {
    return this.dataSource.query(
      `SELECT s."languageId"        AS "languageId",
              l.value               AS "languageValue",
              l.label               AS "languageLabel",
              min(s."createdAt")    AS "goLiveAt"
         FROM language_glossary_sections s
         JOIN languages l ON l.id = s."languageId"
        WHERE s.status = 'published'
          AND s."profileId" IS NULL
        GROUP BY s."languageId", l.value, l.label
        ORDER BY min(s."createdAt")`,
    );
  }

  /** Shared FROM/WHERE so the two reads cannot drift apart. */
  private baseCte(f: GlossaryEffectFilters, params: unknown[]): string {
    const languageClause = f.language
      ? ` AND l.value = $${params.push(f.language)}`
      : '';
    // The adherence report is the spine: it is the only row that carries an
    // agent-message denominator, and it exists for every scanned session.
    return `
      WITH golive AS (
        SELECT s."languageId" AS lid, min(s."createdAt") AS at
          FROM language_glossary_sections s
         WHERE s.status = 'published'
           AND s."profileId" IS NULL
         GROUP BY s."languageId"
      ),
      spine AS (
        SELECT l.value AS language_value,
               CASE WHEN ss."createdAt" < g.at THEN 'before' ELSE 'after' END AS period,
               COALESCE((SELECT mode() WITHIN GROUP (ORDER BY m."llmModel")
                           FROM scenario_session_turn_metrics m
                          WHERE m."scenarioSessionId" = ss.id
                            AND m."llmModel" IS NOT NULL), 'unknown') AS agent_model,
               r."agentMessageCount" AS agent_messages,
               r."totalViolations"   AS violations,
               j.id                  AS jid,
               j."turnsJudged"       AS turns,
               (NOT (${excludeTestTenants('ss."tenant_id"')})) AS is_test
          FROM glossary_adherence_reports r
          JOIN languages l ON l.id = r."languageId"
          JOIN golive g ON g.lid = r."languageId"
          JOIN scenario_sessions ss ON ss.id = r."scenarioSessionId"
          LEFT JOIN language_judgment_sessions j
                 ON j."scenarioSessionId" = r."scenarioSessionId"
                AND j."judgeModel" = $1
                AND j."judgePromptVersion" = $2
         WHERE TRUE${languageClause}
      )`;
  }

  /**
   * Denominators plus the deterministic numerator, per (language, period,
   * model). Test-org sessions are excluded from the metrics but COUNTED, so a
   * thin cell is legible as "excluded" rather than mistaken for "clean".
   */
  async totals(f: GlossaryEffectFilters): Promise<GlossaryEffectTotalsRow[]> {
    const params: unknown[] = [f.judgeModel, f.judgePromptVersion];
    const cte = this.baseCte(f, params);
    const testPredicate = f.includeTestOrganizations ? 'TRUE' : 'NOT is_test';
    return this.dataSource.query(
      `${cte}
       SELECT language_value AS "languageValue",
              period,
              agent_model AS "agentModel",
              count(*) FILTER (WHERE ${testPredicate})::text AS sessions,
              COALESCE(sum(turns) FILTER (WHERE ${testPredicate}), 0)::text AS turns,
              COALESCE(sum(agent_messages) FILTER (WHERE ${testPredicate}), 0)::text AS "agentMessages",
              COALESCE(sum(violations) FILTER (WHERE ${testPredicate}), 0)::text AS "avoidTermViolations",
              count(*) FILTER (WHERE is_test)::text AS "testSessionsExcluded"
         FROM spine
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`,
      params,
    );
  }

  /** Style-dimension annotation counts by severity, same grain. */
  async styleCounts(
    f: GlossaryEffectFilters,
  ): Promise<GlossaryEffectStyleRow[]> {
    const params: unknown[] = [f.judgeModel, f.judgePromptVersion];
    const cte = this.baseCte(f, params);
    const testPredicate = f.includeTestOrganizations
      ? 'TRUE'
      : 'NOT sp.is_test';
    return this.dataSource.query(
      `${cte}
       SELECT sp.language_value AS "languageValue",
              sp.period,
              sp.agent_model AS "agentModel",
              a.severity,
              count(*)::text AS count
         FROM spine sp
         JOIN language_error_annotations a ON a."sessionJudgmentId" = sp.jid
        WHERE ${testPredicate}
          AND a.dimension IN ('register','dialect_lexicon','colloquialness',
                              'codeswitch','persona_social')
          AND a."conditionedOut" = false
        GROUP BY 1, 2, 3, 4`,
      params,
    );
  }
}

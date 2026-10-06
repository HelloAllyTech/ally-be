import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * Label for sessions whose scenario carries no competency at all.
 *
 * Returned as its own row rather than silently dropped: if a third of practice
 * volume is untagged, the map is a map of a third of the platform, and the reader
 * has to be able to see that before drawing conclusions about which skills are
 * neglected. It is also the number that makes the case for tagging the backlog.
 */
export const UNATTRIBUTED_COMPETENCY_LABEL = 'No competency tagged';

/** One competency row of the practice-volume axis. */
export interface CompetencyMapRow {
  /** The competency uuid as stored on the scenario. */
  competencyId: string;
  /** Competency name, falling back to the raw id when the row has vanished. */
  name: string;
  completedSessions: number;
  learners: number;
  /** Distinct scenarios tagged with this competency that have actually been played. */
  scenarios: number;
}

/** The volume axis plus the honest session totals it was built from. */
export interface CompetencyMapResult {
  rows: CompetencyMapRow[];
  /** Completed sessions whose scenario carries no competency. */
  unattributed: { completedSessions: number };
  /**
   * DISTINCT sessions in scope, attributed or not. Deliberately not the sum of
   * `rows` — see the class doc on multi-competency double counting.
   */
  totals: { completedSessions: number };
}

/**
 * Which competencies are heavily practised, and how well does the practice
 * go? The repository half: the VOLUME axis, and the scenario → competency tags
 * the score side attributes cuts with.
 *
 * The SCORE axis is no longer read here. Until 2026-10 this repository joined
 * `scenario_session_details."compositeScore"` — the LLM judge's score of the
 * AI ACTOR — and called its median a competency's proficiency. The score is
 * now the learner's foundational-skills level for the rubric skill the tag
 * names, over single-scenario scored cuts, computed in
 * `CompetencyMapAnalyticsService` from
 * `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts` (one definition of
 * a scored cut) and {@link getScenarioCompetencyTags} below.
 *
 * ALL-TIME by design: this endpoint takes no `range`/`bucket`/`from`/`to`.
 *
 * **Multi-competency sessions are counted more than once, and this is declared
 * rather than hidden.** Roleplay Studio v2 tags a scenario with several
 * competencies (`scenarios."competencyIds"`, a jsonb string array;
 * `competencyId` mirrors its first element for back-compat and is the only tag v1
 * scenarios have). A session on a scenario tagged "empathy" and
 * "boundary-setting" is practice of BOTH, so it contributes to both rows, and
 * `rows[].completedSessions` can sum to MORE than `totals.completedSessions`.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables
 * BY NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), counts `::int` and re-parsed defensively in JS, values as bound
 * parameters.
 */
@Injectable()
export class CompetencyMapAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The volume axis, in two queries over one shared definition.
   *
   * Two rather than one because the totals cannot ride along on the competency
   * rows: a platform whose scenarios are all untagged returns NO competency rows
   * while still having sessions to report, so a `CROSS JOIN totals` would lose
   * exactly the number that explains the empty chart.
   */
  async getCompetencyMap(tenantId?: string): Promise<CompetencyMapResult> {
    const params: unknown[] = [ScenarioSessionEventStatus.COMPLETED];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }
    const cte = this.expandedCte(tenantPlaceholder);

    const [rows, totalRows] = await Promise.all([
      this.dataSource.query(
        `
      ${cte}
      SELECT
        x."competencyId"                                    AS "competencyId",
        COALESCE(c.name, x."competencyId")                  AS "name",
        COUNT(DISTINCT x.session_id)::int                   AS "completedSessions",
        COUNT(DISTINCT x.learner_id)::int                   AS "learners",
        COUNT(DISTINCT x.scenario_id)::int                  AS "scenarios"
      FROM expanded x
      LEFT JOIN competencies c ON c.id::text = x."competencyId"
      WHERE x."competencyId" IS NOT NULL
      GROUP BY x."competencyId", c.name
      ORDER BY "completedSessions" DESC, "name" ASC
      `,
        params,
      ),
      this.dataSource.query(
        `
      ${cte}
      SELECT
        COUNT(DISTINCT session_id)::int                      AS "completedSessions",
        COUNT(DISTINCT session_id)
          FILTER (WHERE "competencyId" IS NULL)::int         AS "unattributedSessions"
      FROM expanded
      `,
        params,
      ),
    ]);

    const t = ((totalRows as Record<string, unknown>[])[0] ?? {}) as Record<
      string,
      unknown
    >;

    return {
      rows: (rows as Record<string, unknown>[]).map((r) => ({
        competencyId: r.competencyId as string,
        name: r.name as string,
        completedSessions: Number(r.completedSessions) || 0,
        learners: Number(r.learners) || 0,
        scenarios: Number(r.scenarios) || 0,
      })),
      unattributed: {
        completedSessions: Number(t.unattributedSessions) || 0,
      },
      totals: {
        completedSessions: Number(t.completedSessions) || 0,
      },
    };
  }

  /**
   * The competency tags each scenario carries, by the same v1/v2 expansion
   * the volume axis uses — so a cut is attributed to exactly the competencies
   * its scenario's sessions are counted under. A deleted scenario, or one with
   * no tags, is absent from the map (its cuts are unattributed).
   */
  async getScenarioCompetencyTags(
    scenarioIds: readonly number[],
  ): Promise<Map<number, string[]>> {
    if (scenarioIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      SELECT sc.id::int AS "scenarioId", tags."competencyId" AS "competencyId"
      FROM scenarios sc
      CROSS JOIN LATERAL (${this.tagsOf('sc')}) tags
      WHERE sc.id = ANY($1::int[])
        AND sc."deletedAt" IS NULL
      ORDER BY 1, 2
      `,
      [scenarioIds],
    );
    const out = new Map<number, string[]>();
    for (const r of rows as Record<string, unknown>[]) {
      const id = Number(r.scenarioId);
      const list = out.get(id) ?? [];
      list.push(String(r.competencyId));
      out.set(id, list);
    }
    return out;
  }

  /**
   * One row per (countable completed session x competency the session's scenario
   * is tagged with), plus one row per session whose scenario is tagged with none.
   *
   * `$1` is the completed session status; `tenantPlaceholder` is the tenant when
   * narrowing. All bound parameters. `scenarios` is LEFT joined so a session on
   * a since-deleted scenario stays in the totals as unattributed rather than
   * vanishing from the platform's history.
   */
  private expandedCte(tenantPlaceholder?: string): string {
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('s."tenant_id"', tenantPlaceholder)}`
      : '';
    return `
      WITH sessions AS (
        SELECT
          s.id                AS session_id,
          s."counselorId"     AS learner_id,
          s."scenarioId"      AS scenario_id
        FROM scenario_sessions s
        WHERE s."eventStatus" = $1
          AND ${countableSessionPredicate('s')}
          AND ${excludeTestTenants('s."tenant_id"')}
          ${tenantPredicate}
      ),
      expanded AS (
        SELECT
          sess.session_id,
          sess.learner_id,
          sess.scenario_id,
          tags."competencyId"
        FROM sessions sess
        LEFT JOIN scenarios sc
               ON sc.id = sess.scenario_id
              AND sc."deletedAt" IS NULL
        LEFT JOIN LATERAL (${this.tagsOf('sc')}) tags ON true
      )`;
  }

  /**
   * The distinct competency ids one scenario row (alias `sc`) is tagged with —
   * the ONE expansion both the volume axis and the cut attribution use.
   *
   * Deliberately literal about the v1/v2 split:
   *   - `competencyIds` is expanded when it is a NON-EMPTY ARRAY;
   *   - `competencyId` is used ONLY when it is not, which is the v1 case.
   *     Unioning both unconditionally would double-count the mirror (v2 keeps
   *     `competencyId = competencyIds[0]`) and would silently invent a tag
   *     whenever the mirror had gone stale.
   *
   * `jsonb_typeof(...) = 'array'` is inside the function argument, not in a
   * WHERE: `jsonb_array_elements_text` on a non-array value ABORTS the query, and
   * set-returning functions are evaluated before the WHERE clause could filter
   * the row out — one malformed scenario would take the whole card down.
   *
   * Joined to `competencies` by `c.id::text = tag` (never the text cast to
   * uuid), so a stale or hand-edited tag fails to match rather than throws.
   */
  private tagsOf(alias: string): string {
    const ids = `CASE WHEN jsonb_typeof(${alias}."competencyIds") = 'array'
                        THEN ${alias}."competencyIds"
                        ELSE '[]'::jsonb END`;
    return `
          SELECT DISTINCT btrim(raw.v) AS "competencyId"
          FROM (
            SELECT e.value AS v
            FROM jsonb_array_elements_text(${ids}) AS e(value)
            UNION ALL
            SELECT ${alias}."competencyId"::text AS v
            WHERE ${alias}."competencyId" IS NOT NULL
              AND COALESCE(jsonb_array_length(${ids}), 0) = 0
          ) raw
          WHERE btrim(raw.v) <> ''`;
  }
}

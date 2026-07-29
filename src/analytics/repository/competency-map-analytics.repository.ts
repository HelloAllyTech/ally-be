import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { ActorEvaluationStatus } from '../../learn/service/scenario-session-evaluation.service';
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

/** One competency row of the practice-vs-score map. */
export interface CompetencyMapRow {
  /** The competency uuid as stored on the scenario. */
  competencyId: string;
  /** Competency name, falling back to the raw id when the row has vanished. */
  name: string;
  completedSessions: number;
  evaluatedSessions: number;
  /** RAW median — the service applies the sample floor. */
  medianScore: number | null;
  learners: number;
  /** Distinct scenarios tagged with this competency that have actually been played. */
  scenarios: number;
}

/** Sessions the map cannot attribute to any competency. */
export interface CompetencyMapUnattributedRow {
  completedSessions: number;
  evaluatedSessions: number;
}

/** The map plus the honest session totals it was built from. */
export interface CompetencyMapResult {
  rows: CompetencyMapRow[];
  unattributed: CompetencyMapUnattributedRow;
  /**
   * DISTINCT sessions in scope, attributed or not. Deliberately not the sum of
   * `rows` — see the class doc on multi-competency double counting.
   */
  totals: { completedSessions: number; evaluatedSessions: number };
}

/**
 * Which competencies are heavily practised, and which score badly?
 *
 * The prioritisation chart: practice volume on one axis and median score on the
 * other, so the four quadrants are four different decisions — high volume + low
 * score is where content work pays off immediately, low volume + low score is a
 * gap nobody is training, high volume + high score is a competency that may be
 * over-served, and low volume + high score is fine. A ranked list of scores alone
 * cannot say which of those a competency is in (wiki
 * `product/data-visualisation.md` — the shape has to carry the decision, and
 * `product/prioritisation.md` on volume-vs-quality reading).
 *
 * ALL-TIME by design, like roleplay volume and cohort retention: this endpoint
 * takes no `range`/`bucket`/`from`/`to`. Per-competency medians need a sample, and
 * splitting the platform across a dozen competencies AND a 30-day window leaves
 * nearly every cell below the score floor — the chart would report the length of
 * the window rather than which skills are weak.
 *
 * **Multi-competency sessions are counted more than once, and this is declared
 * rather than hidden.** Roleplay Studio v2 tags a scenario with several
 * competencies (`scenarios."competencyIds"`, a jsonb string array;
 * `competencyId` mirrors its first element for back-compat and is the only tag v1
 * scenarios have). A session played on a scenario tagged "empathy" and
 * "boundary-setting" is practice of BOTH, so it contributes to both rows. The
 * consequence is that `rows[].completedSessions` can sum to MORE than
 * `totals.completedSessions`, and the API says so on its face: the alternative —
 * attributing the session to the first competency only — would understate every
 * competency after the first and make the map's ranking depend on the order
 * somebody happened to tick boxes in.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables
 * BY NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), counts `::int` and re-parsed defensively in JS, values as bound
 * parameters. Percentiles come back RAW — suppressing a thin cell is the
 * service's job.
 */
@Injectable()
export class CompetencyMapAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The map, in two queries over one shared definition.
   *
   * Two rather than one because the totals cannot ride along on the competency
   * rows: a platform whose scenarios are all untagged returns NO competency rows
   * while still having sessions to report, so a `CROSS JOIN totals` would lose
   * exactly the number that explains the empty chart.
   *
   * Both queries build the same `expanded` CTE from
   * {@link expandedCte}, so "a session attributed to a competency" has one
   * definition and the parts cannot stop reconciling with the whole.
   */
  async getCompetencyMap(tenantId?: string): Promise<CompetencyMapResult> {
    const params: unknown[] = [
      ScenarioSessionEventStatus.COMPLETED,
      ActorEvaluationStatus.COMPLETED,
    ];
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
        COUNT(DISTINCT x.session_id)
          FILTER (WHERE x.score IS NOT NULL)::int           AS "evaluatedSessions",
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY x.score)
          FILTER (WHERE x.score IS NOT NULL))::numeric, 1)::float
                                                            AS "medianScore",
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
          FILTER (WHERE score IS NOT NULL)::int              AS "evaluatedSessions",
        COUNT(DISTINCT session_id)
          FILTER (WHERE "competencyId" IS NULL)::int         AS "unattributedSessions",
        COUNT(DISTINCT session_id)
          FILTER (WHERE "competencyId" IS NULL
                  AND score IS NOT NULL)::int                AS "unattributedEvaluated"
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
        evaluatedSessions: Number(r.evaluatedSessions) || 0,
        medianScore: this.num(r.medianScore),
        learners: Number(r.learners) || 0,
        scenarios: Number(r.scenarios) || 0,
      })),
      unattributed: {
        completedSessions: Number(t.unattributedSessions) || 0,
        evaluatedSessions: Number(t.unattributedEvaluated) || 0,
      },
      totals: {
        completedSessions: Number(t.completedSessions) || 0,
        evaluatedSessions: Number(t.evaluatedSessions) || 0,
      },
    };
  }

  /**
   * One row per (countable completed session x competency the session's scenario
   * is tagged with), plus one row per session whose scenario is tagged with none.
   *
   * `$1` is the completed session status, `$2` the completed evaluation status;
   * `tenantPlaceholder` is the tenant when narrowing. All bound parameters.
   *
   * The evaluation is a LEFT JOIN, not an inner one: the volume axis of this
   * chart is COMPLETED sessions, and a competency practised 400 times with only
   * 12 sessions judged is an important thing to be able to see. An inner join
   * would quietly turn the volume axis into "judged volume" and hide the
   * competencies where evaluation coverage is the actual problem. `scenarios` is
   * also LEFT joined so a session on a since-deleted scenario stays in the
   * totals as unattributed rather than vanishing from the platform's history.
   *
   * The competency expansion is deliberately literal about the v1/v2 split:
   *   - `competencyIds` is expanded when it is a NON-EMPTY ARRAY;
   *   - `competencyId` is used ONLY when it is not, which is the v1 case.
   *     Unioning both unconditionally would double-count the mirror (v2 keeps
   *     `competencyId = competencyIds[0]`), and while `DISTINCT` would absorb an
   *     exact mirror it would silently invent a tag whenever the mirror had gone
   *     stale.
   *
   * `jsonb_typeof(...) = 'array'` is inside the function argument, not in a
   * WHERE: `jsonb_array_elements_text` on a non-array value ABORTS the query, and
   * set-returning functions are evaluated before the WHERE clause could filter
   * the row out — one malformed scenario would take the whole card down.
   *
   * `c.id::text = x."competencyId"` casts the UUID to text, never the text to
   * uuid: a stale or hand-edited tag that is not a valid uuid must fail to match
   * rather than throw (the same lesson as the tenant helpers).
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
          s."scenarioId"      AS scenario_id,
          d."compositeScore"  AS score
        FROM scenario_sessions s
        LEFT JOIN scenario_session_details d
               ON d."scenarioSessionId" = s.id
              AND d."evaluationStatus" = $2
              AND d."compositeScore" IS NOT NULL
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
          sess.score,
          tags."competencyId"
        FROM sessions sess
        LEFT JOIN scenarios sc
               ON sc.id = sess.scenario_id
              AND sc."deletedAt" IS NULL
        LEFT JOIN LATERAL (
          SELECT DISTINCT btrim(raw.v) AS "competencyId"
          FROM (
            SELECT e.value AS v
            FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(sc."competencyIds") = 'array'
                        THEN sc."competencyIds"
                        ELSE '[]'::jsonb END
                 ) AS e(value)
            UNION ALL
            SELECT sc."competencyId"::text AS v
            WHERE sc."competencyId" IS NOT NULL
              AND COALESCE(
                    jsonb_array_length(
                      CASE WHEN jsonb_typeof(sc."competencyIds") = 'array'
                           THEN sc."competencyIds"
                           ELSE '[]'::jsonb END
                    ), 0) = 0
          ) raw
          WHERE btrim(raw.v) <> ''
        ) tags ON true
      )`;
  }

  /** pg hands numerics back as strings; NULL must survive as null, not 0. */
  private num(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}

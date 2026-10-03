import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { isBenchmarkScenarioSql } from 'src/foundational-skills/constants/fhs-benchmark.constants';
import { FhsBenchmarkStatus } from 'src/foundational-skills/enum/foundational-skills.enum';
import { fhsEligibleSession } from 'src/foundational-skills/util/fhs-eligible-session.util';
import { excludeTestTenants } from '../util/test-tenant.util';

export interface BenchmarkScenarioRow {
  id: number;
  title: string | null;
  sessionsScored: number;
}

export interface BenchmarkCoverageRow {
  sessionsScored: number;
  sessionsSkipped: number;
  sessionsFailed: number;
  sessionsPending: number;
}

/** One scored benchmark session with an assessable composite. */
export interface BenchmarkSessionRow {
  sessionId: string;
  userId: number;
  name: string | null;
  tenantId: string | null;
  scenarioId: number;
  endedAt: Date;
  cutsBefore: number;
  composite: number;
  /** Only skills the session gave an opportunity for. */
  levels: Record<string, number>;
}

/**
 * Reads `foundational_skill_benchmark_assessments` (written by
 * src/foundational-skills) for the benchmark chart.
 *
 * Every query is pinned to one rubric version and restricted to scenarios
 * CURRENTLY flagged `metadata.fhsBenchmark`: un-flagging a roleplay takes it
 * off the chart (re-flagging brings it back, nothing is deleted). Test
 * organisations are dropped by the session's tenant, here as well as at
 * scoring time, so a tenant flagged as a test org later disappears too.
 */
@Injectable()
export class FoundationalSkillsBenchmarkAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Flagged scenarios, each with its scored-session count. */
  async getScenarios(rubricVersion: string): Promise<BenchmarkScenarioRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT sc.id, sc.title, COUNT(b.id)::int AS sessions_scored
        FROM scenarios sc
        LEFT JOIN foundational_skill_benchmark_assessments b
          ON b."scenarioId" = sc.id
         AND b."rubricVersion" = $1
         AND b.status = '${FhsBenchmarkStatus.SCORED}'
         AND ${excludeTestTenants('b."tenant_id"')}
       WHERE ${isBenchmarkScenarioSql('sc')}
       GROUP BY sc.id, sc.title
       ORDER BY sc.title, sc.id
      `,
      [rubricVersion],
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      title: (r.title as string | null) ?? null,
      sessionsScored: Number(r.sessions_scored),
    }));
  }

  /**
   * How far scoring has got, so a thin chart can say why. "Pending" uses the
   * scheduler's own eligibility rule, so it counts exactly what it will pick up.
   */
  async getCoverage(rubricVersion: string): Promise<BenchmarkCoverageRow> {
    const [row] = await this.dataSource.query(
      `
      WITH bench AS (
        SELECT sc.id FROM scenarios sc WHERE ${isBenchmarkScenarioSql('sc')}
      ),
      assessed AS (
        SELECT b.status
          FROM foundational_skill_benchmark_assessments b
         WHERE b."rubricVersion" = $1
           AND b."scenarioId" IN (SELECT id FROM bench)
           AND ${excludeTestTenants('b."tenant_id"')}
      ),
      pending AS (
        SELECT COUNT(*)::int AS n
          FROM scenario_sessions s
         WHERE s."scenarioId" IN (SELECT id FROM bench)
           AND ${fhsEligibleSession('s')}
           AND NOT EXISTS (
             SELECT 1 FROM foundational_skill_benchmark_assessments bp
              WHERE bp."sessionId" = s.id AND bp."rubricVersion" = $1
           )
      )
      SELECT COUNT(*) FILTER (WHERE status = '${FhsBenchmarkStatus.SCORED}')::int AS scored,
             COUNT(*) FILTER (WHERE status = '${FhsBenchmarkStatus.SKIPPED}')::int AS skipped,
             COUNT(*) FILTER (WHERE status = '${FhsBenchmarkStatus.FAILED}')::int AS failed,
             (SELECT n FROM pending) AS pending
        FROM assessed
      `,
      [rubricVersion],
    );
    return {
      sessionsScored: Number(row?.scored ?? 0),
      sessionsSkipped: Number(row?.skipped ?? 0),
      sessionsFailed: Number(row?.failed ?? 0),
      sessionsPending: Number(row?.pending ?? 0),
    };
  }

  /**
   * Every scored benchmark session with a composite (a session where nothing
   * was assessable has none and cannot be compared), in pairing order: by
   * learner, scenario, then when it ended. Benchmark sessions are a handful per
   * learner, so the whole set is read and paired in memory.
   */
  async getScoredSessions(
    rubricVersion: string,
  ): Promise<BenchmarkSessionRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT b."sessionId" AS session_id, b."userId" AS user_id, u.name,
             b.tenant_id, b."scenarioId" AS scenario_id,
             b."sessionEndedAt" AS ended_at, b."cutsBefore" AS cuts_before,
             b."compositeScore"::float AS composite, b."skillLevels" AS levels
        FROM foundational_skill_benchmark_assessments b
        JOIN scenarios sc ON sc.id = b."scenarioId"
        LEFT JOIN users u ON u.id = b."userId"
       WHERE b."rubricVersion" = $1
         AND b.status = '${FhsBenchmarkStatus.SCORED}'
         AND b."compositeScore" IS NOT NULL
         AND ${isBenchmarkScenarioSql('sc')}
         AND ${excludeTestTenants('b."tenant_id"')}
       ORDER BY b."userId", b."scenarioId", b."sessionEndedAt", b."sessionId"
      `,
      [rubricVersion],
    );
    return rows.map((r: any) => ({
      sessionId: String(r.session_id),
      userId: Number(r.user_id),
      name: (r.name as string | null) ?? null,
      tenantId: (r.tenant_id as string | null) ?? null,
      scenarioId: Number(r.scenario_id),
      endedAt: new Date(r.ended_at),
      cutsBefore: Number(r.cuts_before),
      composite: Number(r.composite),
      levels: r.levels && typeof r.levels === 'object' ? r.levels : {},
    }));
  }
}

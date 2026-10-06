import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { UserRole } from '../../common/constants/user.constants';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../../learn/enum/scenario-session-status.enum';
import type {
  FunnelPopulationRow,
  SessionSegmentAttributes,
} from '../util/effectiveness.util';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import {
  excludeTestTenants,
  excludeTestTenantsByUser,
  scopeToTenant,
} from '../util/test-tenant.util';

/**
 * Reads for Highlights → Effectiveness that the foundational-skills repository
 * does not already serve. The scored cuts themselves come from
 * `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts` (read-only reuse),
 * so the cut set — and the trend classification and panel built on it — is
 * byte-for-byte the Helping skills tab's.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over
 * tables BY NAME, quoted camelCase identifiers (only `tenant_id` is
 * snake_case), every value a bound parameter, counts `::int` and re-parsed
 * defensively, and a test-organisation exclusion on every query.
 */
@Injectable()
export class EffectivenessAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Every learner-role account in scope with its count of countable sessions —
   * stages 1–3 of the effectiveness funnel.
   *
   * The population is the activation funnel's (`ActivationAnalyticsRepository`
   * `learnersCte`), copied deliberately: LEARNER membership via `user_groups`
   * → `groups.name` (a user's roles are rows there, never a collapsed `role`
   * column), test orgs excluded and the org filter applied on the USER's own
   * tenant, and `deletedAt` NOT filtered — so "Signed up" here is the same
   * number as the activation funnel's first bar for the same org.
   *
   * A countable session is the house definition: `status = 'ENDED'`,
   * `eventStatus = 'COMPLETED'`, not a preview or seed room, not in a test org.
   * That is one predicate stricter than the activation funnel's "Completed
   * one" (which does not require `status = 'ENDED'`), so stage 2 can sit a
   * hair below it. Sessions count wherever the learner played them, as in the
   * activation funnel: the org filter narrows WHO, not where.
   *
   * One row per learner (a LEFT JOIN, so learners who never practised are
   * present with 0): the service intersects these ids with the scored-cut
   * learners, which needs membership, not just counts. A few thousand rows at
   * today's volume.
   */
  async getFunnelPopulation(tenantId?: string): Promise<FunnelPopulationRow[]> {
    const params: unknown[] = [
      UserRole.LEARNER,
      ScenarioSessionStatus.ENDED,
      ScenarioSessionEventStatus.COMPLETED,
    ];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant('u."tenant_id"', `$${params.length}`)}`;
    }
    const rows = await this.dataSource.query(
      `
      WITH learners AS (
        SELECT u.id AS user_id
          FROM users u
         WHERE EXISTS (
                 SELECT 1 FROM user_groups ug
                 JOIN groups g ON g.id = ug."groupId"
                 WHERE ug."userId" = u.id AND g.name = $1
               )
           AND ${excludeTestTenants('u."tenant_id"')}
           ${tenantPredicate}
      )
      SELECT l.user_id,
             COUNT(s.id)::int AS countable_sessions
        FROM learners l
        LEFT JOIN scenario_sessions s
               ON s."counselorId" = l.user_id
              AND s.status = $2
              AND s."eventStatus" = $3
              AND ${countableSessionPredicate('s')}
              AND ${excludeTestTenants('s."tenant_id"')}
       GROUP BY l.user_id
      `,
      params,
    );
    return rows.map((r: any) => ({
      userId: Number(r.user_id),
      countableSessions: Number(r.countable_sessions) || 0,
    }));
  }

  /**
   * Language and scenario difficulty behind each session, for the language
   * and difficulty segments.
   *
   * Language follows the language-mix convention (`metadata->>'languageId'` →
   * `languages`, `active` ignored, label preferred over value), with a digits
   * guard so a malformed id resolves to "unknown" instead of failing the cast.
   * Difficulty is the scenario's CURRENT `difficultyLevel` (a varchar
   * defaulting to MEDIUM); the service normalises it.
   */
  async getSessionSegmentAttributes(
    sessionIds: string[],
  ): Promise<Map<string, SessionSegmentAttributes>> {
    if (sessionIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      SELECT ss.id::text AS session_id,
             NULLIF(l.value, '') AS language_key,
             COALESCE(NULLIF(l.label, ''), NULLIF(l.value, '')) AS language_label,
             sc."difficultyLevel" AS difficulty
        FROM scenario_sessions ss
        LEFT JOIN languages l
          ON l.id = CASE
                      WHEN ss.metadata->>'languageId' ~ '^[0-9]{1,9}$'
                      THEN (ss.metadata->>'languageId')::int
                    END
        LEFT JOIN scenarios sc ON sc.id = ss."scenarioId"
       WHERE ss.id = ANY($1::uuid[])
         AND ${excludeTestTenants('ss."tenant_id"')}
      `,
      [sessionIds],
    );
    return new Map(
      rows.map((r: any) => [
        String(r.session_id),
        {
          languageKey: (r.language_key as string | null) ?? null,
          languageLabel: (r.language_label as string | null) ?? null,
          difficulty: (r.difficulty as string | null) ?? null,
        },
      ]),
    );
  }

  /**
   * `users.metadata->>'workerType'` per learner — the value an org admin set,
   * as it is now (there is no history). Absent means never set; the service
   * normalises the spelling.
   */
  async getWorkerTypes(userIds: number[]): Promise<Map<number, string | null>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      SELECT u.id AS user_id, u.metadata->>'workerType' AS worker_type
        FROM users u
       WHERE u.id = ANY($1::int[])
         AND ${excludeTestTenants('u."tenant_id"')}
      `,
      [userIds],
    );
    return new Map(
      rows.map((r: any) => [
        Number(r.user_id),
        (r.worker_type as string | null) ?? null,
      ]),
    );
  }

  /**
   * Each learner's earliest STARTED enrollment in a live course — the course
   * segment compares it with the close of their first "now"-window cut.
   * Course-impact's enrollment rules: live enrollments in live tracks, test
   * orgs excluded by walking the user (the enrollment's own tenant is
   * nullable). Not narrowed by org: the panel already is, and a course the
   * learner started anywhere is exposure to a course.
   */
  async getCourseStarts(userIds: number[]): Promise<Map<number, Date>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      SELECT e."userId" AS user_id, MIN(e."startedAt") AS started_at
        FROM track_enrollments e
        JOIN tracks t ON t.id = e."trackId" AND t."deletedAt" IS NULL
       WHERE e."deletedAt" IS NULL
         AND e."startedAt" IS NOT NULL
         AND e."userId" = ANY($1::int[])
         AND ${excludeTestTenantsByUser('e."userId"')}
       GROUP BY e."userId"
      `,
      [userIds],
    );
    return new Map(
      rows.map((r: any) => [Number(r.user_id), new Date(r.started_at)]),
    );
  }

  /**
   * Every tenant reference a `tenant_id` column may hold (uuid or code) →
   * the tenant's uuid, so the org-size segment counts one org once whichever
   * spelling its cuts carry. Test organisations are left out: their cuts are
   * already excluded upstream.
   */
  async getTenantAliases(): Promise<Map<string, string>> {
    const rows = await this.dataSource.query(
      `
      SELECT t.id::text AS id, t.code AS code
        FROM tenants t
       WHERE t."isTestOrganization" IS NOT TRUE
      `,
    );
    const aliases = new Map<string, string>();
    for (const r of rows as { id: string; code: string | null }[]) {
      aliases.set(String(r.id), String(r.id));
      if (r.code) aliases.set(String(r.code), String(r.id));
    }
    return aliases;
  }
}

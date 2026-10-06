import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { SKILL_GROWTH_LEARNER_ROW_CAP } from '../util/skill-growth.util';

/** One scored knowledge-side attempt (quiz or annotation) for a learner. */
export interface SkillGrowthKnowledgeAttempt {
  kind: 'quiz' | 'annotation';
  itemTitle: string | null;
  scorePct: number;
  attemptNumber: number;
  submittedAt: string | null;
}

/** The learner's identity, as the drill-down header and the list need it. */
export interface SkillGrowthLearnerIdentity {
  id: number;
  name: string | null;
  email: string | null;
  tenantId: string | null;
}

/**
 * The few reads Skill growth makes that are NOT the learner ruler.
 *
 * The ruler itself — every scored foundational-skills cut with its levels,
 * verdicts and sessions — is read through
 * `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts`, so there is ONE
 * definition of a scored cut on the platform (rubric pinned to
 * `FHS_RUBRIC_VERSION`, status SCORED, composite not null, test organisations
 * excluded, org filter on the cut's own tenant) and the Skill growth and
 * Helping skills sub-tabs cannot drift apart on it. Until 2026-10 this
 * repository read `scenario_session_details."compositeScore"` — the judge's
 * score of the AI ACTOR — and nothing here reads that table any more.
 *
 * What remains: who a learner is (name, email, tenant) and their quiz and
 * annotation attempts, the knowledge-side series that was always a learner
 * ruler and is unchanged.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables
 * BY NAME, quoted camelCase identifiers (only `tenant_id` is snake_case),
 * values as bound parameters, numerics re-parsed defensively in JS.
 */
@Injectable()
export class SkillGrowthAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The learner as the drill-down header shows them; null when no such user. */
  async getLearnerIdentity(
    learnerId: number,
  ): Promise<SkillGrowthLearnerIdentity | null> {
    const [identity] = await this.getLearnerIdentities([learnerId]);
    return identity ?? null;
  }

  /**
   * Name, email and home tenant for a page of learners — only the page, so a
   * list of 20 never reads every user. The cut rows carry a name but not an
   * email, and their tenant is the tenant a cut CLOSED in rather than the
   * learner's own, which is what the table's tenant column has always shown.
   */
  async getLearnerIdentities(
    learnerIds: readonly number[],
  ): Promise<SkillGrowthLearnerIdentity[]> {
    if (learnerIds.length === 0) return [];
    const rows = await this.dataSource.query(
      `
      SELECT u.id::int AS "id", u.name AS "name", u.email AS "email",
             u."tenant_id" AS "tenantId"
      FROM users u
      WHERE u.id = ANY($1::int[])
      `,
      [learnerIds],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id) || 0,
      name: (r.name as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      tenantId: (r.tenantId as string | null) ?? null,
    }));
  }

  /**
   * One learner's scored quiz and annotation attempts, oldest first — the
   * knowledge-side series, kept apart from the roleplay series on purpose
   * (blending was explicitly scoped out: an invented weighting hides which
   * signal moved).
   */
  async getLearnerKnowledgeAttempts(
    learnerId: number,
  ): Promise<SkillGrowthKnowledgeAttempt[]> {
    const rows = await this.dataSource.query(
      `
      SELECT * FROM (
        SELECT
          'quiz'                 AS "kind",
          ti.title               AS "itemTitle",
          a."scorePct"::float    AS "scorePct",
          a."attemptNumber"::int AS "attemptNumber",
          a."submittedAt"        AS "submittedAt"
        FROM track_quiz_attempts a
        LEFT JOIN track_items ti ON ti.id = a."trackItemId"
        WHERE a."userId" = $1
          AND a."scorePct" IS NOT NULL
          AND a."deletedAt" IS NULL
        UNION ALL
        SELECT
          'annotation'           AS "kind",
          ti.title               AS "itemTitle",
          a."scorePct"::float    AS "scorePct",
          a."attemptNumber"::int AS "attemptNumber",
          a."submittedAt"        AS "submittedAt"
        FROM track_annotation_attempts a
        LEFT JOIN track_items ti ON ti.id = a."trackItemId"
        WHERE a."userId" = $1
          AND a."scorePct" IS NOT NULL
          AND a."deletedAt" IS NULL
      ) attempts
      ORDER BY "submittedAt" ASC NULLS LAST
      LIMIT ${SKILL_GROWTH_LEARNER_ROW_CAP}
      `,
      [learnerId],
    );

    const typed = rows as Record<string, unknown>[];
    return typed.map((r) => ({
      kind: r.kind === 'annotation' ? 'annotation' : 'quiz',
      itemTitle: (r.itemTitle as string | null) ?? null,
      scorePct: this.num(r.scorePct) ?? 0,
      attemptNumber: Number(r.attemptNumber) || 0,
      submittedAt: this.iso(r.submittedAt),
    }));
  }

  /** pg timestamps arrive as Date or string depending on driver mood. */
  private iso(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  /** pg hands numerics back as strings; NULL must survive as null, not 0. */
  private num(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}

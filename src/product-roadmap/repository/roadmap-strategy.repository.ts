import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoadmapStrategyGoal } from '../entity/roadmap-strategy-goal.entity';
import { RoadmapOpportunityGoalImpact } from '../entity/roadmap-opportunity-goal-impact.entity';
import { RoadmapRankWeights } from '../entity/roadmap-rank-weights.entity';

/** One opportunity's stored verdicts, as the assessment service and the drawer read them. */
export interface GoalImpactVerdict {
  goalName: string;
  helped: boolean;
  reason: string | null;
  assessedAt: Date;
}

/**
 * The scalars the composite score normalises against. Read once per board load and passed into
 * the ranking SQL as parameters rather than recomputed per row.
 *
 * DELIBERATELY UNFILTERED, exactly like the existing maxScore: normalising against the filtered
 * maximum would make a card's score depend on which filter you were looking at, so the same
 * opportunity would rank 100 in one view and 40 in another.
 */
export interface RankBases {
  maxScore: number;
  maxVoters: number;
  totalGoals: number;
}

@Injectable()
export class RoadmapStrategyGoalRepository extends Repository<RoadmapStrategyGoal> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapStrategyGoal, dataSource.createEntityManager());
  }

  findAllOrdered(): Promise<RoadmapStrategyGoal[]> {
    return this.find({ order: { position: 'ASC', name: 'ASC' } });
  }

  /**
   * How many rankable opportunities have NO verdict yet against this goal.
   *
   * This is the staleness signal the settings UI shows. Adding a strategy goal leaves every
   * existing opportunity unassessed against it, and coverage divides by the live goal count —
   * so without this number the board would quietly rank everything lower and look confident
   * about it. Scoped to the rankable population (ideas in the queue stages), because a released
   * or archived opportunity is not waiting on anything.
   */
  async countUnassessed(name: string): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count
         FROM roadmap_opportunities o
        WHERE o."deletedAt" IS NULL
          AND o."type" <> 'bug'
          AND o."stage" IN ('new', 'prioritised', 'under_development')
          AND NOT EXISTS (SELECT 1 FROM roadmap_opportunity_goal_impacts i
                           WHERE i."opportunityId" = o.id AND i."goalName" = $1)`,
      [name],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Unassessed counts for every goal, for the settings list. */
  async getUnassessedCounts(): Promise<Record<string, number>> {
    const goals = await this.findAllOrdered();
    const entries = await Promise.all(
      goals.map(
        async (g) => [g.name, await this.countUnassessed(g.name)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
}

@Injectable()
export class RoadmapGoalImpactRepository extends Repository<RoadmapOpportunityGoalImpact> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapOpportunityGoalImpact, dataSource.createEntityManager());
  }

  /**
   * Replace one opportunity's verdicts with a freshly assessed set, atomically.
   *
   * DELETE-then-INSERT inside a transaction rather than an upsert-per-row: a goal that has been
   * removed from the strategy since the last assessment must not leave a stale verdict behind,
   * and expressing "these are now the only verdicts" as a diff would be a slower way to say the
   * same thing. The FK to roadmap_strategy_goals means a verdict for a goal that no longer
   * exists is rejected rather than silently stored, so a model that invents a goal name fails
   * loudly here instead of skewing coverage.
   */
  async replaceForOpportunity(
    opportunityId: string,
    verdicts: { goalName: string; helped: boolean; reason: string | null }[],
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.delete(RoadmapOpportunityGoalImpact, { opportunityId });
      if (!verdicts.length) return;
      await em.insert(
        RoadmapOpportunityGoalImpact,
        verdicts.map((v) => ({
          opportunityId,
          goalName: v.goalName,
          helped: v.helped,
          reason: v.reason,
          assessedAt: new Date(),
        })),
      );
    });
  }

  /** One opportunity's verdicts, ordered to match the settings list. */
  async findForOpportunity(
    opportunityId: string,
  ): Promise<GoalImpactVerdict[]> {
    return this.dataSource.query<GoalImpactVerdict[]>(
      `SELECT i."goalName", i.helped, i.reason, i."assessedAt"
         FROM roadmap_opportunity_goal_impacts i
         JOIN roadmap_strategy_goals g ON g.name = i."goalName"
        WHERE i."opportunityId" = $1
        ORDER BY g.position ASC, g.name ASC`,
      [opportunityId],
    );
  }

  /**
   * Rankable opportunities missing a verdict for at least one live strategy goal — the work
   * list for a bulk re-assessment. Ordered oldest-first so a capped run makes predictable
   * progress rather than re-picking the same rows.
   */
  async findNeedingAssessment(limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT o.id
         FROM roadmap_opportunities o
        WHERE o."deletedAt" IS NULL
          AND o."type" <> 'bug'
          AND o."stage" IN ('new', 'prioritised', 'under_development')
          AND (SELECT COUNT(*) FROM roadmap_opportunity_goal_impacts i
                WHERE i."opportunityId" = o.id)
              < (SELECT COUNT(*) FROM roadmap_strategy_goals)
        ORDER BY o."createdAt" ASC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }

  /** How many rankable opportunities are missing at least one verdict. */
  async countNeedingAssessment(): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count
         FROM roadmap_opportunities o
        WHERE o."deletedAt" IS NULL
          AND o."type" <> 'bug'
          AND o."stage" IN ('new', 'prioritised', 'under_development')
          AND (SELECT COUNT(*) FROM roadmap_opportunity_goal_impacts i
                WHERE i."opportunityId" = o.id)
              < (SELECT COUNT(*) FROM roadmap_strategy_goals)`,
    );
    return Number(rows[0]?.count ?? 0);
  }
}

@Injectable()
export class RoadmapRankWeightsRepository extends Repository<RoadmapRankWeights> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapRankWeights, dataSource.createEntityManager());
  }

  /**
   * The singleton weight row. The migration inserts it, so a missing row means someone deleted
   * it by hand — recreate rather than throw, because a board that will not load is a worse
   * answer than a board using the documented defaults.
   */
  async getWeights(): Promise<RoadmapRankWeights> {
    const existing = await this.findOne({ where: { id: 1 } });
    if (existing) return existing;
    return this.save(this.create({ id: 1 }));
  }

  /**
   * The normalisation bases, in ONE round trip.
   *
   * maxVoters counts DISTINCT backers, which is not derivable from maxScore: one admin spending
   * 40 votes and forty admins spending one each produce the same total and very different
   * breadth. That difference is the entire reason the second factor exists.
   */
  async getRankBases(): Promise<RankBases> {
    const [row] = await this.dataSource.query<
      { maxScore: string; maxVoters: string; totalGoals: string }[]
    >(
      `SELECT COALESCE(MAX(s.score), 0)  AS "maxScore",
              COALESCE(MAX(s.voters), 0) AS "maxVoters",
              (SELECT COUNT(*) FROM roadmap_strategy_goals) AS "totalGoals"
         FROM (SELECT a."opportunityId",
                      SUM(a.votes)                  AS score,
                      COUNT(DISTINCT a."userId")    AS voters
                 FROM roadmap_allocations a
                 JOIN roadmap_opportunities o ON o.id = a."opportunityId"
                WHERE o."deletedAt" IS NULL
                  AND o."type" <> 'bug'
                  AND a.votes > 0
                GROUP BY a."opportunityId") s`,
    );
    return {
      maxScore: Number(row?.maxScore ?? 0),
      maxVoters: Number(row?.maxVoters ?? 0),
      totalGoals: Number(row?.totalGoals ?? 0),
    };
  }
}

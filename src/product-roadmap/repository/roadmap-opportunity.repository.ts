import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { RoadmapEmbeddingStatus } from '../enum/roadmap-opportunity.enum';
import { ROADMAP_LIST_DEFAULTS } from '../constants/product-roadmap.constants';

/** A row as projected by listOpportunities — the entity plus three computed columns. */
export interface RoadmapOpportunityRow extends RoadmapOpportunity {
  priorityScore: number;
  myCoins: number;
  commentCount: number;
  /**
   * The owner name to SHOW: the linked Ally user's current name, falling back to the legacy
   * `owner` text for rows migrated from the standalone app. Resolved in SQL rather than copied
   * onto the row, so renaming a person in Ally propagates with no sync step.
   */
  ownerDisplay: string | null;
}

export interface ListOpportunitiesOptions {
  /** Caller's Ally users.id — scopes the myCoins projection. */
  userId: number;
  /** Server-computed 'YYYY-MM' — scopes the myCoins projection. */
  periodKey: string;

  search?: string;
  type?: string[];
  stage?: string[];
  productGoal?: string[];
  owner?: string[];
  createdBy?: number[];
  dateFrom?: string;
  dateTo?: string;
  releasedFrom?: string;
  releasedTo?: string;
  priorityMin?: number;
  priorityMax?: number;

  sortBy?: 'priority' | 'createdAt' | 'releasedAt' | 'myCoins' | 'description';
  order?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

export interface ListOpportunitiesResult {
  items: RoadmapOpportunityRow[];
  count: number;
  /**
   * MAX(priorityScore) across every non-deleted opportunity — deliberately NOT the filtered
   * set, so the priority bars keep a stable scale when a filter is applied. This preserves
   * the source's semantics, where max was computed over all opportunities.
   */
  maxScore: number;
}

const SORT_COLUMNS: Record<string, string> = {
  priority: '"priorityScore"',
  createdAt: 'opp."createdAt"',
  releasedAt: 'opp."releasedAt"',
  myCoins: '"myCoins"',
  description: 'opp."description"',
};

@Injectable()
export class RoadmapOpportunityRepository extends Repository<RoadmapOpportunity> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapOpportunity, dataSource.createEntityManager());
  }

  /**
   * The board query. Filtering, sorting and pagination all happen in SQL, and the priority
   * score is a SQL aggregate rather than a stored column.
   *
   * WHY THIS SHAPE — the standalone app computed the score in the browser by summing the
   * entire allocations map inside both the sort comparator and the priority filter, which was
   * O(n log n × users × periods) per keystroke AND required shipping every user's every vote
   * to every client (a privacy leak as much as a performance one). It therefore could not
   * paginate at all: sorting by priority needed every row locally.
   *
   * A denormalised counter column was rejected — see the note on RoadmapOpportunity. If this
   * ever needs to go faster, the next step is a MATERIALIZED VIEW refreshed CONCURRENTLY,
   * never a counter, because a matview can be rebuilt from truth.
   *
   * Backed by idx_roadmap_allocations_opportunity.
   */
  async listOpportunities(
    options: ListOpportunitiesOptions,
  ): Promise<ListOpportunitiesResult> {
    const {
      userId,
      periodKey,
      sortBy = 'priority',
      order = 'DESC',
      limit = ROADMAP_LIST_DEFAULTS.LIMIT,
      offset = 0,
    } = options;

    const qb = this.createQueryBuilder('opp')
      .select('opp.*')
      .addSelect('COALESCE(alloc.score, 0)::int', 'priorityScore')
      .addSelect('COALESCE(mine.coins, 0)::int', 'myCoins')
      .addSelect('COALESCE(cmt.cnt, 0)::int', 'commentCount')
      .addSelect('COALESCE(owner_user.name, opp."owner")', 'ownerDisplay')
      .leftJoin(
        `(SELECT a."opportunityId", SUM(a.coins)::int AS score
            FROM roadmap_allocations a
           GROUP BY a."opportunityId")`,
        'alloc',
        'alloc."opportunityId" = opp.id',
      )
      .leftJoin('users', 'owner_user', 'owner_user.id = opp."ownerUserId"')
      .leftJoin(
        'roadmap_allocations',
        'mine',
        'mine."opportunityId" = opp.id AND mine."userId" = :userId AND mine."periodKey" = :periodKey',
        { userId, periodKey },
      )
      .leftJoin(
        `(SELECT c."opportunityId", COUNT(*) AS cnt
            FROM roadmap_opportunity_comments c
           WHERE c."deletedAt" IS NULL
           GROUP BY c."opportunityId")`,
        'cmt',
        'cmt."opportunityId" = opp.id',
      )
      .where('opp."deletedAt" IS NULL');

    this.applyFilters(qb, options);

    // HAVING-style filters on the projected aggregate must go through the raw expression,
    // since "priorityScore" is not a column.
    if (options.priorityMin !== undefined) {
      qb.andWhere('COALESCE(alloc.score, 0) >= :priorityMin', {
        priorityMin: options.priorityMin,
      });
    }
    if (options.priorityMax !== undefined) {
      qb.andWhere('COALESCE(alloc.score, 0) <= :priorityMax', {
        priorityMax: options.priorityMax,
      });
    }

    const count = await qb.getCount();

    const sortColumn = SORT_COLUMNS[sortBy] ?? SORT_COLUMNS.priority;
    const items = await qb
      .orderBy(sortColumn, order, 'NULLS LAST')
      // Deterministic tiebreak, so pagination cannot repeat or skip a row when many
      // opportunities share a score (most of them have a score of 0).
      .addOrderBy('opp."createdAt"', 'DESC')
      .addOrderBy('opp.id', 'ASC')
      .limit(Math.min(limit, ROADMAP_LIST_DEFAULTS.MAX_LIMIT))
      .offset(offset)
      .getRawMany<RoadmapOpportunityRow>();

    return { items, count, maxScore: await this.getMaxScore() };
  }

  /** Unfiltered MAX(priorityScore) — see ListOpportunitiesResult.maxScore. */
  async getMaxScore(): Promise<number> {
    const [row] = await this.dataSource.query<{ max: string | null }[]>(
      `SELECT COALESCE(MAX(score), 0) AS max
         FROM (SELECT a."opportunityId", SUM(a.coins) AS score
                 FROM roadmap_allocations a
                 JOIN roadmap_opportunities o ON o.id = a."opportunityId"
                WHERE o."deletedAt" IS NULL
                GROUP BY a."opportunityId") s`,
    );
    return Number(row?.max ?? 0);
  }

  /** Same projection as the list query, for one opportunity (the deep-link cold load). */
  async findOneWithScore(
    id: string,
    userId: number,
    periodKey: string,
  ): Promise<RoadmapOpportunityRow | null> {
    const rows = await this.dataSource.query<RoadmapOpportunityRow[]>(
      `SELECT opp.*,
              COALESCE((SELECT SUM(a.coins)::int FROM roadmap_allocations a
                         WHERE a."opportunityId" = opp.id), 0)               AS "priorityScore",
              COALESCE((SELECT a.coins FROM roadmap_allocations a
                         WHERE a."opportunityId" = opp.id
                           AND a."userId" = $2 AND a."periodKey" = $3), 0)   AS "myCoins",
              COALESCE((SELECT COUNT(*)::int FROM roadmap_opportunity_comments c
                         WHERE c."opportunityId" = opp.id
                           AND c."deletedAt" IS NULL), 0)                    AS "commentCount",
              COALESCE(owner_user.name, opp."owner")                         AS "ownerDisplay"
         FROM roadmap_opportunities opp
         LEFT JOIN users owner_user ON owner_user.id = opp."ownerUserId"
        WHERE opp.id = $1 AND opp."deletedAt" IS NULL`,
      [id, userId, periodKey],
    );
    return rows[0] ?? null;
  }

  /** Distinct filter options, so the UI's facets survive server-side pagination. */
  async getFacets(): Promise<{
    createdBy: number[];
    goals: string[];
    owners: string[];
  }> {
    const rows = await this.dataSource.query<
      { createdBy: number; productGoal: string; owner: string | null }[]
    >(
      // The owner facet must use the RESOLVED name, or a reassigned opportunity would advertise a
      // filter value ("Sandeep Malhotra") that no longer matches any row.
      `SELECT DISTINCT o."createdBy",
                       o."productGoal",
                       COALESCE(u.name, o."owner") AS "owner"
         FROM roadmap_opportunities o
         LEFT JOIN users u ON u.id = o."ownerUserId"
        WHERE o."deletedAt" IS NULL`,
    );
    return {
      createdBy: [...new Set(rows.map((r) => r.createdBy))],
      goals: [...new Set(rows.map((r) => r.productGoal))].sort(),
      owners: [
        ...new Set(rows.map((r) => r.owner).filter((o): o is string => !!o)),
      ].sort(),
    };
  }

  /**
   * The Weaviate reconciliation queue: rows whose vector is missing or stale, bounded by
   * attempt count so a permanently-failing row cannot be retried forever.
   */
  async findNeedingEmbedding(
    limit: number,
    maxAttempts = 5,
  ): Promise<RoadmapOpportunity[]> {
    return this.createQueryBuilder('opp')
      .where('opp."deletedAt" IS NULL')
      .andWhere('opp."embeddingStatus" != :success', {
        success: RoadmapEmbeddingStatus.SUCCESS,
      })
      .andWhere('opp."embeddingAttempts" < :maxAttempts', { maxAttempts })
      .orderBy('opp."createdAt"', 'ASC')
      .limit(limit)
      .getMany();
  }

  private applyFilters(
    qb: ReturnType<RoadmapOpportunityRepository['createQueryBuilder']>,
    o: ListOpportunitiesOptions,
  ): void {
    if (o.search?.trim()) {
      qb.andWhere('opp."description" ILIKE :search', {
        search: `%${o.search.trim()}%`,
      });
    }
    if (o.type?.length)
      qb.andWhere('opp."type" IN (:...type)', { type: o.type });
    if (o.stage?.length)
      qb.andWhere('opp."stage" IN (:...stage)', { stage: o.stage });
    if (o.productGoal?.length) {
      qb.andWhere('opp."productGoal" IN (:...productGoal)', {
        productGoal: o.productGoal,
      });
    }
    if (o.owner?.length) {
      // Match either representation. A saved view migrated from the standalone app filters on a
      // NAME, and after reassignment that same person is an `ownerUserId` whose name lives in
      // `users` — checking only one column would make a migrated view stop matching the moment
      // somebody linked the owner to a real account.
      qb.andWhere(
        '(opp."owner" IN (:...owner) OR owner_user.name IN (:...owner))',
        { owner: o.owner },
      );
    }
    if (o.createdBy?.length) {
      qb.andWhere('opp."createdBy" IN (:...createdBy)', {
        createdBy: o.createdBy,
      });
    }
    if (o.dateFrom)
      qb.andWhere('opp."createdAt" >= :dateFrom', { dateFrom: o.dateFrom });
    if (o.dateTo)
      qb.andWhere('opp."createdAt" <= :dateTo', { dateTo: o.dateTo });
    if (o.releasedFrom) {
      qb.andWhere('opp."releasedAt" >= :releasedFrom', {
        releasedFrom: o.releasedFrom,
      });
    }
    if (o.releasedTo) {
      qb.andWhere('opp."releasedAt" <= :releasedTo', {
        releasedTo: o.releasedTo,
      });
    }
  }
}

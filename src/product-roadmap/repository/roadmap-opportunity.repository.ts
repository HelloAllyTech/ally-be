import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { RoadmapEmbeddingStatus } from '../enum/roadmap-opportunity.enum';
import {
  ROADMAP_BOARD_DEFAULTS,
  ROADMAP_LIST_DEFAULTS,
} from '../constants/product-roadmap.constants';

/** A row as projected by listOpportunities — the entity plus three computed columns. */
export interface RoadmapOpportunityRow extends RoadmapOpportunity {
  priorityScore: number;
  myVotes: number;
  commentCount: number;
  /**
   * The owner name to SHOW: the linked Ally user's current name, falling back to the legacy
   * `owner` text for rows migrated from the standalone app. Resolved in SQL rather than copied
   * onto the row, so renaming a person in Ally propagates with no sync step.
   */
  ownerDisplay: string | null;
  /**
   * Position in the queue (New / Prioritised / In development) by total votes, 1-based and
   * unique. NULL for anything outside those stages. See QUEUE_RANK_SQL.
   */
  queueRank: number | null;
}

/** A board row: the list projection plus the lane it belongs to, resolved in SQL. */
export interface RoadmapBoardRow extends RoadmapOpportunityRow {
  /** The lane this row belongs to under the requested grouping. Null is the catch-all lane. */
  laneKey: string | null;
  effectiveMonth: string | null;
}

/**
 * The lane a card belongs to, in SQL.
 *
 * MUST stay equivalent to effectiveMonthOf() in roadmap-month.util.ts — that one serves the
 * write path and the API response, this one groups and windows the read. They are duplicated
 * rather than unified because the alternative is a generated column or a view, and either would
 * put the rule somewhere `migration:generate` can silently rewrite it.
 *
 * to_char on a `timestamp without time zone` reads the stored value with no conversion, which is
 * what makes this agree with currentPeriodKey(): both end up on the UTC month.
 */
import { RoadmapBoardGroupBy } from '../enum/roadmap-opportunity.enum';

const EFFECTIVE_MONTH_SQL = `CASE
  WHEN opp."stage" = 'released' AND opp."releasedAt" IS NOT NULL
    THEN to_char(opp."releasedAt", 'YYYY-MM')
  ELSE opp."plannedMonth"
END`;

/**
 * The lane key, per grouping. One map so the select, the ORDER BY, the GROUP BY of the totals
 * query and the move endpoint's destination predicate all read the same expression — four copies
 * of "which lane is this card in" is how a board starts disagreeing with its own counts.
 *
 * Every value here is a literal, never interpolated from a request: `groupBy` is validated
 * against RoadmapBoardGroupBy by the DTO, and this is the only place a column name is chosen.
 */
const LANE_KEY_SQL: Record<RoadmapBoardGroupBy, string> = {
  [RoadmapBoardGroupBy.MONTH]: EFFECTIVE_MONTH_SQL,
  [RoadmapBoardGroupBy.STAGE]: 'opp."stage"',
  [RoadmapBoardGroupBy.PRODUCT_GOAL]: 'opp."productGoal"',
  [RoadmapBoardGroupBy.OWNER]: 'opp."owner"',
};

export interface ListOpportunitiesOptions {
  /** Caller's Ally users.id — scopes the myVotes projection. */
  userId: number;
  /** Server-computed 'YYYY-MM' — scopes the myVotes projection. */
  periodKey: string;

  search?: string;
  type?: string[];
  stage?: string[];
  /** Who filed it — 'staff' or 'consumer'. Admin-side filtering only, see the entity docblock. */
  source?: string[];
  productGoal?: string[];
  owner?: string[];
  createdBy?: number[];
  dateFrom?: string;
  dateTo?: string;
  releasedFrom?: string;
  releasedTo?: string;
  priorityMin?: number;
  priorityMax?: number;

  sortBy?: 'priority' | 'createdAt' | 'releasedAt' | 'myVotes' | 'description';
  order?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

export interface ListBoardOptions extends Omit<
  ListOpportunitiesOptions,
  'sortBy' | 'order' | 'limit' | 'offset'
> {
  /**
   * Inclusive month window, 'YYYY-MM'. Resolved by the service, never defaulted here.
   * Applied ONLY when grouping by month — see listBoard.
   */
  from: string;
  to: string;
  /** Defaults to MONTH, which is the board this started as. */
  groupBy?: RoadmapBoardGroupBy;
}

export interface ListBoardResult {
  rows: RoadmapBoardRow[];
  /** Exact card count per lane, keyed by month (null = Unscheduled). */
  totals: Map<string | null, number>;
  maxScore: number;
  /** True when the global row cap bit and some lanes hold fewer rows than their total. */
  truncated: boolean;
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

/**
 * Bugs are not roadmap items any more.
 *
 * A bug reported through the in-app "Report a problem" form still WRITES a
 * `roadmap_opportunities` row — that row is the record of who reported what,
 * with what context, and it is what `bug_findings.reported_bug_id` points at.
 * It is simply never listed here. Bug Hunter's findings table is the one place
 * a bug appears, with its own stage and pipeline status.
 *
 * Applied in `projectedQuery` (and repeated in the handful of raw-SQL reads
 * below) rather than in each caller on purpose: this has to hold for the table,
 * the month board, lane totals, facets, month bounds and the priority scale
 * alike, and a rule each caller opts into is a rule the next caller forgets.
 *
 * Deliberately NOT applied to `findOneWithScore`: the deep-link path has to be
 * able to recognise a bug id and send the reader to Bug Hunter, which it cannot
 * do if the row reads as missing. See RoadmapOpportunityService.findOne.
 */
const EXCLUDE_BUGS_SQL = `opp."type" <> 'bug'`;

/**
 * The queue rank: a card's position in THE QUEUE, computed at read time.
 *
 * ## Why derived and not stored
 *
 * The rank is a pure function of (total votes, stage) across the whole queue, so any single
 * opportunity's rank changes when ANOTHER one is voted on or moves stage. A stored column would
 * therefore need recomputing on every vote, every stage change, every create, delete,
 * split and merge — six write paths, each able to leave the whole table stale by forgetting one.
 * Computed here it is correct by construction, and "refresh the ranks when a stage changes"
 * needs no refresh mechanism: the next read already reflects it.
 *
 * ## Ranked over the QUEUE, not over the caller's filters
 *
 * The window sits in its own subquery, deliberately NOT sharing the outer query's WHERE clause.
 * A card's rank must not change because someone typed in the search box — #7 is #7 whether you
 * are looking at all 159 or the three that match "scribe". This is the whole reason it cannot be
 * a `RANK() OVER ()` bolted onto the main query.
 *
 * ## ROW_NUMBER, not RANK
 *
 * No two cards may share a rank. The ordering carries the same deterministic tiebreak the list
 * query uses (`createdAt DESC, id ASC`), so there are no ties to share and ROW_NUMBER states
 * that plainly — RANK would leave gaps if the tiebreak were ever dropped.
 *
 * NULL for anything outside the queue: released and archived rows are not in the population, so
 * they have no position in it, and null is what "no rank" looks like rather than 0.
 */
const QUEUE_RANK_SQL = `(
  SELECT q.id,
         ROW_NUMBER() OVER (
           ORDER BY COALESCE(qa.score, 0) DESC, q."createdAt" DESC, q.id ASC
         )::int AS rank
    FROM roadmap_opportunities q
    LEFT JOIN (SELECT a."opportunityId", SUM(a.votes)::int AS score
                 FROM roadmap_allocations a
                GROUP BY a."opportunityId") qa
           ON qa."opportunityId" = q.id
   WHERE q."deletedAt" IS NULL
     AND q."type" <> 'bug'
     AND q."stage" IN ('new', 'prioritised', 'under_development')
)`;

const SORT_COLUMNS: Record<string, string> = {
  priority: '"priorityScore"',
  createdAt: 'opp."createdAt"',
  releasedAt: 'opp."releasedAt"',
  myVotes: '"myVotes"',
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

    const qb = this.projectedQuery(userId, periodKey);
    this.applyFilters(qb, options);

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

  /**
   * The month board read: every card in the requested month window, plus everything unscheduled.
   *
   * WHY NO OFFSET. The table paginates by offset because a flat list can be read in pages. A
   * lane cannot: filling the first 50 rows of an offset window would stuff January and leave
   * February through May looking like nobody has planned anything. So the board bounds by MONTH
   * (a small, meaningful window the user steps through) and takes a global row cap purely as a
   * safety net.
   *
   * Ordering puts unscheduled FIRST (NULLS FIRST) on purpose: it is the lane people drag out of,
   * so if the row cap ever bites it must bite a future month rather than the backlog. Truncation
   * is reported, never swallowed — lane totals come from a separate exact aggregate, so a capped
   * lane still knows how many cards it is hiding.
   *
   * Backed by idx_roadmap_opps_month_board.
   */
  async listBoard(options: ListBoardOptions): Promise<ListBoardResult> {
    const { userId, periodKey, from, to } = options;
    const groupBy = options.groupBy ?? RoadmapBoardGroupBy.MONTH;
    const laneKey = LANE_KEY_SQL[groupBy];
    const isMonth = groupBy === RoadmapBoardGroupBy.MONTH;

    const qb = this.projectedQuery(userId, periodKey);
    this.applyFilters(qb, options);
    // The window is a MONTH concept. Applying it to a stage or owner board would silently drop
    // every card with no planned month — which is most of them — from lanes that have nothing
    // to do with dates.
    if (isMonth) this.applyMonthWindow(qb, from, to);

    const ordered = qb
      .addSelect(laneKey, 'laneKey')
      .addSelect(EFFECTIVE_MONTH_SQL, 'effectiveMonth')
      .orderBy(laneKey, 'ASC', 'NULLS FIRST');

    // boardPosition is the MONTH board's hand-ordering and means nothing in the other
    // groupings — one column cannot hold four independent orders. There, priority (the vote
    // total) is the order, which is the ranking the whole board exists to express; a second
    // hand-ordering per grouping would compete with it.
    if (isMonth) ordered.addOrderBy('opp."boardPosition"', 'ASC');

    const rows = await ordered
      // Falls through to votes while a lane has never been hand-ordered — this is what lets
      // boardPosition ship with DEFAULT 0 and no backfill and still look sorted on day one.
      .addOrderBy('"priorityScore"', 'DESC')
      .addOrderBy('opp."createdAt"', 'DESC')
      .addOrderBy('opp.id', 'ASC')
      .limit(ROADMAP_BOARD_DEFAULTS.MAX_ROWS + 1)
      .getRawMany<RoadmapBoardRow>();

    const truncated = rows.length > ROADMAP_BOARD_DEFAULTS.MAX_ROWS;
    if (truncated) rows.length = ROADMAP_BOARD_DEFAULTS.MAX_ROWS;

    return {
      rows,
      totals: await this.getLaneTotals(options),
      maxScore: await this.getMaxScore(),
      truncated,
    };
  }

  /**
   * Exact per-lane counts, independent of the row cap and of laneLimit.
   *
   * Separate query rather than counting the fetched rows: a lane that shows 50 of 63 has to know
   * about the 13, and counting what we happened to fetch would make the number agree with the
   * truncation instead of with the database.
   */
  private async getLaneTotals(
    options: ListBoardOptions,
  ): Promise<Map<string | null, number>> {
    const groupBy = options.groupBy ?? RoadmapBoardGroupBy.MONTH;
    const laneKey = LANE_KEY_SQL[groupBy];

    const qb = this.projectedQuery(options.userId, options.periodKey);
    this.applyFilters(qb, options);
    if (groupBy === RoadmapBoardGroupBy.MONTH) {
      this.applyMonthWindow(qb, options.from, options.to);
    }

    const rows = await qb
      .select(laneKey, 'lane')
      .addSelect('COUNT(*)::int', 'total')
      .groupBy(laneKey)
      .getRawMany<{ lane: string | null; total: number }>();

    return new Map(rows.map((r) => [r.lane, Number(r.total)]));
  }

  /**
   * Earliest and latest month holding any opportunity at all.
   *
   * Deliberately UNFILTERED, by the same argument as maxScore: this drives whether the window's
   * prev/next arrows are live, and arrows that appeared and vanished as you typed in the search
   * box would be unusable. Unscheduled rows are excluded — they have no month to bound.
   */
  async getMonthBounds(): Promise<{
    earliest: string | null;
    latest: string | null;
  }> {
    const [row] = await this.dataSource.query<
      { earliest: string | null; latest: string | null }[]
    >(
      `SELECT MIN(m) AS earliest, MAX(m) AS latest
         FROM (SELECT CASE
                        WHEN opp."stage" = 'released' AND opp."releasedAt" IS NOT NULL
                          THEN to_char(opp."releasedAt", 'YYYY-MM')
                        ELSE opp."plannedMonth"
                      END AS m
                 FROM roadmap_opportunities opp
                WHERE opp."deletedAt" IS NULL
                  AND ${EXCLUDE_BUGS_SQL}) s
        WHERE m IS NOT NULL`,
    );
    return { earliest: row?.earliest ?? null, latest: row?.latest ?? null };
  }

  /**
   * Rewrite one lane's manual order in a single statement.
   *
   * `unnest(...) WITH ORDINALITY` turns the client's array into (id, position) pairs, so a
   * 60-card lane is one UPDATE rather than 60 — the taxonomy reorder loops one query per row, but
   * it deals in a handful of goals, not a lane.
   *
   * The lane predicate is what makes a stale drag safe: an id the client thought was here but
   * which somebody else has since moved simply does not match, so it keeps its own lane's
   * position instead of being pulled into this one. `IS NOT DISTINCT FROM` rather than `=` because
   * the Unscheduled lane's month is NULL, and `= NULL` would make every unscheduled reorder a
   * silent no-op.
   *
   * Returns the ids it actually touched, so the caller can report a short list rather than
   * claiming success for cards it did not move.
   *
   * Takes an EntityManager so the move that precedes it shares one transaction: the lane
   * predicate reads the row's month, so committing the move separately would leave a window where
   * the card is in its new lane holding its old lane's position.
   */
  async reorderLane(
    orderedIds: string[],
    month: string | null,
    updatedBy: number,
    manager: EntityManager = this.manager,
  ): Promise<string[]> {
    if (orderedIds.length === 0) return [];

    const result = await manager.query<
      [{ id: string }[], number] | { id: string }[]
    >(
      `UPDATE roadmap_opportunities AS o
          SET "boardPosition" = v.pos,
              "updatedBy"     = $3
         FROM (SELECT id, (ord - 1)::int AS pos
                 FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)) AS v
        WHERE o.id = v.id
          AND o."deletedAt" IS NULL
          AND (CASE
                 WHEN o."stage" = 'released' AND o."releasedAt" IS NOT NULL
                   THEN to_char(o."releasedAt", 'YYYY-MM')
                 ELSE o."plannedMonth"
               END) IS NOT DISTINCT FROM $2
      RETURNING o.id`,
      [orderedIds, month, updatedBy],
    );

    // ⚠️ For an UPDATE ... RETURNING, TypeORM's `query()` resolves to the TUPLE
    // [rows, affectedRowCount], not to rows. Mapping the tuple directly yields
    // [undefined, undefined], so `reordered` came back empty for every successful drag while the
    // positions were in fact written correctly — a silent wrong answer, not a crash. Same trap the
    // copilot's appendMessage hit; normalise before touching it.
    const rows = Array.isArray(result[0])
      ? (result[0] as { id: string }[])
      : (result as { id: string }[]);

    const touched = new Set(rows.map((r) => r.id));
    // Returned in the CLIENT's order, not the database's — the caller is echoing back the order
    // it just applied, and RETURNING order is not defined.
    return orderedIds.filter((id) => touched.has(id));
  }

  private applyMonthWindow(
    qb: ReturnType<RoadmapOpportunityRepository['createQueryBuilder']>,
    from: string,
    to: string,
  ): void {
    // Month keys are 'YYYY-MM', so lexicographic BETWEEN IS chronological — no date casting.
    // Unscheduled rows are always in scope: they are the lane you drag out of.
    qb.andWhere(
      `(${EFFECTIVE_MONTH_SQL} IS NULL OR ${EFFECTIVE_MONTH_SQL} BETWEEN :monthFrom AND :monthTo)`,
      { monthFrom: from, monthTo: to },
    );
  }

  /** Unfiltered MAX(priorityScore) — see ListOpportunitiesResult.maxScore. */
  async getMaxScore(): Promise<number> {
    const [row] = await this.dataSource.query<{ max: string | null }[]>(
      `SELECT COALESCE(MAX(score), 0) AS max
         FROM (SELECT a."opportunityId", SUM(a.votes) AS score
                 FROM roadmap_allocations a
                 JOIN roadmap_opportunities o ON o.id = a."opportunityId"
                WHERE o."deletedAt" IS NULL
                  AND o."type" <> 'bug'
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
              COALESCE((SELECT SUM(a.votes)::int FROM roadmap_allocations a
                         WHERE a."opportunityId" = opp.id), 0)               AS "priorityScore",
              COALESCE((SELECT a.votes FROM roadmap_allocations a
                         WHERE a."opportunityId" = opp.id
                           AND a."userId" = $2 AND a."periodKey" = $3), 0)   AS "myVotes",
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
        WHERE o."deletedAt" IS NULL
          AND o."type" <> 'bug'`,
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

  /**
   * The shared projection: the entity plus priorityScore, myVotes, commentCount and the resolved
   * owner name. Extracted so the table and the month board read the SAME columns — a card that
   * showed a different score depending on which layout you were looking at would be worse than
   * either layout being wrong.
   */
  private projectedQuery(
    userId: number,
    periodKey: string,
  ): ReturnType<RoadmapOpportunityRepository['createQueryBuilder']> {
    return this.createQueryBuilder('opp')
      .select('opp.*')
      .addSelect('COALESCE(alloc.score, 0)::int', 'priorityScore')
      .addSelect('COALESCE(mine.votes, 0)::int', 'myVotes')
      .addSelect('COALESCE(cmt.cnt, 0)::int', 'commentCount')
      .addSelect('COALESCE(owner_user.name, opp."owner")', 'ownerDisplay')
      .addSelect('qrank.rank', 'queueRank')
      .leftJoin(
        `(SELECT a."opportunityId", SUM(a.votes)::int AS score
            FROM roadmap_allocations a
           GROUP BY a."opportunityId")`,
        'alloc',
        'alloc."opportunityId" = opp.id',
      )
      .leftJoin('users', 'owner_user', 'owner_user.id = opp."ownerUserId"')
      .leftJoin(QUEUE_RANK_SQL, 'qrank', 'qrank.id = opp.id')
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
      .where('opp."deletedAt" IS NULL')
      .andWhere(EXCLUDE_BUGS_SQL);
  }

  private applyFilters(
    qb: ReturnType<RoadmapOpportunityRepository['createQueryBuilder']>,
    o: ListOpportunitiesOptions,
  ): void {
    if (o.search?.trim()) {
      // Description OR code. A code exists to be quoted and then looked up, so pasting
      // "OPP-0042" into the search box has to find it — a code you cannot search for only
      // half-works. ILIKE on both so the code match is case-insensitive too ("opp-42").
      qb.andWhere(
        '(opp."description" ILIKE :search OR opp."code" ILIKE :search)',
        {
          search: `%${o.search.trim()}%`,
        },
      );
    }
    if (o.type?.length)
      qb.andWhere('opp."type" IN (:...type)', { type: o.type });
    if (o.stage?.length)
      qb.andWhere('opp."stage" IN (:...stage)', { stage: o.stage });
    if (o.source?.length)
      qb.andWhere('opp."source" IN (:...source)', { source: o.source });
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

    // HAVING-style filters on the projected aggregate must go through the raw expression,
    // since "priorityScore" is not a column.
    if (o.priorityMin !== undefined) {
      qb.andWhere('COALESCE(alloc.score, 0) >= :priorityMin', {
        priorityMin: o.priorityMin,
      });
    }
    if (o.priorityMax !== undefined) {
      qb.andWhere('COALESCE(alloc.score, 0) <= :priorityMax', {
        priorityMax: o.priorityMax,
      });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../../product-roadmap/enum/roadmap-opportunity.enum';

/**
 * Label for released work with no owner on it.
 *
 * Deliberately a first-class band rather than a dropped row: those items shipped
 * and their coins were real, so leaving them out would understate every month
 * they appear in and quietly change the total the reader is adding up. It is
 * coloured as context rather than as a person — the absence of an owner, not an
 * owner — the same treatment the usage-levels zero band gets.
 */
export const ROADMAP_DELIVERY_UNASSIGNED_LABEL = 'Unassigned';

/** Label for the tail of owners rolled up past {@link ROADMAP_DELIVERY_MAX_OWNERS}. */
export const ROADMAP_DELIVERY_OTHER_LABEL = 'Other owners';

/**
 * Owners drawn as their own band before the tail becomes "Other owners".
 *
 * Eight is the house ceiling on distinguishable hues; past it a stack is a
 * gradient the reader matches against the legend one band at a time. There are
 * four owners today, so this is a guard rather than something that fires — but
 * the roll-up is ranked on ALL-TIME coins, not on the coins in whatever month or
 * type filter is on screen, so a band never changes membership as the reader
 * moves a control. A band that reshuffles under a filter encodes nothing.
 */
export const ROADMAP_DELIVERY_MAX_OWNERS = 8;

/** One (month, owner, type) cell of released work. */
export interface RoadmapDeliveryRow {
  /** First day of the release month, `yyyy-mm-01`. */
  month: string;
  /** Owner display name, or null when the opportunity has no owner. */
  owner: string | null;
  type: RoadmapOpportunityType;
  /** Opportunities released by that owner, in that month, of that type. */
  opportunities: number;
  /** Their total coins — every voter, every period. */
  coins: number;
}

/** Released work that carries no release date, so it cannot sit on a month axis. */
export interface RoadmapUndatedRow {
  type: RoadmapOpportunityType;
  opportunities: number;
  coins: number;
}

/**
 * Coin-weighted delivery out of the internal product roadmap, for the Analytics
 * → Product management tab.
 *
 * The question: **of the demand our own team voted for, how much did we actually
 * ship, when, and by whom?** A count of released opportunities answers "how many
 * things shipped" but weighs a 3-coin nicety the same as a 90-coin blocker;
 * weighting each released item by its coins makes the bar a measure of demand
 * satisfied rather than of throughput.
 *
 * Coins per opportunity are the board's `priorityScore` — `SUM(coins)` over every
 * voter and every monthly period, exactly as `RoadmapOpportunityRepository`
 * computes it. Same aggregate, same source, so a total here reconciles with the
 * priority bar a reader can go and look at on the roadmap board. Note the coins
 * are NOT restricted to the release month: an opportunity accumulates backing
 * over the months it waits, and it is that whole accumulated demand that got
 * satisfied when it shipped.
 *
 * Two properties of the source data shape everything downstream:
 *
 *  - **`releasedAt` is sparse.** It is stamped only on the TRANSITION into
 *    `released` and was never backfilled (see the entity), so a large share of
 *    released rows carry no date. Those rows are separated out by
 *    {@link getUndatedReleased} and reported as an explicit residual instead of
 *    being dated from `updatedAt` — a proxy date would put real work in months it
 *    did not ship in, and nothing on the chart would show that it had happened.
 *  - **The roadmap is platform-global.** These tables extend
 *    `BaseWithoutTenantEntity` and carry no `tenant_id`: it is Ally's own
 *    backlog, not customer data. So there is no tenant to scope to and no
 *    `excludeTestTenants` to apply, unlike every sibling repository here.
 *
 * Conventions follow the siblings: `DataSource` raw SQL over tables BY NAME (no
 * entity repos), quoted camelCase identifiers, dates out as `yyyy-mm-dd`, counts
 * `::int` and re-parsed defensively. `releasedAt` is a tz-naive `timestamp`, so
 * `date_trunc('month', ...)` is pure calendar maths and its keys line up with the
 * UTC axis the service generates regardless of the Node process timezone.
 */
@Injectable()
export class RoadmapDeliveryAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Coins per opportunity, as a CTE both queries below share.
   *
   * Kept as a plain aggregate over `roadmap_allocations` rather than anything
   * cached: the roadmap module made the same call deliberately, and the reason
   * holds here too — a stored counter is a second truth that drifts, and coin
   * volumes are small.
   *
   * There is no `deletedAt` on allocations by design (setting coins to 0 deletes
   * the row), so every row in here is live.
   */
  private readonly scoresCte = `
      scores AS (
        SELECT a."opportunityId" AS opportunity_id,
               SUM(a.coins)::int AS coins
        FROM roadmap_allocations a
        GROUP BY a."opportunityId"
      )`;

  /**
   * Released opportunities that HAVE a release date, as (month, owner, type)
   * cells over all of history.
   *
   * All-time and un-windowed on purpose: the roadmap is a slow-moving log where a
   * quarter can hold a handful of releases, so a 30-day window would draw one bar
   * and a 12-month one would silently hide the years before it. The axis the
   * service builds runs from the first dated release to today.
   *
   * The owner is `ownerUserId`'s current Ally name where the row has been linked
   * to an account, falling back to the legacy free-text `owner` string for the
   * migrated rows that never were. Reading the live name means an owner who
   * changes their name does not split into two bands; the fallback means the
   * pre-link history is not thrown away. `LEFT JOIN` throughout, so an
   * opportunity nobody voted for still counts as a release with zero coins.
   */
  async getDatedReleased(): Promise<RoadmapDeliveryRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH ${this.scoresCte}
      SELECT
        to_char(date_trunc('month', o."releasedAt"), 'YYYY-MM-DD') AS "month",
        COALESCE(owner_user.name, o."owner")                       AS "owner",
        o."type"                                                   AS "type",
        COUNT(*)::int                                              AS "opportunities",
        COALESCE(SUM(s.coins), 0)::int                             AS "coins"
      FROM roadmap_opportunities o
      LEFT JOIN scores s         ON s.opportunity_id = o.id
      LEFT JOIN users owner_user ON owner_user.id = o."ownerUserId"
      WHERE o."deletedAt" IS NULL
        AND o.stage = $1
        AND o."releasedAt" IS NOT NULL
      GROUP BY date_trunc('month', o."releasedAt"),
               COALESCE(owner_user.name, o."owner"),
               o."type"
      ORDER BY date_trunc('month', o."releasedAt") ASC
      `,
      [RoadmapOpportunityStage.RELEASED],
    );

    return rows.map((r: Record<string, unknown>) => ({
      month: r.month as string,
      // Trimmed and emptied to null so a legacy owner string of whitespace lands
      // in the Unassigned band rather than opening a band with a blank label.
      owner: (r.owner as string | null)?.trim() || null,
      type: r.type as RoadmapOpportunityType,
      opportunities: Number(r.opportunities) || 0,
      coins: Number(r.coins) || 0,
    }));
  }

  /**
   * Released opportunities with NO release date — the residual the chart cannot
   * plot.
   *
   * Counted here rather than derived on the client from a grand total, because
   * the client only ever receives the plotted months and so has no way to know
   * what is missing from them. This is the number that makes the chart honest
   * about its own coverage; it is not broken down by owner, since the question it
   * answers is "how much is not on this axis", not "whose".
   */
  async getUndatedReleased(): Promise<RoadmapUndatedRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH ${this.scoresCte}
      SELECT
        o."type"                       AS "type",
        COUNT(*)::int                  AS "opportunities",
        COALESCE(SUM(s.coins), 0)::int AS "coins"
      FROM roadmap_opportunities o
      LEFT JOIN scores s ON s.opportunity_id = o.id
      WHERE o."deletedAt" IS NULL
        AND o.stage = $1
        AND o."releasedAt" IS NULL
      GROUP BY o."type"
      `,
      [RoadmapOpportunityStage.RELEASED],
    );

    return rows.map((r: Record<string, unknown>) => ({
      type: r.type as RoadmapOpportunityType,
      opportunities: Number(r.opportunities) || 0,
      coins: Number(r.coins) || 0,
    }));
  }
}

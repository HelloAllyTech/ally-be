import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import {
  RoadmapBoardRow,
  RoadmapOpportunityRepository,
} from '../repository/roadmap-opportunity.repository';
import {
  MonthBoardQueryDto,
  MoveOpportunityDto,
} from '../dto/roadmap-opportunity.dto';
import {
  BoardLaneDto,
  MonthBoardMoveResponseDto,
  MonthBoardResponseDto,
} from '../dto/roadmap-response.dto';
import { ROADMAP_BOARD_DEFAULTS } from '../constants/product-roadmap.constants';
import { currentPeriodKey } from '../util/roadmap-period.util';
import {
  effectiveMonthOf,
  isMonthPinned,
  isValidMonthKey,
  monthKeyRange,
  shiftMonthKey,
} from '../util/roadmap-month.util';
import {
  RoadmapBoardGroupBy,
  RoadmapOpportunityStage,
} from '../enum/roadmap-opportunity.enum';
import { RoadmapStrategyGoalService } from './roadmap-strategy-goal.service';
import { RoadmapTaxonomyService } from './roadmap-taxonomy.service';
import { RoadmapOpportunityService } from './roadmap-opportunity.service';
import { RoadmapNotificationService } from './roadmap-notification.service';

/**
 * The month board: the same opportunities and bugs as the table, grouped into the month they are
 * planned for, and hand-orderable within a month.
 *
 * SEPARATE SERVICE from RoadmapOpportunityService rather than three more methods on it. The board
 * is a distinct read model — it windows by month instead of paginating, it groups, and it owns a
 * write (reorder) that touches many rows at once. Bolting that onto the service that also owns
 * create/update/delete/facets is how a 400-line service becomes an 800-line one.
 *
 * Response mapping is DELEGATED to RoadmapOpportunityService.toResponseList, not reimplemented:
 * an opportunity must serialise identically whichever layout asked for it.
 */
@Injectable()
export class RoadmapBoardService {
  constructor(
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly notifications: RoadmapNotificationService,
    private readonly strategyGoalService: RoadmapStrategyGoalService,
    // Lane keys for the goal and owner boards, and the validation behind a drop into one.
    private readonly taxonomyService: RoadmapTaxonomyService,
  ) {}

  async getBoard(
    userId: number,
    query: MonthBoardQueryDto,
  ): Promise<MonthBoardResponseDto> {
    const periodKey = currentPeriodKey();
    const groupBy = query.groupBy ?? RoadmapBoardGroupBy.MONTH;
    const { from, to } = this.resolveWindow(query);
    const laneLimit = Math.min(
      query.laneLimit ?? ROADMAP_BOARD_DEFAULTS.LANE_LIMIT,
      ROADMAP_BOARD_DEFAULTS.MAX_LANE_LIMIT,
    );

    const { rows, totals, maxScore, truncated } =
      await this.opportunityRepository.listBoard({
        ...query,
        groupBy,
        userId,
        periodKey,
        from,
        to,
        rank: await this.strategyGoalService.getRankContext(),
      });

    // ONE mapping pass over every row, then bucket the mapped DTOs. Mapping per lane would
    // resolve the same creators once per lane instead of once per board.
    const mapped = await this.opportunityService.toResponseList(rows);
    const byLane = this.bucketByLane(rows, mapped);

    return {
      groupBy,
      lanes: (await this.laneKeysFor(groupBy, from, to)).map((key) =>
        this.lane(key, byLane.get(key) ?? [], totals, laneLimit),
      ),
      bounds: await this.opportunityRepository.getMonthBounds(),
      from,
      to,
      maxScore,
      periodKey,
      truncated,
    };
  }

  /**
   * Drop a card into a lane.
   *
   * WHICH FIELD THIS WRITES depends on the grouping, and that is the whole design: a lane is a
   * value of some column, so dropping a card into it sets that column. Month writes
   * `plannedMonth` (and rewrites the lane's hand-ordering); stage, goal and owner write theirs
   * via moveByField. All four are edits the drawer already offers — the board is a faster way to
   * make them, not a new power.
   *
   * For the month case the change and the reorder are ONE transaction: the destination-lane predicate in
   * reorderLane is evaluated against the row's month, so a move committed separately from its
   * reorder would leave a window where the card is in the new lane at whatever position it held
   * in the old one — visibly landing in the wrong place and then jumping.
   */
  async move(
    userId: number,
    dto: MoveOpportunityDto,
  ): Promise<MonthBoardMoveResponseDto> {
    const groupBy = dto.groupBy ?? RoadmapBoardGroupBy.MONTH;

    // The one grouping whose lanes are NOT a writable column: who filed an opportunity is a
    // historical fact, and every other lane move is "a faster way to make an edit the drawer
    // already offers" (see the docblock above). Refused before touching the row, so the client
    // gets the explanation rather than a mystery 500 from moveByField's exhaustive switch.
    if (groupBy === RoadmapBoardGroupBy.CREATED_BY) {
      throw new UnprocessableEntityException(
        'Who filed an opportunity cannot be changed, so cards on the filed-by board cannot be moved between lanes.',
      );
    }

    const existing = await this.opportunityRepository.findOne({
      where: { id: dto.opportunityId },
    });
    if (!existing) {
      throw new NotFoundException(`Opportunity ${dto.opportunityId} not found`);
    }

    if (groupBy !== RoadmapBoardGroupBy.MONTH) {
      return this.moveByField(userId, existing, groupBy, dto.lane);
    }

    if (dto.lane !== null && !isValidMonthKey(dto.lane)) {
      throw new UnprocessableEntityException(
        `"${dto.lane}" is not a month. Expected 'YYYY-MM'.`,
      );
    }

    const pinnedMonth = isMonthPinned(existing.stage, existing.releasedAt)
      ? effectiveMonthOf(existing.stage, existing.releasedAt, null)
      : null;

    // A shipped card may be reordered within its own release-month lane, but not moved out of
    // it. Checked before the transaction so the caller gets the explanation rather than a
    // reorder that silently skipped the one card it was asked to move.
    if (pinnedMonth !== null && dto.lane !== pinnedMonth) {
      throw new UnprocessableEntityException(
        `This opportunity shipped in ${pinnedMonth}, so it stays in that month. Change its stage first to plan it into a different one.`,
      );
    }

    let reordered: string[] = [];
    await this.opportunityRepository.manager.transaction(async (manager) => {
      if (pinnedMonth === null && existing.plannedMonth !== dto.lane) {
        await manager.update(RoadmapOpportunity, dto.opportunityId, {
          plannedMonth: dto.lane,
          updatedBy: userId,
        });
      }

      reordered = await this.opportunityRepository.reorderLane(
        dto.orderedIds ?? [],
        dto.lane,
        userId,
        manager,
      );
    });

    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: userId,
      reason: 'board',
    });

    return {
      opportunityId: dto.opportunityId,
      plannedMonth:
        pinnedMonth === null ? dto.lane : (existing.plannedMonth ?? null),
      effectiveMonth: pinnedMonth ?? dto.lane,
      reordered,
    };
  }

  /**
   * The stage / goal / owner drop: one column write, no reordering.
   *
   * No transaction and no `reorderLane`, because these boards have no hand-ordering to rewrite —
   * they are ordered by priority, so a card lands where its votes put it. That is also why the
   * response's `reordered` comes back empty rather than echoing the ids the client sent: nothing
   * was reordered, and echoing them would tell the client an order it invented was persisted.
   */
  private async moveByField(
    userId: number,
    existing: RoadmapOpportunity,
    groupBy: RoadmapBoardGroupBy,
    lane: string | null,
  ): Promise<MonthBoardMoveResponseDto> {
    if (groupBy === RoadmapBoardGroupBy.STAGE) {
      if (
        lane === null ||
        !Object.values(RoadmapOpportunityStage).includes(
          lane as RoadmapOpportunityStage,
        )
      ) {
        throw new UnprocessableEntityException(
          `"${lane}" is not a stage. Expected one of: ${Object.values(
            RoadmapOpportunityStage,
          ).join(', ')}.`,
        );
      }
      // Routed through the opportunity service, NOT a bare update. Moving a card into the
      // Released lane is a stage TRANSITION, and the releasedAt stamp (once, never re-stamped)
      // plus the re-index and the realtime notify all belong to that one path. Writing the
      // column here would be a second, quieter way to release something.
      await this.opportunityService.update(userId, existing.id, {
        stage: lane as RoadmapOpportunityStage,
      });
      return this.fieldMoveResponse(existing);
    }

    const patch: Partial<RoadmapOpportunity> = { updatedBy: userId };
    if (groupBy === RoadmapBoardGroupBy.PRODUCT_GOAL) {
      if (lane === null) {
        // `productGoal` is NOT NULL. The "No goal" lane exists only because migrated rows can
        // sit outside the taxonomy — it is somewhere to drag OUT of, not into.
        throw new UnprocessableEntityException(
          'An opportunity must have a product goal. Drag it to a goal lane instead.',
        );
      }
      await this.assertKnown(
        lane,
        (await this.taxonomyService.listGoals()).map((g) => g.name),
        'product goal',
      );
      patch.productGoal = lane;
    } else {
      if (lane !== null) {
        await this.assertKnown(
          lane,
          (await this.taxonomyService.listOwners()).map((o) => o.name),
          'owner',
        );
      }
      // Owner IS nullable, so the catch-all lane is a legal destination: dropping a card there
      // unassigns it, which is something people actually want to do.
      patch.owner = lane;
    }

    await this.opportunityRepository.update(existing.id, patch);
    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: userId,
      reason: 'board',
    });
    return this.fieldMoveResponse(existing);
  }

  /**
   * Reject a value the taxonomy does not hold.
   *
   * `productGoal` and `owner` are text foreign keys BY NAME, so an unknown value is an FK
   * violation — a 500 landing several frames after the drag with nothing on screen to connect it
   * to. Checked against the live list, so a goal renamed in another tab fails as a sentence.
   */
  private async assertKnown(
    value: string,
    known: string[],
    label: string,
  ): Promise<void> {
    if (known.includes(value)) return;
    throw new UnprocessableEntityException(
      `"${value}" is not a ${label} that exists. It may have been renamed or deleted — reload the board.`,
    );
  }

  /**
   * A field move changes nothing about months, so the month fields echo what the row already
   * held. Reported rather than omitted so one response type covers every grouping.
   */
  private fieldMoveResponse(
    existing: RoadmapOpportunity,
  ): MonthBoardMoveResponseDto {
    return {
      opportunityId: existing.id,
      plannedMonth: existing.plannedMonth ?? null,
      effectiveMonth: effectiveMonthOf(
        existing.stage,
        existing.releasedAt,
        existing.plannedMonth,
      ),
      reordered: [],
    };
  }

  /**
   * The window to show. Defaults to one month back and four forward around the CURRENT month —
   * see ROADMAP_BOARD_DEFAULTS for why it is asymmetric.
   *
   * An inverted range (from > to) is clamped to a single month rather than 400'd: it can only
   * arrive from a stale saved view or a hand-typed URL, and a board showing one month is a more
   * useful answer than an error page.
   */
  private resolveWindow(query: MonthBoardQueryDto): {
    from: string;
    to: string;
  } {
    const current = currentPeriodKey();
    const from =
      query.from ??
      shiftMonthKey(current, -ROADMAP_BOARD_DEFAULTS.WINDOW_MONTHS_BACK);
    const to =
      query.to ??
      shiftMonthKey(current, ROADMAP_BOARD_DEFAULTS.WINDOW_MONTHS_FORWARD);
    return from > to ? { from, to: from } : { from, to };
  }

  /**
   * Bucket the mapped DTOs by lane, using the SQL-resolved effectiveMonth from the raw rows.
   *
   * The two arrays are index-aligned because toResponseList maps in order — asserted by the
   * length guard rather than assumed, since a silent misalignment would put cards in the wrong
   * month, which is the one failure this feature cannot afford.
   */
  private bucketByLane(
    rows: RoadmapBoardRow[],
    mapped: Awaited<ReturnType<RoadmapOpportunityService['toResponseList']>>,
  ): Map<string | null, BoardLaneDto['items']> {
    if (rows.length !== mapped.length) {
      throw new Error(
        `Board mapping lost rows: ${rows.length} in, ${mapped.length} out`,
      );
    }

    const byLane = new Map<string | null, BoardLaneDto['items']>();
    rows.forEach((row, index) => {
      const key = row.laneKey ?? null;
      const lane = byLane.get(key);
      if (lane) lane.push(mapped[index]);
      else byLane.set(key, [mapped[index]]);
    });
    return byLane;
  }

  /**
   * Every lane to render, in display order, including the ones holding nothing.
   *
   * Built from the VALUE SET rather than from the rows that came back, for the same reason the
   * month board always renders its whole window: a product goal nobody is working on is a fact
   * worth seeing, and a lane list derived from the results would quietly omit it.
   */
  private async laneKeysFor(
    groupBy: RoadmapBoardGroupBy,
    from: string,
    to: string,
  ): Promise<(string | null)[]> {
    switch (groupBy) {
      case RoadmapBoardGroupBy.MONTH:
        // Unscheduled FIRST: it is the lane people drag out of, and it has been leftmost since
        // this board shipped. Moving it would relocate the one lane everyone already knows.
        return [null, ...monthKeyRange(from, to)];
      case RoadmapBoardGroupBy.STAGE:
        // No catch-all lane: `stage` is NOT NULL with a CHECK, so it could only ever be empty,
        // and offering it as a drop target would invite a write the column refuses.
        return Object.values(RoadmapOpportunityStage);
      case RoadmapBoardGroupBy.PRODUCT_GOAL:
        return [
          ...(await this.taxonomyService.listGoals()).map((g) => g.name),
          null,
        ];
      case RoadmapBoardGroupBy.OWNER:
        return [
          ...(await this.taxonomyService.listOwners()).map((o) => o.name),
          null,
        ];
      case RoadmapBoardGroupBy.CREATED_BY:
        // Keys are user IDS as strings, matching LANE_KEY_SQL's ::text — the frontend owns
        // turning them into names via the same facets.creators it already fetches. No catch-all
        // lane: createdBy is NOT NULL (a deleted account still leaves its id behind).
        return (await this.opportunityRepository.getFacets()).createdBy.map(
          String,
        );
    }
  }

  private lane(
    key: string | null,
    items: BoardLaneDto['items'],
    totals: Map<string | null, number>,
    laneLimit: number,
  ): BoardLaneDto {
    return {
      key,
      items: items.slice(0, laneLimit),
      // The database's count, not items.length — a lane showing 50 of 63 has to know about the 13.
      total: totals.get(key) ?? items.length,
    };
  }
}

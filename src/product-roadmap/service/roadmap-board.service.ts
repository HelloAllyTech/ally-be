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
  MonthBoardMoveResponseDto,
  MonthBoardResponseDto,
  MonthLaneDto,
} from '../dto/roadmap-response.dto';
import { ROADMAP_BOARD_DEFAULTS } from '../constants/product-roadmap.constants';
import { currentPeriodKey } from '../util/roadmap-period.util';
import {
  effectiveMonthOf,
  isMonthPinned,
  monthKeyRange,
  shiftMonthKey,
} from '../util/roadmap-month.util';
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
  ) {}

  async getBoard(
    userId: number,
    query: MonthBoardQueryDto,
  ): Promise<MonthBoardResponseDto> {
    const periodKey = currentPeriodKey();
    const { from, to } = this.resolveWindow(query);
    const laneLimit = Math.min(
      query.laneLimit ?? ROADMAP_BOARD_DEFAULTS.LANE_LIMIT,
      ROADMAP_BOARD_DEFAULTS.MAX_LANE_LIMIT,
    );

    const { rows, totals, maxScore, truncated } =
      await this.opportunityRepository.listBoard({
        ...query,
        userId,
        periodKey,
        from,
        to,
      });

    // ONE mapping pass over every row, then bucket the mapped DTOs. Mapping per lane would
    // resolve the same creators once per lane instead of once per board.
    const mapped = await this.opportunityService.toResponseList(rows);
    const byMonth = this.bucketByMonth(rows, mapped);

    return {
      // Every month in the window, including the empty ones. A gap in a plan is information:
      // collapsing empty lanes would put March next to June and hide that nothing is planned
      // in between.
      months: monthKeyRange(from, to).map((month) =>
        this.lane(month, byMonth.get(month) ?? [], totals, laneLimit),
      ),
      unscheduled: this.lane(null, byMonth.get(null) ?? [], totals, laneLimit),
      bounds: await this.opportunityRepository.getMonthBounds(),
      from,
      to,
      maxScore,
      periodKey,
      truncated,
    };
  }

  /**
   * Drop a card into a lane and rewrite that lane's order.
   *
   * The month change and the reorder are ONE transaction: the destination-lane predicate in
   * reorderLane is evaluated against the row's month, so a move committed separately from its
   * reorder would leave a window where the card is in the new lane at whatever position it held
   * in the old one — visibly landing in the wrong place and then jumping.
   */
  async move(
    userId: number,
    dto: MoveOpportunityDto,
  ): Promise<MonthBoardMoveResponseDto> {
    const existing = await this.opportunityRepository.findOne({
      where: { id: dto.opportunityId },
    });
    if (!existing) {
      throw new NotFoundException(`Opportunity ${dto.opportunityId} not found`);
    }

    const pinnedMonth = isMonthPinned(existing.stage, existing.releasedAt)
      ? effectiveMonthOf(existing.stage, existing.releasedAt, null)
      : null;

    // A shipped card may be reordered within its own release-month lane, but not moved out of
    // it. Checked before the transaction so the caller gets the explanation rather than a
    // reorder that silently skipped the one card it was asked to move.
    if (pinnedMonth !== null && dto.month !== pinnedMonth) {
      throw new UnprocessableEntityException(
        `This opportunity shipped in ${pinnedMonth}, so it stays in that month. Change its stage first to plan it into a different one.`,
      );
    }

    let reordered: string[] = [];
    await this.opportunityRepository.manager.transaction(async (manager) => {
      if (pinnedMonth === null && existing.plannedMonth !== dto.month) {
        await manager.update(RoadmapOpportunity, dto.opportunityId, {
          plannedMonth: dto.month,
          updatedBy: userId,
        });
      }

      reordered = await this.opportunityRepository.reorderLane(
        dto.orderedIds,
        dto.month,
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
        pinnedMonth === null ? dto.month : (existing.plannedMonth ?? null),
      effectiveMonth: pinnedMonth ?? dto.month,
      reordered,
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
  private bucketByMonth(
    rows: RoadmapBoardRow[],
    mapped: Awaited<ReturnType<RoadmapOpportunityService['toResponseList']>>,
  ): Map<string | null, MonthLaneDto['items']> {
    if (rows.length !== mapped.length) {
      throw new Error(
        `Month board mapping lost rows: ${rows.length} in, ${mapped.length} out`,
      );
    }

    const byMonth = new Map<string | null, MonthLaneDto['items']>();
    rows.forEach((row, index) => {
      const month = row.effectiveMonth ?? null;
      const lane = byMonth.get(month);
      if (lane) lane.push(mapped[index]);
      else byMonth.set(month, [mapped[index]]);
    });
    return byMonth;
  }

  private lane(
    month: string | null,
    items: MonthLaneDto['items'],
    totals: Map<string | null, number>,
    laneLimit: number,
  ): MonthLaneDto {
    return {
      month,
      items: items.slice(0, laneLimit),
      // The database's count, not items.length — a lane showing 50 of 63 has to know about the 13.
      total: totals.get(month) ?? items.length,
    };
  }
}

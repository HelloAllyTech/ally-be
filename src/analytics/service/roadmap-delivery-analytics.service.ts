import { Injectable } from '@nestjs/common';
import { RoadmapOpportunityType } from '../../product-roadmap/enum/roadmap-opportunity.enum';
import {
  ROADMAP_DELIVERY_MAX_OWNERS,
  ROADMAP_DELIVERY_OTHER_LABEL,
  ROADMAP_DELIVERY_UNASSIGNED_LABEL,
  RoadmapDeliveryAnalyticsRepository,
  RoadmapDeliveryRow,
} from '../repository/roadmap-delivery-analytics.repository';
import {
  RoadmapDeliveryMonthDto,
  RoadmapDeliveryOwnerDto,
  RoadmapDeliveryResponseDto,
  RoadmapDeliveryTotalsDto,
} from '../dto/roadmap-delivery-analytics.dto';
import {
  addMonths,
  isoDate,
  startOfUtcMonth,
} from '../util/analytics-window.util';

/**
 * Vote-weighted roadmap delivery for the Analytics → Product management tab.
 *
 * Shapes two result sets into one dense monthly axis with a stable owner domain,
 * so the client draws it without doing calendar maths, ranking or roll-ups of its
 * own. The rules doing the work are house data-visualisation rules rather than
 * conveniences:
 *
 *  - **The axis is a real calendar.** Every month from the first dated release to
 *    the current one is present, in order, even where nothing shipped. An axis
 *    assembled from the months that happened to have a release invites the reader
 *    to compare two adjacent bars a year apart. Zero is a measurement here:
 *    "nothing shipped in March" is a fact about March.
 *  - **What cannot be plotted is counted, not dated.** Released work with no
 *    `releasedAt` is returned as an explicit residual instead of being placed
 *    with a proxy date. The plotted total is not the whole history, and the
 *    response says so in numbers the client can print.
 *  - **The current month is provisional.** It is flagged, and — unlike a trend
 *    line, where an unfinished period reads as a fall — it is kept: on a delivery
 *    chart "what have we shipped so far this month" is the reading most worth
 *    having, so the client marks it on the axis rather than dropping it.
 *  - **The owner domain is decided once, on all-time totals.** Rank, stack order,
 *    legend order and the roll-up of the tail all come from the same all-time
 *    ranking, so no band moves, changes colour or changes membership when the
 *    reader switches the type filter.
 */
@Injectable()
export class RoadmapDeliveryAnalyticsService {
  constructor(
    private readonly repository: RoadmapDeliveryAnalyticsRepository,
  ) {}

  async getRoadmapDelivery(): Promise<RoadmapDeliveryResponseDto> {
    const [datedRows, undatedRows] = await Promise.all([
      this.repository.getDatedReleased(),
      this.repository.getUndatedReleased(),
    ]);

    const bandOf = resolveOwnerBands(datedRows);
    const currentMonth = startOfUtcMonth(new Date());
    const currentMonthIso = isoDate(currentMonth);

    // Per (month, band) accumulation. Insertion order is not relied on for
    // anything the reader sees — `owners` below is the one place order is decided.
    const byMonth = new Map<string, Map<string, RoadmapDeliveryTotalsDto>>();
    const plotted = emptyTotals();

    for (const row of datedRows) {
      const bands =
        byMonth.get(row.month) ?? new Map<string, RoadmapDeliveryTotalsDto>();
      byMonth.set(row.month, bands);

      const band = bandOf(row.owner);
      const totals = bands.get(band) ?? emptyTotals();
      bands.set(band, totals);

      addRow(totals, row);
      addRow(plotted, row);
    }

    const owners = orderedOwnerBands(datedRows, bandOf);
    const bandRank = new Map(owners.map((o, i) => [o, i]));

    const months: RoadmapDeliveryMonthDto[] = [];
    for (const month of monthAxis(datedRows, currentMonth)) {
      const bands = byMonth.get(month);
      const monthTotals = emptyTotals();
      const ownerRows: RoadmapDeliveryOwnerDto[] = [];

      for (const [owner, totals] of bands ?? []) {
        ownerRows.push({ owner, ...totals });
        addTotals(monthTotals, totals);
      }
      // Same order in every month, so a band sits at the same height in the stack
      // all the way across the chart.
      ownerRows.sort(
        (a, b) => (bandRank.get(a.owner) ?? 0) - (bandRank.get(b.owner) ?? 0),
      );

      months.push({
        month,
        owners: ownerRows,
        ...monthTotals,
        partial: month === currentMonthIso,
      });
    }

    const undated = emptyTotals();
    for (const row of undatedRows) addRow(undated, row);

    return {
      months,
      owners,
      unassignedOwnerLabel: ROADMAP_DELIVERY_UNASSIGNED_LABEL,
      otherOwnerLabel: ROADMAP_DELIVERY_OTHER_LABEL,
      maxOwners: ROADMAP_DELIVERY_MAX_OWNERS,
      plotted,
      undated,
      currentMonth: currentMonthIso,
      // The roadmap tables carry no tenant, so there is no filter to honour and
      // nothing to declare unscoped — see the DTO.
      scoping: { tenantId: null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}

function emptyTotals(): RoadmapDeliveryTotalsDto {
  return {
    opportunities: 0,
    ideaOpportunities: 0,
    bugOpportunities: 0,
    votes: 0,
    ideaVotes: 0,
    bugVotes: 0,
  };
}

/**
 * Fold one repository row into a totals accumulator.
 *
 * Anything that is not a bug counts as an idea. The column is constrained to the
 * two values by a CHECK, so this is not a silent third bucket waiting to be
 * mislabelled — but it does mean the totals always reconcile
 * (`ideaX + bugX === X`), which is the property the client relies on when it
 * switches the type filter.
 */
function addRow(
  totals: RoadmapDeliveryTotalsDto,
  row: { type: RoadmapOpportunityType; opportunities: number; votes: number },
): void {
  totals.opportunities += row.opportunities;
  totals.votes += row.votes;
  if (row.type === RoadmapOpportunityType.BUG) {
    totals.bugOpportunities += row.opportunities;
    totals.bugVotes += row.votes;
  } else {
    totals.ideaOpportunities += row.opportunities;
    totals.ideaVotes += row.votes;
  }
}

function addTotals(
  into: RoadmapDeliveryTotalsDto,
  from: RoadmapDeliveryTotalsDto,
): void {
  into.opportunities += from.opportunities;
  into.ideaOpportunities += from.ideaOpportunities;
  into.bugOpportunities += from.bugOpportunities;
  into.votes += from.votes;
  into.ideaVotes += from.ideaVotes;
  into.bugVotes += from.bugVotes;
}

/**
 * Map an owner name onto the band it is drawn as: itself, the unassigned label,
 * or the rolled-up tail.
 *
 * The ranking is over ALL-TIME votes across every month and both types, which is
 * what makes the mapping stable — a band decided from the rows currently on
 * screen would change membership every time the reader touched a control, and a
 * band that reshuffles under a filter encodes nothing the reader can read.
 * Ties break on name so the roll-up is deterministic across requests.
 *
 * "Unassigned" never competes for a slot and is never rolled into the tail: it is
 * context rather than a person, and merging the two would hide the fact that some
 * shipped work has no owner at all.
 */
function resolveOwnerBands(
  rows: RoadmapDeliveryRow[],
): (owner: string | null) => string {
  const votesByOwner = new Map<string, number>();
  for (const row of rows) {
    if (row.owner === null) continue;
    votesByOwner.set(row.owner, (votesByOwner.get(row.owner) ?? 0) + row.votes);
  }

  const ranked = [...votesByOwner.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner]) => owner);

  // Roll up only when the tail is worth more than one band: with exactly one
  // owner over the ceiling, "Other owners" would be a grey band naming a single
  // person less clearly than their own name would.
  const named = new Set(
    ranked.length > ROADMAP_DELIVERY_MAX_OWNERS + 1
      ? ranked.slice(0, ROADMAP_DELIVERY_MAX_OWNERS)
      : ranked,
  );

  return (owner: string | null) => {
    if (owner === null) return ROADMAP_DELIVERY_UNASSIGNED_LABEL;
    return named.has(owner) ? owner : ROADMAP_DELIVERY_OTHER_LABEL;
  };
}

/**
 * The owner bands in the order the client draws them: real owners by all-time
 * votes, then the two context bands.
 *
 * Context last means it stacks on top, so the owners below keep a fixed baseline
 * month to month — a grey band at the bottom would shift every owner above it as
 * it grew.
 */
function orderedOwnerBands(
  rows: RoadmapDeliveryRow[],
  bandOf: (owner: string | null) => string,
): string[] {
  const votesByBand = new Map<string, number>();
  for (const row of rows) {
    const band = bandOf(row.owner);
    votesByBand.set(band, (votesByBand.get(band) ?? 0) + row.votes);
  }

  const isContext = (band: string) =>
    band === ROADMAP_DELIVERY_UNASSIGNED_LABEL ||
    band === ROADMAP_DELIVERY_OTHER_LABEL;

  return [...votesByBand.keys()].sort((a, b) => {
    if (isContext(a) !== isContext(b)) return isContext(a) ? 1 : -1;
    // Unassigned before Other among the context bands: a real gap in the data
    // reads ahead of a presentational roll-up.
    if (isContext(a) && isContext(b)) {
      return a === ROADMAP_DELIVERY_UNASSIGNED_LABEL ? -1 : 1;
    }
    return (
      (votesByBand.get(b) ?? 0) - (votesByBand.get(a) ?? 0) ||
      a.localeCompare(b)
    );
  });
}

/**
 * Contiguous `yyyy-mm-01` keys covering every dated release AND the current
 * month.
 *
 * Extended to the latest row rather than stopping at today for one reason: a
 * `releasedAt` in the future is possible (it is a plain timestamp, and split
 * copies it), and a row outside the axis would drop out of the bars while
 * remaining in the `plotted` totals — the two would disagree with nothing on
 * screen explaining why. Extended BACK to the current month too, so a roadmap
 * whose only releases are dated in the future still gets an axis containing today.
 */
function monthAxis(rows: RoadmapDeliveryRow[], currentMonth: Date): string[] {
  if (rows.length === 0) return [];

  let first = currentMonth;
  let last = currentMonth;
  for (const row of rows) {
    const month = parseMonth(row.month);
    if (month < first) first = month;
    if (month > last) last = month;
  }

  const months: string[] = [];
  for (let cur = first; cur <= last; cur = addMonths(cur, 1)) {
    months.push(isoDate(cur));
  }
  return months;
}

/** `yyyy-mm-dd` from the repository back into a UTC month start. */
function parseMonth(month: string): Date {
  return new Date(`${month}T00:00:00.000Z`);
}

import { Injectable } from '@nestjs/common';
import { TrackItemType } from '../../track/type/track.type';
import {
  MIN_TRACK_GROUP_SIZE,
  TrackDropoffAnalyticsRepository,
} from '../repository/track-dropoff-analytics.repository';
import {
  TrackDropoffItemTypeDto,
  TrackDropoffQueryDto,
  TrackDropoffResponseDto,
  TrackDropoffSectionDto,
} from '../dto/track-dropoff-analytics.dto';

/** One decimal is all a completion rate can carry honestly at these sample sizes. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * All-time track drop-off for the Highlights tab.
 *
 * Thin by design — the repository answers the question in three passes. What lives
 * here are the presentation rules that must not be left to a client, because two
 * clients applying them separately is two chances to apply them differently:
 *
 *  - **The category list is fixed and ordered.** All six `TrackItemType` values
 *    are returned, in enum declaration order, whether or not anyone has reached
 *    one. A list assembled from the formats that happen to have data changes
 *    length and order between requests, which moves colours in the legend and
 *    invites the reader to compare two bars that swapped places.
 *  - **A rate over nothing is not zero.** `completionRatePct` is null when
 *    `reached` is 0. Rendering that as 0% would report a format nobody has opened
 *    as a format everyone abandons — the most actionable-looking, most wrong
 *    number on the chart.
 *  - **Below the floor the row stays and the rate goes.** A format or section
 *    reached by fewer than {@link MIN_TRACK_GROUP_SIZE} learners keeps its counts
 *    (a count of people leaks nothing on its own and dropping it would understate
 *    the total) and loses its percentage: "0% completed" over two learners is a
 *    statement about two identifiable people.
 *  - **The floor travels with the data.** The client is told `minGroupSize`
 *    rather than hard-coding a second copy of it.
 */
@Injectable()
export class TrackDropoffAnalyticsService {
  constructor(private readonly repository: TrackDropoffAnalyticsRepository) {}

  async getTrackDropoff(
    query: TrackDropoffQueryDto,
  ): Promise<TrackDropoffResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const [itemTypeRows, sectionRows, summary] = await Promise.all([
      this.repository.getItemTypeProgress(tenantId),
      this.repository.getSectionProgress(tenantId),
      this.repository.getSummary(tenantId),
    ]);

    const byType = new Map(itemTypeRows.map((r) => [r.type, r]));

    // Every format, in enum declaration order — see the class doc comment.
    const itemTypes: TrackDropoffItemTypeDto[] = Object.values(
      TrackItemType,
    ).map((type) => {
      const row = byType.get(type);
      const reached = row?.reached ?? 0;
      const completed = row?.completed ?? 0;
      const learners = row?.learners ?? 0;
      const belowFloor = learners < MIN_TRACK_GROUP_SIZE;
      return {
        type,
        reached,
        completed,
        completionRatePct: rate(completed, reached, belowFloor),
        learners,
        belowFloor,
      };
    });

    const sections: TrackDropoffSectionDto[] = sectionRows.map((r) => {
      const belowFloor = r.learners < MIN_TRACK_GROUP_SIZE;
      return {
        trackId: r.trackId,
        trackTitle: r.trackTitle,
        sectionId: r.sectionId,
        sectionTitle: r.sectionTitle,
        order: r.order,
        reached: r.reached,
        completed: r.completed,
        completionRatePct: rate(r.completed, r.reached, belowFloor),
        // The learner count behind this flag is deliberately not returned: a
        // headcount beside a named section of a named track is close enough to
        // naming the learners in it.
        belowFloor,
      };
    });

    return {
      itemTypes,
      sections,
      summary,
      minGroupSize: MIN_TRACK_GROUP_SIZE,
      // Every figure here resolves to a tenant through the learner who owns the
      // progress row, so unlike AI cost or org counts there is nothing that has
      // to stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * The one place a completion rate is derived, so the two breakdowns cannot end up
 * suppressing on different rules.
 *
 * Null on a zero denominator (undefined, not 0%) and null below the group-size
 * floor (a rate over four learners is a statement about four people).
 */
function rate(
  completed: number,
  reached: number,
  belowFloor: boolean,
): number | null {
  if (reached <= 0 || belowFloor) return null;
  return round1((completed / reached) * 100);
}

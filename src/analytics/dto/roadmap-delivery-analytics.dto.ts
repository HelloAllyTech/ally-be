import { ApiProperty } from '@nestjs/swagger';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Votes and item counts, split by opportunity type.
 *
 * Both types are always returned from the one pass — "did we ship demand, or did
 * we ship bug fixes?" is a different question from "how much did we ship", and a
 * reader who has to refetch to switch between them ends up comparing two
 * responses computed at different moments. The client offers the split as a
 * control and switches on this shape without going back to the server.
 *
 * `votes`/`opportunities` are the totals, sent rather than left to the client to
 * add up: two clients summing the same parts is two chances to disagree about
 * what the total was.
 */
export class RoadmapDeliveryTotalsDto {
  @ApiProperty({ description: 'Opportunities of either type' })
  opportunities!: number;

  @ApiProperty({ description: 'Of those, `type = idea`' })
  ideaOpportunities!: number;

  @ApiProperty({ description: 'Of those, `type = bug`' })
  bugOpportunities!: number;

  @ApiProperty({
    description:
      'Their total votes — every voter, every monthly period, i.e. the sum of ' +
      "the board's `priorityScore`. Not restricted to the release month: an " +
      'opportunity accrues backing while it waits, and shipping it satisfies all ' +
      'of that accumulated demand.',
  })
  votes!: number;

  @ApiProperty({ description: 'Of those votes, the ones on ideas' })
  ideaVotes!: number;

  @ApiProperty({ description: 'Of those votes, the ones on bugs' })
  bugVotes!: number;
}

/** One owner's share of a month's releases. */
export class RoadmapDeliveryOwnerDto extends RoadmapDeliveryTotalsDto {
  @ApiProperty({
    description:
      "Owner display name — the linked Ally account's current name, or the " +
      'legacy migrated string where the row was never linked. Two reserved ' +
      'values: `unassignedOwnerLabel` for released work with no owner, and ' +
      '`otherOwnerLabel` for the rolled-up tail past `maxOwners`.',
    example: 'Sandeep Malhotra',
  })
  owner!: string;
}

/** One calendar month of releases. */
export class RoadmapDeliveryMonthDto extends RoadmapDeliveryTotalsDto {
  @ApiProperty({ description: 'First day of the month (yyyy-mm-01)' })
  month!: string;

  @ApiProperty({
    description:
      'The month broken down by owner, highest all-time owner first so the ' +
      'stack order is the same in every month. Owners with nothing released in ' +
      'this month are omitted rather than sent as zeros; the response `owners` ' +
      'list is the full domain the client builds its legend and colour scale ' +
      'from.',
    type: [RoadmapDeliveryOwnerDto],
  })
  owners!: RoadmapDeliveryOwnerDto[];

  @ApiProperty({
    description:
      'True for the CURRENT calendar month, which has not finished. More can ' +
      'still ship into it, so its bar can only grow — it is comparable with the ' +
      'months beside it only once it closes. Flagged rather than dropped: on a ' +
      'delivery chart "what have we shipped so far this month" is the reading ' +
      'most worth having, so the client keeps it and marks it on the axis.',
  })
  partial!: boolean;
}

/**
 * Vote-weighted delivery out of the internal product roadmap, by release month
 * and owner. All-time and month-grained by construction.
 */
export class RoadmapDeliveryResponseDto {
  @ApiProperty({
    description:
      'Oldest first, from the first dated release through the current month, ' +
      'with no gaps: a month in which nothing shipped is present with zeros, ' +
      'because "we shipped nothing in March" is a fact about March and not a ' +
      'missing measurement. Empty when no released opportunity carries a date ' +
      'at all — the client shows an empty state rather than an axis of zeros.',
    type: [RoadmapDeliveryMonthDto],
  })
  months!: RoadmapDeliveryMonthDto[];

  @ApiProperty({
    description:
      'Every owner band that appears anywhere in `months`, ranked by ALL-TIME ' +
      'votes so the legend order and the stack order are one thing the server ' +
      'decides once. The two context bands sort last. Ranked on all-time totals ' +
      'rather than on the type filter in play, so a band never changes place or ' +
      'colour as the reader moves a control.',
    type: [String],
  })
  owners!: string[];

  @ApiProperty({
    description: 'Reserved `owner` value for released work with no owner set',
    example: 'Unassigned',
  })
  unassignedOwnerLabel!: string;

  @ApiProperty({
    description:
      'Reserved `owner` value for the tail rolled up past `maxOwners`',
    example: 'Other owners',
  })
  otherOwnerLabel!: string;

  @ApiProperty({
    description:
      'Owners drawn as their own band before the tail is rolled up — the ' +
      'ceiling on distinguishable hues. Echoed so the client states the rule it ' +
      'is showing rather than carrying a second copy of the number.',
  })
  maxOwners!: number;

  @ApiProperty({
    description:
      'Totals across everything on the axis — the plotted population',
    type: RoadmapDeliveryTotalsDto,
  })
  plotted!: RoadmapDeliveryTotalsDto;

  @ApiProperty({
    description:
      'Released work that carries NO `releasedAt` and therefore CANNOT be ' +
      'plotted. The date is stamped only on the transition into `released` and ' +
      'was never backfilled, so a large share of migrated rows have none. They ' +
      'are reported rather than dated from a proxy column: a stand-in date would ' +
      'attribute real work to months it did not ship in, and the chart would ' +
      'give the reader no way to see that it had. The client states these counts ' +
      'under the chart — without them the plotted total reads as everything ' +
      'we have ever shipped.',
    type: RoadmapDeliveryTotalsDto,
  })
  undated!: RoadmapDeliveryTotalsDto;

  @ApiProperty({
    description: 'First day of the current, incomplete month (yyyy-mm-01)',
    example: '2026-08-01',
  })
  currentMonth!: string;

  @ApiProperty({
    description:
      'Always platform-wide: the roadmap tables carry no `tenant_id` because ' +
      "the board is Ally's own backlog rather than customer data. There is no " +
      'tenant filter to honour or to fail to honour, which is why this endpoint ' +
      'takes no `tenantId`.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}

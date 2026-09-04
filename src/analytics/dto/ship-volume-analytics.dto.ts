import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';
import {
  SHIP_VOLUME_DEFAULT_WEEKS,
  SHIP_VOLUME_WINDOWS,
} from '../constants/ship-volume.constants';

/** Lines added, removed, and their sum, for one slice of one week. */
export class ShipVolumeTotalsDto {
  @ApiProperty({ description: 'Lines added' })
  added!: number;

  @ApiProperty({
    description: 'Lines removed, as a POSITIVE count (GitHub reports it negative)',
  })
  deleted!: number;

  @ApiProperty({
    description:
      'added + deleted — the quantity plotted. Churn rather than net, because a ' +
      'week that deletes 40k lines did real work that a net figure would show as ' +
      'nearly nothing. `net` is available to a reader who wants it, from the two ' +
      'parts.',
  })
  churn!: number;
}

/** One repo's share of a week's churn. */
export class ShipVolumeRepoDto extends ShipVolumeTotalsDto {
  @ApiProperty({ description: 'Repository name, without the org', example: 'ally-be' })
  repo!: string;
}

/** One week on the axis. */
export class ShipVolumeWeekDto extends ShipVolumeTotalsDto {
  @ApiProperty({
    description:
      'The SUNDAY the week starts (yyyy-mm-dd, UTC). GitHub buckets its own ' +
      'statistics on Sunday-anchored weeks and we keep that boundary rather than ' +
      're-cutting to ISO Monday weeks, which would require per-commit data we do ' +
      'not fetch and would make these numbers disagree with the same figures read ' +
      "off GitHub's own Insights pages.",
    example: '2026-08-30',
  })
  weekStart!: string;

  @ApiProperty({
    description:
      'The repos that changed in this week, ranked in the same order as the ' +
      'response `repos` domain. Repos with nothing in the week are omitted rather ' +
      'than sent as zeros.',
    type: [ShipVolumeRepoDto],
  })
  repos!: ShipVolumeRepoDto[];

  @ApiProperty({
    description:
      'True for the week still in progress. More will land in it, so its bar can ' +
      'only grow, and it is comparable with the weeks beside it only once it ' +
      'closes. Flagged rather than dropped, on the same reasoning as the roadmap ' +
      'delivery chart: an unfinished VOLUME total is merely incomplete (where an ' +
      'unfinished distribution would be the wrong shape), and "how much have we ' +
      'shipped so far this week" is a reading worth having.',
  })
  partial!: boolean;
}

/** A repo whose statistics could not be read this time. */
export class ShipVolumeUnavailableRepoDto {
  @ApiProperty({ description: 'Repository name, without the org', example: 'ally-mobile' })
  repo!: string;

  @ApiProperty({
    description:
      '`computing` — GitHub is still building this repo\'s statistics cache and ' +
      'answered 202; retrying in a few seconds usually succeeds. `unreachable` — ' +
      'the request failed (auth, rate limit, network). `not_configured` — no ' +
      'GITHUB_TOKEN in this environment.',
    enum: ['computing', 'unreachable', 'not_configured'],
  })
  reason!: 'computing' | 'unreachable' | 'not_configured';

  @ApiProperty({
    description:
      'True when the numbers ON THE AXIS for this repo came from the last good ' +
      'response we cached rather than from this request, so the chart is complete ' +
      'but this slice may be behind. False means the repo is missing from the axis ' +
      'altogether and every week is understated by whatever it shipped.',
  })
  servedFromCache!: boolean;
}

/**
 * Changed lines landing on each repo's default branch, per week, split by repo.
 *
 * An OUTPUT measure, and the endpoint is explicit about that because the number
 * invites a reading it cannot support. Churn says how much code moved; it says
 * nothing about whether the right thing moved, and a small well-abstracted
 * change routinely beats a large one. The outcome counterpart lives next to it
 * on the same tab (`roadmap-delivery`, votes of demand satisfied) and that is
 * the chart to reach for when the question is whether the work was worth doing.
 *
 * Deliberately NOT split by author. The data to do it is right there in the same
 * API, and a per-person line count is the canonical way this metric gets
 * misused; the repo split answers the question actually worth asking of a weekly
 * volume figure — which part of the system is absorbing the effort.
 */
export class ShipVolumeResponseDto {
  @ApiProperty({
    description:
      'Oldest first, one entry per week with NO GAPS across the whole window — a ' +
      'week in which nothing shipped is present with zeros, because "we shipped ' +
      'nothing that week" is a fact about the week and not a missing measurement.',
    type: [ShipVolumeWeekDto],
  })
  weeks!: ShipVolumeWeekDto[];

  @ApiProperty({
    description:
      'Every repo that appears anywhere in `weeks`, ranked by its churn ACROSS ' +
      'THE WHOLE WINDOW so stack order, legend order and colour are one thing the ' +
      'server decides once and no band moves as the reader changes the window. ' +
      'Repos with zero churn in the window are absent — a band with nothing in it ' +
      'is a colour the reader hunts for and never finds.',
    type: [String],
  })
  repos!: string[];

  @ApiProperty({
    description: 'The Sunday of the current, incomplete week (yyyy-mm-dd)',
    example: '2026-08-30',
  })
  currentWeekStart!: string;

  @ApiProperty({ description: 'How many weeks the axis covers' })
  weeksRequested!: number;

  @ApiProperty({
    description: 'Totals across every week and repo on the axis',
    type: ShipVolumeTotalsDto,
  })
  plotted!: ShipVolumeTotalsDto;

  @ApiProperty({
    description:
      'Repos whose statistics this request could not read. Reported rather than ' +
      'silently omitted: churn is a sum across repos, so a missing repo makes ' +
      'every bar shorter with nothing on the chart to show it happened. A client ' +
      'MUST surface this — an understated axis that looks complete is worse than ' +
      'an error.',
    type: [ShipVolumeUnavailableRepoDto],
  })
  unavailableRepos!: ShipVolumeUnavailableRepoDto[];

  @ApiProperty({
    description:
      'Always platform-wide. This measures OUR OWN engineering output, not ' +
      'customer data, so there is no tenant to scope to and no `tenantId` param.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}

export class ShipVolumeQueryDto {
  @ApiProperty({
    description:
      'How many trailing weeks to plot, including the current incomplete one. ' +
      'Constrained to a fixed set rather than a free integer so the axis cannot ' +
      'be asked for a width no reader would choose and the response stays a ' +
      'predictable size.',
    enum: SHIP_VOLUME_WINDOWS,
    default: SHIP_VOLUME_DEFAULT_WEEKS,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(SHIP_VOLUME_WINDOWS as unknown as number[])
  weeks?: number;
}

import { ApiProperty } from '@nestjs/swagger';

import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Standard window params, matching `BugAgentPerformanceQueryDto` (the closest
 * sibling — also reads Bug Hunter's own tables, which carry no tenant column).
 * `tenantId`, if sent, is a no-op: `bug_findings` has no tenant of its own to
 * scope by, and the response's `scoping` always reports platform-wide.
 */
export class BugHunterVolumeQueryDto extends AnalyticsWindowQueryDto {}

/** One bucket of the found-vs-fixed series. */
export class BugHunterVolumePointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Findings AUTONOMOUSLY discovered by Bug Hunter in this bucket (by when ' +
      'they were filed) — every source except `reported_bug`, which is a human ' +
      'filing via "Report a bug" and was not "found" by the agent at all, ' +
      'whoever eventually fixes it.',
  })
  found!: number;

  @ApiProperty({
    description:
      'Findings that reached a MERGED (or later — releasing/released/' +
      'release_failed) status, counted in this bucket regardless of their ' +
      'source: a human-reported bug Bug Hunter fixed still counts as fixed. ' +
      'Bucketed by the fix landing on master where that is known precisely ' +
      '(a bug_hunt_events MERGED row), else by the decision timestamp as a ' +
      'coarser fallback — see the repository doc comment.',
  })
  fixed!: number;
}

/**
 * Bug Hunter's find vs. fix throughput, for Highlights → Goals — "is the agent
 * keeping up with what it finds", read alongside the code-shipped chart rather
 * than the accuracy/precision metrics already on the Bug Agent Performance tab
 * (this endpoint answers neither how ACCURATE Bug Hunter is nor how FAST a fix
 * lands, only how much volume moves through each half of the pipeline).
 *
 * Always platform/internal-wide: `bug_findings` is Ally's own bug tracker, not
 * tenant data, so there is nothing to scope by and no `unscopedSections` to
 * report — matching the precedent set by the roadmap-delivery and ship-volume
 * endpoints for internal-data charts.
 */
export class BugHunterVolumeResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Oldest first, on a gap-free axis: a bucket with neither a find nor a ' +
      'fix is present with both at 0, not omitted.',
    type: [BugHunterVolumePointDto],
  })
  points!: BugHunterVolumePointDto[];

  @ApiProperty({
    type: AnalyticsScopingDto,
    description:
      'Always { tenantId: null, unscopedSections: [] } — bug_findings has no ' +
      'tenant of its own.',
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}

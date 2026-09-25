import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { XP_BY_TENANT_MAX_SEGMENTS } from '../repository/xp-by-tenant-analytics.repository';

/**
 * Trailing windows this chart offers — its OWN control, not the shared
 * `ANALYTICS_RANGES`: how far back the sum reaches. Mirrors
 * `ShipVolumeQueryDto`'s "own Window dropdown" pattern, expressed as a
 * trailing period ending now instead of a week count.
 */
export const XP_BY_TENANT_WINDOWS = ['30d', '90d', '365d', 'all'] as const;
export type XpByTenantWindow = (typeof XP_BY_TENANT_WINDOWS)[number];

/**
 * How the window is grouped: one stacked bar per day/week/month/quarter/year,
 * or `all` for a single bar covering the whole window. Spelled `all` rather
 * than `allTime` to match `GoalsXpQueryDto`'s wire vocabulary.
 */
export const XP_BY_TENANT_GRAINS = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'all',
] as const;
export type XpByTenantGrain = (typeof XP_BY_TENANT_GRAINS)[number];
export type XpByTenantBucketGrain = Exclude<XpByTenantGrain, 'all'>;

export class XpByTenantQueryDto {
  @ApiProperty({
    description: 'Trailing window ending today.',
    enum: XP_BY_TENANT_WINDOWS,
    default: '90d',
    required: false,
  })
  @IsOptional()
  @IsIn(XP_BY_TENANT_WINDOWS)
  window?: XpByTenantWindow;

  @ApiProperty({
    description:
      'Group the window into one stacked bar per period, or `all` for one ' +
      'bar covering the whole window.',
    enum: XP_BY_TENANT_GRAINS,
    default: 'all',
    required: false,
  })
  @IsOptional()
  @IsIn(XP_BY_TENANT_GRAINS)
  grain?: XpByTenantGrain;
}

/** The resolved trailing window, echoed for on-surface labelling. */
export class XpByTenantWindowDto {
  @ApiProperty({ enum: XP_BY_TENANT_WINDOWS })
  window!: XpByTenantWindow;

  @ApiProperty({ description: 'Window start (yyyy-mm-dd, inclusive)' })
  from!: string;

  @ApiProperty({ description: 'Window end (yyyy-mm-dd, inclusive) — today' })
  to!: string;

  @ApiProperty({ description: 'Human-readable window, e.g. "Last 90 days"' })
  label!: string;

  @ApiProperty({
    description: "True for `window=all` — the platform's first row to today.",
  })
  allTime!: boolean;
}

/** One tenant's slice of the bar. */
export class XpByTenantSegmentDto {
  @ApiProperty({ description: 'tenants.id (uuid)' })
  tenantId!: string;

  @ApiProperty({ description: 'Display name' })
  tenantName!: string;

  @ApiProperty({ description: 'XP earned by this tenant within the window' })
  xp!: number;
}

/** One named tenant's XP within a single period. */
export class XpByTenantPointSegmentDto {
  @ApiProperty({
    description: 'tenants.id (uuid) — one of the top-level `segments`',
  })
  tenantId!: string;

  @ApiProperty({ description: 'Display name' })
  tenantName!: string;

  @ApiProperty({ description: 'XP earned by this tenant within the period' })
  xp!: number;
}

/** One period's stacked bar. */
export class XpByTenantPointDto {
  @ApiProperty({
    description: 'Period start (yyyy-mm-dd); the window start for grain=all',
  })
  periodStart!: string;

  @ApiProperty({
    description:
      'Human label, e.g. "2026-03-02", "Mar 2026", "Q1 2026", "2026", "All time"',
  })
  periodLabel!: string;

  @ApiProperty({
    description:
      'XP per named tenant in this period, in the top-level `segments` order. ' +
      'A named tenant with no XP this period is omitted, not sent as zero.',
    type: [XpByTenantPointSegmentDto],
  })
  segments!: XpByTenantPointSegmentDto[];

  @ApiProperty({
    description:
      'XP this period from every tenant NOT named in the top-level ' +
      '`segments` — the same "Other tenants" set for every period.',
  })
  otherXp!: number;

  @ApiProperty({ description: '`segments` XP plus `otherXp` for this period' })
  totalXp!: number;

  @ApiProperty({
    description:
      'True for the period containing today. Still accruing, so it is not a ' +
      'fair comparison with a completed period. Always false for grain=all.',
  })
  inProgress!: boolean;
}

/**
 * Total XP earned across the platform within a trailing window, split by
 * tenant — as one bar for the whole window (`grain=all`, the default) or one
 * stacked bar per period. The top-level `segments`/`otherXp`/`totalXp` are
 * always the WHOLE-window figures: they fix which tenants are named, so a
 * tenant keeps its own band (and colour) in every period rather than drifting
 * in and out of "Other tenants" bar by bar.
 *
 * Test tenants are excluded entirely, never surfaced even as part of `otherXp`
 * — the same rule every other chart on this tab applies.
 */
export class XpByTenantResponseDto {
  @ApiProperty({ type: XpByTenantWindowDto })
  window!: XpByTenantWindowDto;

  @ApiProperty({ enum: XP_BY_TENANT_GRAINS })
  grain!: XpByTenantGrain;

  @ApiProperty({
    description:
      'Oldest first, one per period from the window start through today — ' +
      'zero-filled, so a quiet period is a visible gap rather than a missing ' +
      'bar. Exactly one point for grain=all. The first period can start before ' +
      'the window does (it is the calendar period containing the window ' +
      'start); only XP inside the window is counted.',
    type: [XpByTenantPointDto],
  })
  points!: XpByTenantPointDto[];

  @ApiProperty({
    description:
      `The top ${XP_BY_TENANT_MAX_SEGMENTS} tenants by XP in the window, ` +
      'highest first. Fewer than that when fewer tenants earned any XP at ' +
      'all — a tenant with zero is omitted rather than sent as a zero-height ' +
      'segment.',
    type: [XpByTenantSegmentDto],
  })
  segments!: XpByTenantSegmentDto[];

  @ApiProperty({
    description:
      `XP from every tenant past the top ${XP_BY_TENANT_MAX_SEGMENTS}, ` +
      'rolled into one "Other tenants" total so the bar stays readable. 0 ' +
      'when the window has at most one tenant past the cap — with exactly ' +
      'one tenant in the tail, naming it directly is clearer than a grey ' +
      '"Other" segment for a single org, so it is folded into `segments` ' +
      'instead.',
  })
  otherXp!: number;

  @ApiProperty({
    description:
      '`segments` XP plus `otherXp` — sent rather than left for the client to ' +
      'add up, so two readers cannot disagree about what the total was.',
  })
  totalXp!: number;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}

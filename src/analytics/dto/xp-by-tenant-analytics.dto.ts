import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { XP_BY_TENANT_MAX_SEGMENTS } from '../repository/xp-by-tenant-analytics.repository';

/**
 * Trailing windows this chart offers — its OWN control, not the shared
 * `ANALYTICS_RANGES`, because this is a single bar rather than a bucketed
 * trend: there is no `bucket`/grain to pick, only how far back the one sum
 * reaches. Mirrors `ShipVolumeQueryDto`'s "own Window dropdown" pattern,
 * expressed as a trailing period ending now instead of a week count.
 */
export const XP_BY_TENANT_WINDOWS = ['30d', '90d', '365d', 'all'] as const;
export type XpByTenantWindow = (typeof XP_BY_TENANT_WINDOWS)[number];

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

/**
 * Total XP earned across the platform within a trailing window, split by
 * tenant — a SINGLE bar per request, not a time series (see the sibling
 * `xp-growth`/`xp-level-reached` endpoints for the trend readings of the same
 * ledger).
 *
 * Test tenants are excluded entirely, never surfaced even as part of `otherXp`
 * — the same rule every other chart on this tab applies.
 */
export class XpByTenantResponseDto {
  @ApiProperty({ type: XpByTenantWindowDto })
  window!: XpByTenantWindowDto;

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

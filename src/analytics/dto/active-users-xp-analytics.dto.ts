import { ApiProperty } from '@nestjs/swagger';

import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';
import { ACTIVE_USER_XP_THRESHOLD } from '../repository/active-users-xp-analytics.repository';

/**
 * Standard window params. No `tenantId`: this is a platform-wide leadership
 * chart, matching the house pattern for cross-tenant Highlights charts — see
 * {@link ActiveUsersXpResponseDto.scoping}. `tenantId`, if sent, is ignored by
 * the DTO validator's whitelist rather than silently accepted.
 */
export class ActiveUsersXpQueryDto extends AnalyticsWindowQueryDto {}

/** One bucket of the active-users series. */
export class ActiveUsersXpPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Distinct learners whose XP earned WITHIN this bucket (not lifetime, ' +
      `cumulative XP) reached at least ${ACTIVE_USER_XP_THRESHOLD} — the ` +
      'product-chosen bar for "active" (see ACTIVE_USER_XP_THRESHOLD). A ' +
      'bucket where nobody cleared it is a real zero, not a gap.',
  })
  activeUsers!: number;
}

/**
 * Learners clearing a per-period XP activity bar — "how many people are
 * actually engaging enough to count", as distinct from raw session or login
 * counts, which reward showing up without doing anything.
 */
export class ActiveUsersXpResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Oldest first, on a gap-free axis: a bucket where nobody cleared the ' +
      'threshold is present with `activeUsers: 0` rather than omitted.',
    type: [ActiveUsersXpPointDto],
  })
  points!: ActiveUsersXpPointDto[];

  @ApiProperty({
    description:
      'Always platform-wide (tenantId null) — this chart has no tenant filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}

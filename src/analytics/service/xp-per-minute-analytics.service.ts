import { Injectable } from '@nestjs/common';

import {
  XP_SOURCE_GROUP_BY_RULE,
  XP_SOURCE_GROUP_DESCRIPTIONS,
  XP_SOURCE_GROUP_LABELS,
  XP_SOURCE_GROUPS,
  XpSourceGroup,
} from '../constants/xp-per-minute.constants';
import {
  XpPerMinutePointDto,
  XpPerMinuteQueryDto,
  XpPerMinuteResponseDto,
  XpPerMinuteTotalsDto,
  XpSourceGroupsDto,
} from '../dto/xp-per-minute-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import { XpPerMinuteAnalyticsRepository } from '../repository/xp-per-minute-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/** Month for every range — the grain is a per-chart control on the surface. */
const defaultBucketFor = (): AnalyticsBucket => 'month';

type SourceXp = Record<XpSourceGroup, number>;

const zeroSources = (): SourceXp =>
  Object.fromEntries(XP_SOURCE_GROUPS.map((g) => [g, 0])) as SourceXp;

/**
 * XP earned per minute of roleplay practice (AAQ-165), split by the XP source
 * that paid it.
 *
 * The numerator is ALL XP, the denominator is roleplay minutes only — the ratio
 * is deliberately a portfolio measure, not roleplay's own pay rate. Roleplay
 * pays roughly 1 XP a minute plus completion and depth bonuses, so anything the
 * headline carries above that is XP from the rest of the learning portfolio.
 * Splitting the numerator by source (over the one shared denominator) is what
 * lets the reader see which it is.
 *
 * Rules that exist because a reader would otherwise be misled:
 *  - **Ratios are null over zero minutes.** XP in a period with no roleplay has
 *    no per-minute figure; zero would read as "roleplay paid nothing".
 *  - **Overall is Σ XP ÷ Σ minutes,** never a mean of per-bucket ratios, which
 *    would weight a quiet week the same as a busy one.
 *  - **Unmapped rules land in `other`,** so the stack always sums to the total.
 */
@Injectable()
export class XpPerMinuteAnalyticsService {
  constructor(private readonly repo: XpPerMinuteAnalyticsRepository) {}

  async getXpPerMinute(
    query: XpPerMinuteQueryDto,
  ): Promise<XpPerMinuteResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const { start, endExclusive, bucket } = window;

    const [xpRows, minuteRows] = await Promise.all([
      this.repo.getXpByBucketAndRule(start, endExclusive, bucket),
      this.repo.getMinutesByBucket(start, endExclusive, bucket),
    ]);

    const xpByBucket = new Map<string, SourceXp>();
    const overallXp = zeroSources();
    for (const row of xpRows) {
      const group = XP_SOURCE_GROUP_BY_RULE[row.rule] ?? 'other';
      const acc = xpByBucket.get(row.bucket) ?? zeroSources();
      acc[group] += row.xp;
      overallXp[group] += row.xp;
      xpByBucket.set(row.bucket, acc);
    }
    const minutesByBucket = new Map(
      minuteRows.map((r) => [r.bucket, r.minutes]),
    );

    const points: XpPerMinutePointDto[] = generateBucketLabels(
      start,
      endExclusive,
      bucket,
    ).map((bucketKey) => ({
      bucket: bucketKey,
      ...toTotals(
        xpByBucket.get(bucketKey) ?? zeroSources(),
        minutesByBucket.get(bucketKey) ?? 0,
      ),
    }));

    const totalMinutes = minuteRows.reduce((n, r) => n + r.minutes, 0);

    return {
      bucket,
      window: describeWindow(window),
      sources: XP_SOURCE_GROUPS.map((key) => ({
        key,
        label: XP_SOURCE_GROUP_LABELS[key],
        description: XP_SOURCE_GROUP_DESCRIPTIONS[key],
      })),
      points,
      overall: toTotals(overallXp, totalMinutes),
      scoping: {
        tenantId: null,
        // Platform-wide by construction: test orgs are excluded on both sides
        // and the Priority tab offers no tenant filter.
        unscopedSections: ['points', 'overall'],
      },
      computedAt: new Date().toISOString(),
    };
  }
}

function toTotals(bySource: SourceXp, minutes: number): XpPerMinuteTotalsDto {
  const xp = XP_SOURCE_GROUPS.reduce((n, g) => n + bySource[g], 0);
  const perMinute = (value: number) =>
    minutes > 0 ? round4(value / minutes) : null;
  const xpBySource = {} as XpSourceGroupsDto;
  const perMinuteBySource = {} as XpSourceGroupsDto;
  for (const g of XP_SOURCE_GROUPS) {
    xpBySource[g] = bySource[g];
    perMinuteBySource[g] = perMinute(bySource[g]);
  }
  return {
    xp,
    minutes: round2(minutes),
    xpPerMinute: perMinute(xp),
    roleplaySharePct: xp > 0 ? round2((bySource.roleplay / xp) * 100) : null,
    xpBySource,
    perMinuteBySource,
  };
}

/**
 * Four decimals for per-minute figures: a small source (peer comments) can be
 * a few thousandths of an XP per minute, and at two decimals it rounds to 0
 * and the stack stops adding up to the headline.
 */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

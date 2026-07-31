import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { ActivationAnalyticsService } from 'src/analytics/service/activation-analytics.service';
import { CoachingLoopAnalyticsService } from 'src/analytics/service/coaching-loop-analytics.service';
import { CompetencyMapAnalyticsService } from 'src/analytics/service/competency-map-analytics.service';
import { CompletionRateAnalyticsService } from 'src/analytics/service/completion-rate-analytics.service';
import { HighlightsAnalyticsService } from 'src/analytics/service/highlights-analytics.service';
import { LanguageMixAnalyticsService } from 'src/analytics/service/language-mix-analytics.service';
import { OrgHealthAnalyticsService } from 'src/analytics/service/org-health-analytics.service';
import { PlatformAnalyticsService } from 'src/analytics/service/platform-analytics.service';
import { QualityDistributionAnalyticsService } from 'src/analytics/service/quality-distribution-analytics.service';
import { RoleplayVolumeAnalyticsService } from 'src/analytics/service/roleplay-volume-analytics.service';
import { ScribeAdoptionAnalyticsService } from 'src/analytics/service/scribe-adoption-analytics.service';
import { ScribeAnalyticsService } from 'src/analytics/service/scribe-analytics.service';
import { SkillGrowthAnalyticsService } from 'src/analytics/service/skill-growth-analytics.service';
import { TrackDropoffAnalyticsService } from 'src/analytics/service/track-dropoff-analytics.service';
import { UsageLevelAnalyticsService } from 'src/analytics/service/usage-level-analytics.service';
import { getPlatformDataFloor } from 'src/analytics/util/data-floor.util';
import {
  addDays,
  isoDate,
  resolveAnalyticsWindow,
} from 'src/analytics/util/analytics-window.util';

import { GenerateSuggestionsDto } from '../dto/analytics-suggestion.dto';
import { SUGGESTION_PAYLOAD_LIMITS } from '../constants/analytics-suggestions.constants';

/** A resolved window in the form the suggestion rows and the prompt both use. */
export interface SuggestionWindow {
  range: string | null;
  from: string;
  to: string;
  label: string;
}

export interface SuggestionPayload {
  window: SuggestionWindow;
  /** Section name → compacted aggregate. */
  sections: Record<string, unknown>;
  included: string[];
  /** `"<section>: <reason>"` for anything the model could not be shown. */
  failed: string[];
}

/** Keys whose presence marks an array as a time series rather than a ranking. */
const SERIES_KEYS = ['bucket', 'date', 'month', 'period', 'week', 'day'];

/**
 * Gathers one window of platform analytics for the suggestion prompt.
 *
 * Three properties matter more than breadth here:
 *
 *  1. **One failed section never fails the run.** The fan-out is
 *     `Promise.allSettled`, so a section whose query throws (most often
 *     `range=all` on an endpoint with no data floor) is reported as unavailable
 *     rather than taking the whole generation down.
 *  2. **Nothing is dropped silently.** Every section that is missing or
 *     shortened says so — in `failed`, or in an inline `_note` on a truncated
 *     array. The prompt tells the model not to reason about what it cannot see,
 *     which only works if absence is visible. A silently truncated series would
 *     read as a complete one and produce a confident claim about a period that
 *     was never sent.
 *  3. **The reader and the model see the same platform.** Every figure comes
 *     from the same reviewed service the Analytics tab calls, so a suggestion can
 *     be checked against the dashboard rather than against a second query that
 *     happens to be worded differently.
 *
 * Six of the fifteen sections are all-time by construction (their query DTOs
 * take no window) and are labelled `allTime: true` so the model does not describe
 * platform history as a change during the window.
 */
@Injectable()
export class AnalyticsSuggestionsPayloadService {
  private readonly logger = LoggerService.getInstance(
    AnalyticsSuggestionsPayloadService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly platformAnalytics: PlatformAnalyticsService,
    private readonly highlights: HighlightsAnalyticsService,
    private readonly activation: ActivationAnalyticsService,
    private readonly completionRate: CompletionRateAnalyticsService,
    private readonly languageMix: LanguageMixAnalyticsService,
    private readonly qualityDistribution: QualityDistributionAnalyticsService,
    private readonly coachingLoop: CoachingLoopAnalyticsService,
    private readonly scribeAdoption: ScribeAdoptionAnalyticsService,
    private readonly scribe: ScribeAnalyticsService,
    private readonly orgHealth: OrgHealthAnalyticsService,
    private readonly usageLevels: UsageLevelAnalyticsService,
    private readonly roleplayVolume: RoleplayVolumeAnalyticsService,
    private readonly skillGrowth: SkillGrowthAnalyticsService,
    private readonly competencyMap: CompetencyMapAnalyticsService,
    private readonly trackDropoff: TrackDropoffAnalyticsService,
  ) {}

  async collect(dto: GenerateSuggestionsDto): Promise<SuggestionPayload> {
    const window = await this.resolveWindow(dto);
    // Preset presets pass `range` through; a custom window passes from/to. Both
    // are the same object the analytics endpoints accept.
    const q =
      dto.from && dto.to
        ? { from: dto.from, to: dto.to }
        : { range: dto.range };

    const tasks: {
      name: string;
      allTime?: boolean;
      run: () => Promise<unknown>;
    }[] = [
      {
        name: 'platformOverview',
        run: () => this.platformAnalytics.getOverview(q),
      },
      {
        name: 'leadershipHighlights',
        run: () => this.highlights.getHighlights(q),
      },
      {
        name: 'learnerActivation',
        run: () => this.activation.getActivation(q),
      },
      {
        name: 'roleplayCompletionRate',
        run: () => this.completionRate.getCompletionRate(q),
      },
      { name: 'languageMix', run: () => this.languageMix.getLanguageMix(q) },
      {
        name: 'scoreDistribution',
        run: () => this.qualityDistribution.getQualityDistribution(q),
      },
      { name: 'coachingLoop', run: () => this.coachingLoop.getCoachingLoop(q) },
      {
        name: 'scribeAdoption',
        run: () => this.scribeAdoption.getScribeAdoption(q),
      },
      { name: 'scribeOverview', run: () => this.scribe.getOverview(q) },
      // ── all-time by construction: these take no window ──────────────────
      {
        name: 'orgHealth',
        allTime: true,
        run: () => this.orgHealth.getOrgHealth({}),
      },
      {
        name: 'usageLevels',
        allTime: true,
        run: () => this.usageLevels.getUsageLevels({}),
      },
      {
        name: 'roleplayVolumePerLearner',
        allTime: true,
        run: () => this.roleplayVolume.getRoleplayVolume({}),
      },
      {
        name: 'skillGrowth',
        allTime: true,
        run: () => this.skillGrowth.getSkillGrowth({}),
      },
      {
        name: 'competencyMap',
        allTime: true,
        run: () => this.competencyMap.getCompetencyMap({}),
      },
      {
        name: 'trackDropoff',
        allTime: true,
        run: () => this.trackDropoff.getTrackDropoff({}),
      },
    ];

    const settled = await Promise.allSettled(tasks.map((t) => t.run()));

    const sections: Record<string, unknown> = {};
    const included: string[] = [];
    const failed: string[] = [];

    settled.forEach((result, i) => {
      const { name, allTime } = tasks[i];

      if (result.status === 'rejected') {
        const reason = (result.reason as Error)?.message ?? 'query failed';
        failed.push(`${name}: ${reason}`);
        this.logger.warn(
          `[SUGGESTIONS] Section "${name}" unavailable for this window: ${reason}`,
        );
        return;
      }

      const compacted = compact(result.value);
      const section = allTime ? { allTime: true, data: compacted } : compacted;

      // An oversized section is dropped whole rather than cut mid-structure:
      // half an object tells the model nothing about which half is missing.
      const size = JSON.stringify(section)?.length ?? 0;
      if (size > SUGGESTION_PAYLOAD_LIMITS.SECTION_MAX_CHARS) {
        failed.push(
          `${name}: too large for the prompt (${size} chars after compaction)`,
        );
        this.logger.warn(
          `[SUGGESTIONS] Section "${name}" dropped: ${size} chars exceeds ` +
            `${SUGGESTION_PAYLOAD_LIMITS.SECTION_MAX_CHARS}`,
        );
        return;
      }

      sections[name] = section;
      included.push(name);
    });

    return { window, sections, included, failed };
  }

  /**
   * Resolve the window once, here, so the value stamped on every stored
   * suggestion is the same one the sections were queried for.
   *
   * The data floor is fetched only for `range=all` — one cheap query, and asking
   * for it on a preset window would be work whose answer is discarded.
   */
  private async resolveWindow(
    dto: GenerateSuggestionsDto,
  ): Promise<SuggestionWindow> {
    const custom = Boolean(dto.from && dto.to);
    const range = custom ? null : (dto.range ?? '30d');

    const resolved = resolveAnalyticsWindow(
      custom ? { from: dto.from, to: dto.to } : { range: dto.range },
      {
        defaultRange: '30d',
        // Bucket is irrelevant to this caller — the sections each pick their own
        // grain — but resolveAnalyticsWindow requires a default.
        defaultBucketFor: () => 'week',
        allTimeStart:
          range === 'all'
            ? await getPlatformDataFloor(this.dataSource)
            : undefined,
      },
    );

    return {
      range,
      from: isoDate(resolved.start),
      // Reported inclusive, the way a reader reads a date range.
      to: isoDate(addDays(resolved.endExclusive, -1)),
      label: resolved.label,
    };
  }
}

/**
 * Shrink an aggregate to what fits in a prompt without misrepresenting it.
 *
 * Long arrays are cut and SAY SO in a `_note`, which is the whole point: the
 * model is told to reason only from what it was sent, and a bare truncated array
 * looks exactly like a complete one. Series keep their TAIL (recent periods are
 * what a suggestion is about); rankings keep their HEAD (they arrive ordered
 * best-first). Floats are rounded because a suggestion citing 4.7 and one citing
 * 4.66666666 make the same argument, and the extra digits are prompt budget
 * spent on noise.
 */
export function compact(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Number(value.toFixed(2));
  }
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    const cap = isSeries(value)
      ? SUGGESTION_PAYLOAD_LIMITS.SERIES_POINTS
      : SUGGESTION_PAYLOAD_LIMITS.LIST_ROWS;
    if (value.length <= cap) return value.map(compact);

    const series = isSeries(value);
    const kept = series ? value.slice(-cap) : value.slice(0, cap);
    return {
      _note: series
        ? `showing the latest ${cap} of ${value.length} periods`
        : `showing the top ${cap} of ${value.length} rows`,
      items: kept.map(compact),
    };
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[key] = compact(v);
  }
  return out;
}

function isSeries(arr: unknown[]): boolean {
  const first = arr[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return false;
  return SERIES_KEYS.some((k) => k in (first as Record<string, unknown>));
}

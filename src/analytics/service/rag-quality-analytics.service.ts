import { Injectable } from '@nestjs/common';

import { LoggerService } from '../../logger/logger.service';
import {
  RagQualityQueryDto,
  RagQualityResponseDto,
} from '../dto/rag-quality-analytics.dto';
import { RagQualityAnalyticsRepository } from '../repository/rag-quality-analytics.repository';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
import { AnalyticsRange } from '../dto/platform-analytics.dto';

/**
 * The (model, rubric) pair these numbers are read against.
 *
 * Pinned rather than "whatever is latest", because a label only means something within one
 * pair — the same trap the language judge documented. It matches the drainer's target; when
 * that moves, this moves with it, and `judgeVersions` in the response says when a window
 * contains more than one pair so nobody reads a mixed rate as a trend.
 */
const JUDGE_MODEL = 'gemini-2.5-pro';
const JUDGE_PROMPT_VERSION = 'v1';

/**
 * Candidate floors the curve is computed at.
 *
 * The three that were actually argued for in production (0.5 by reasoning, 0.45 after a direct
 * hit measured 0.5056, 0.35 after a query returned nothing against a document that answered
 * it), plus two below to show what a looser floor would have admitted. The point of showing
 * them together is that the argument is settled by the `relevantLost` column rather than by
 * anyone's intuition about what "actually close" ought to mean.
 */
const FLOOR_CANDIDATES = [0.2, 0.3, 0.35, 0.4, 0.45, 0.5];

/**
 * Below this many judged retrievals, the response flags itself rather than inviting a
 * percentage to be read off four rows.
 *
 * Stated as a count, not a rate, deliberately: "7 of 10" and "70%" are not the same claim, and
 * a corpus can legitimately see a handful of retrievals a day (Stacks: "Define success criteria
 * with specific numbers, not percentages"). Surfaces show the counts either way and suppress
 * the percentages below it.
 */
const MIN_JUDGED_FOR_RATES = 20;

/** How many judged-wanting retrievals to return. Qualitative reading, not a feed. */
const GAP_LIMIT = 15;

/**
 * RAG retrieval quality, as the judge labelled it.
 *
 * WHAT LEADS, AND WHY: sufficiency and relevance, not retrieval volume. Volume is the
 * gameable number here — an operator probing thresholds in the admin preview can double it in
 * an afternoon without anything improving — and the outcome anyone actually cares about is
 * whether what came back answered the question (Stacks: "Measure true customer outcomes, not
 * vanity metrics").
 *
 * Everything is a count. Rates are computed by the client only when `coverage` says the sample
 * supports one, so a corpus with six judged retrievals reads as six rather than as 83%.
 */
@Injectable()
export class RagQualityAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    RagQualityAnalyticsService.name,
  );

  constructor(private readonly repository: RagQualityAnalyticsRepository) {}

  private static defaultBucketFor(range: AnalyticsRange): AnalyticsBucket {
    if (range === '30d') return 'day';
    if (range === '90d') return 'week';
    return 'month';
  }

  async getRagQuality(
    query: RagQualityQueryDto,
  ): Promise<RagQualityResponseDto> {
    const window = resolveAnalyticsWindow(query, {
      // 30 days, not the platform's usual longer default: the subject is the corpus and the
      // floor as they are NOW, and a retrieval from before a document was uploaded or the
      // floor moved describes a retrieval layer that no longer exists.
      defaultRange: '30d',
      defaultBucketFor: RagQualityAnalyticsService.defaultBucketFor,
      allTimeStart: new Date('2026-09-09T00:00:00Z'),
    });

    const filter = {
      from: window.start,
      toExclusive: window.endExclusive,
      consumer: query.consumer ?? null,
      corpus: query.corpus ?? null,
      judgeModel: JUDGE_MODEL,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
    };

    const [
      coverage,
      sufficiency,
      relevance,
      byConsumer,
      floorCurve,
      gaps,
      versions,
    ] = await Promise.all([
      this.repository.coverage(filter),
      this.repository.sufficiency(filter),
      this.repository.relevance(filter),
      this.repository.byConsumer(filter),
      this.repository.floorCurve(filter, FLOOR_CANDIDATES),
      this.repository.gaps(filter, GAP_LIMIT),
      this.repository.judgeVersions(filter),
    ]);

    if (versions.length > 1) {
      // Not an error — a rubric change legitimately produces two pairs for a while — but the
      // window's numbers are a mixture until the older pair falls out of it.
      this.logger.warn(
        `[rag-quality] window contains ${versions.length} judge versions; ` +
          `rates are scoped to ${JUDGE_MODEL}/${JUDGE_PROMPT_VERSION}`,
      );
    }

    return {
      window: describeWindow(window),
      coverage: {
        retrievals: Number(coverage.retrievals ?? 0),
        judged: Number(coverage.judged ?? 0),
        passages: Number(coverage.passages ?? 0),
        judgedPassages: Number(coverage.judged_passages ?? 0),
        belowReportingFloor:
          Number(coverage.judged ?? 0) < MIN_JUDGED_FOR_RATES,
      },
      sufficiency: sufficiency.map((r) => ({
        label: r.label,
        count: Number(r.count),
      })),
      relevance: relevance.labels,
      superficialMatches: relevance.superficial,
      byConsumer: byConsumer.map((r) => ({
        consumer: r.consumer,
        retrievals: Number(r.retrievals),
        judged: Number(r.judged),
        emptyRetrievals: Number(r.empty_retrievals),
      })),
      floorCurve: floorCurve.map((r) => ({
        floor: Number(r.floor),
        kept: Number(r.kept),
        relevant: Number(r.relevant),
        tangential: Number(r.tangential),
        irrelevant: Number(r.irrelevant),
        relevantLost: Number(r.relevant_lost),
      })),
      gaps: gaps.map((r) => ({
        query: r.query,
        sufficiency: r.sufficiency,
        missing: r.missing ?? null,
        consumer: r.consumer,
        returnedCount: Number(r.returned_count),
        minSimilarity: Number(r.min_similarity),
        occurredAt: new Date(r.occurred_at).toISOString(),
      })),
      judgeVersions: versions.map((v) => ({
        judgeModel: v.judge_model,
        judgePromptVersion: v.judge_prompt_version,
        judgments: Number(v.judgments),
      })),
    };
  }
}

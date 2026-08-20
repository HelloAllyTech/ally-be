import { Injectable } from '@nestjs/common';

import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import {
  TrendPoint,
  TurnConditionRow,
  WEAK_METRICS_PARAMS,
  WEAK_METRICS_VERSION,
  WeakMetricsAnalyticsRepository,
  WeakMetricsFilters,
} from '../repository/weak-metrics-analytics.repository';
import {
  WeakMetricGroupDto,
  WeakMetricPointDto,
  WeakMetricSeriesDto,
  WeakMetricState,
  WeakMetricsBucket,
  WeakMetricsQueryDto,
  WeakMetricsRange,
  WeakMetricsResponseDto,
} from '../dto/weak-metrics.dto';

/**
 * The five weak-performing metrics, assembled for one tab.
 *
 * Everything numeric happens here or in SQL. The judges contribute only
 * booleans, enum labels and counts; no model is ever asked for a rate, a score
 * or a correlation. That split is what makes these numbers reproducible when a
 * judge model changes underneath them.
 *
 * Each series carries its own `state` and `caveat` rather than being presented
 * as a bare number, because several of these signals are honest-but-partial and
 * a reader who does not know that will over-read them. A near-zero
 * `dialect_lexicon` line means the detector is blind, not that the problem is
 * solved — so the caveat travels with the data instead of living in a doc.
 */
/**
 * Copy for the turn-level conditions, kept beside the ids the repository emits
 * so a factor cannot appear on the tab without someone having written what it
 * means. `unit` tells the client how to format a band edge — milliseconds and
 * character counts do not read the same way.
 */
const TURN_FACTOR_COPY: Record<
  string,
  { label: string; description: string; unit: 'ms' | 'count' | 'flag' }
> = {
  responseLatencyMs: {
    label: 'How long the actor took to reply',
    description:
      'Wall-clock time from the learner finishing to the reply starting.',
    unit: 'ms',
  },
  eouDelayMs: {
    label: 'How long we waited before deciding the learner had finished',
    description:
      'End-of-utterance delay. Too short cuts the learner off; too long stalls.',
    unit: 'ms',
  },
  responseChars: {
    label: "How long the actor's reply was",
    description: 'Characters in the reply the actor produced.',
    unit: 'count',
  },
  interrupted: {
    label: 'Whether the learner interrupted',
    description: 'The learner spoke over the actor mid-reply.',
    unit: 'flag',
  },
  knowledgeRetrieval: {
    label: 'Whether knowledge retrieval ran',
    description: 'The turn went to the knowledge base before answering.',
    unit: 'flag',
  },
};

/**
 * A factor needs this many judged turns behind it before it is worth showing.
 * Below it the quartiles are a handful of turns each and the spread is noise
 * dressed as a finding.
 */
const MIN_TURNS_PER_FACTOR = 100;

@Injectable()
export class WeakMetricsAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    WeakMetricsAnalyticsService.name,
  );

  constructor(
    private readonly repo: WeakMetricsAnalyticsRepository,
    private readonly redis: RedisService,
  ) {}

  /**
   * How long a computed tab response is reused.
   *
   * This endpoint fans out to 26 aggregates per request and every filter change
   * re-runs all of them. Warm, each is tens of milliseconds; cold, the same
   * query measured 1.5s, and the reader pays that on every filter they try.
   * Nothing here is slow enough to index away — the tables are small and the
   * plans are clean — so the fix is to stop recomputing an answer that cannot
   * have changed.
   *
   * Five minutes is safe rather than arbitrary: the judges feeding this tab run
   * on a 30-minute catch-up, so an entry can only go stale ahead of data that
   * does not exist yet. A manual re-judge is the one thing that changes the
   * answer sooner, and five minutes is already inside the time it takes someone
   * to trigger one and look — so there is deliberately no explicit
   * invalidation hook to keep in sync with future filters.
   */
  private static readonly CACHE_TTL_SECONDS = 300;

  /** Namespace + schema version. Bumping the suffix retires every old entry. */
  private static readonly CACHE_PREFIX = 'weak-metrics:v1';

  /**
   * Cache key for one filter combination.
   *
   * Every field the response varies by is in here, and `WEAK_METRICS_VERSION`
   * too: the thresholds it names are baked into the computed numbers, so a
   * parameters change must not be served an entry computed under the old ones.
   * Built from a FIXED field order rather than by serialising the DTO — object
   * key order is not guaranteed, and two identical filter sets keyed
   * differently would silently halve the hit rate.
   */
  private static cacheKey(query: WeakMetricsQueryDto): string {
    const parts = [
      WEAK_METRICS_VERSION,
      query.range ?? '',
      query.bucket ?? '',
      query.language ?? '',
      query.llmModel ?? '',
      query.scenarioId ?? '',
      query.scenarioVersionId ?? '',
      query.promptVersion ?? '',
    ];
    return `${WeakMetricsAnalyticsService.CACHE_PREFIX}:${parts.join('|')}`;
  }

  /**
   * Start of the bucket that today falls in, as `yyyy-mm-dd`.
   *
   * Every window on this tab runs up to now, so there is always a partial
   * bucket at the right-hand edge. Plotting it made the last point read as a
   * cliff — three days of a week charted beside seven-day weeks looked like
   * quality falling off, when it was only the week not being over. This names
   * the bucket so the client can drop it from the plot and say so, exactly as
   * `resolveWindow`'s `inProgressBucket` does for the other tabs.
   */
  private static inProgressBucketOf(bucket: 'week' | 'month'): string {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    if (bucket === 'month') {
      d.setUTCDate(1);
    } else {
      // Monday-start, matching Postgres `date_trunc('week', ...)`.
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow);
    }
    return d.toISOString().slice(0, 10);
  }

  private resolveStart(range?: WeakMetricsRange): Date {
    const now = new Date();
    const d = new Date(now);
    switch (range) {
      case WeakMetricsRange.D30:
        d.setDate(d.getDate() - 30);
        return d;
      case WeakMetricsRange.D90:
        d.setDate(d.getDate() - 90);
        return d;
      case WeakMetricsRange.ALL:
        return new Date('2025-01-01T00:00:00Z');
      case WeakMetricsRange.M12:
      default:
        d.setMonth(d.getMonth() - 12);
        return d;
    }
  }

  /**
   * Rows -> points. The rate is computed here, once, so every series divides
   * the same way and a zero denominator becomes null rather than 0 — an empty
   * bucket and a perfect bucket must not render identically.
   */
  private toPoints(rows: TrendPoint[]): WeakMetricPointDto[] {
    return (rows ?? []).map((r) => {
      const numerator = Number(r.numerator ?? 0);
      const denominator = Number(r.denominator ?? 0);
      return {
        bucket: r.bucket,
        numerator,
        denominator,
        value: denominator > 0 ? numerator / denominator : null,
      };
    });
  }

  /**
   * A series whose measurement STARTS partway through the window.
   *
   * Barge-in is the only metric here that cannot be backfilled: the flag is
   * written by the live worker, so every bucket before that deploy reads a true
   * zero out of a large denominator. Two failures follow if that is left alone.
   * The chart shows a long flat zero and then a step, which reads as a
   * regression rather than as instrumentation arriving. And a hard-coded
   * `state: none` would keep the series blank *forever* — the tab refuses to
   * chart a not-measured series, so the day the flag starts firing is the day
   * the data becomes permanently invisible.
   *
   * So: drop the leading all-zero buckets, and let the data decide the state.
   * Any recorded event at all means the instrumentation is live and the series
   * flips to measured on its own, with no follow-up deploy.
   */
  private instrumentedFrom(
    id: string,
    label: string,
    unit: string,
    rows: TrendPoint[],
    opts: {
      caveat?: string | null;
      lowerIsBetter?: boolean | null;
      description?: string;
    } = {},
  ): WeakMetricSeriesDto {
    const points = this.toPoints(rows);
    const firstRecorded = points.findIndex((p) => p.numerator > 0);
    if (firstRecorded === -1) {
      return this.series(id, label, unit, WeakMetricState.NONE, [], opts);
    }
    return this.series(
      id,
      label,
      unit,
      WeakMetricState.MEASURED,
      points.slice(firstRecorded),
      opts,
    );
  }

  private series(
    id: string,
    label: string,
    unit: string,
    state: WeakMetricState,
    rows: TrendPoint[],
    opts: {
      caveat?: string | null;
      lowerIsBetter?: boolean | null;
      description?: string;
    } = {},
  ): WeakMetricSeriesDto {
    const points = this.toPoints(rows);
    const withValues = points.filter((p) => p.value !== null);
    return {
      id,
      label,
      unit,
      state,
      lowerIsBetter:
        opts.lowerIsBetter === undefined ? true : opts.lowerIsBetter,
      description: opts.description ?? '',
      caveat: opts.caveat ?? null,
      points,
      latest: withValues.length
        ? withValues[withValues.length - 1].value
        : null,
      previous:
        withValues.length > 1 ? withValues[withValues.length - 2].value : null,
    };
  }

  /**
   * Group badge.
   *
   * NONE only when NOTHING in the group is measured. An earlier version took
   * the worst state, which labelled "Actor responsiveness" as Not measured
   * because barge-in is uninstrumented — while three of its four series had
   * real data on screen directly underneath. A group holding both measured and
   * unmeasured series is exactly what `partial` means, and saying so is more
   * honest in both directions than either extreme.
   */
  private groupState(series: WeakMetricSeriesDto[]): WeakMetricState {
    if (series.length === 0) return WeakMetricState.NONE;
    if (series.every((s) => s.state === WeakMetricState.NONE))
      return WeakMetricState.NONE;
    if (series.every((s) => s.state === WeakMetricState.MEASURED))
      return WeakMetricState.MEASURED;
    return WeakMetricState.PARTIAL;
  }

  /**
   * Pearson correlation of skill score against log(turns).
   *
   * log rather than raw turns because the relationship saturates: the first ten
   * turns move the score enormously and everything past thirty barely moves it,
   * so a linear fit understates how much of the score is just session length.
   */
  /**
   * Group the repository's flat band rows into factors, and order them by how
   * much they actually DISCRIMINATE — the gap between the worst band and the
   * best.
   *
   * Ordering by spread rather than by name is the whole point of the panel. A
   * factor whose bands all sit at the same rate tells you nothing and should
   * sink; the one where the top band faults three times as often as the bottom
   * is where to look next. Sorting alphabetically would bury it.
   */
  private turnConditions(rows: TurnConditionRow[] | undefined): {
    totalTurns: number;
    baselineRate: number | null;
    factors: Array<{
      id: string;
      label: string;
      description: string;
      unit: string;
      spread: number;
      bands: Array<{
        band: string;
        lo: number | null;
        hi: number | null;
        turns: number;
        faults: number;
        rate: number;
      }>;
    }>;
  } {
    const byFactor = new Map<string, TurnConditionRow[]>();
    for (const r of rows ?? []) {
      const list = byFactor.get(r.factor) ?? [];
      list.push(r);
      byFactor.set(r.factor, list);
    }

    const factors = [...byFactor.entries()]
      .filter(([id]) => TURN_FACTOR_COPY[id])
      .map(([id, list]) => {
        const bands = [...list]
          .sort((a, b) => Number(a.bandOrder) - Number(b.bandOrder))
          .map((r) => {
            const turns = Number(r.turns ?? 0);
            const faults = Number(r.faults ?? 0);
            return {
              band: r.band,
              lo: r.lo === null || r.lo === undefined ? null : Number(r.lo),
              hi: r.hi === null || r.hi === undefined ? null : Number(r.hi),
              turns,
              faults,
              rate: turns > 0 ? faults / turns : 0,
            };
          });
        const rates = bands.map((b) => b.rate);
        return {
          id,
          ...TURN_FACTOR_COPY[id],
          spread: rates.length ? Math.max(...rates) - Math.min(...rates) : 0,
          bands,
        };
      })
      .filter(
        (fac) =>
          fac.bands.reduce((a, b) => a + b.turns, 0) >= MIN_TURNS_PER_FACTOR,
      )
      .sort((a, b) => b.spread - a.spread);

    // Every factor bands the SAME turns, so any one of them carries the
    // baseline. Latency is used when present because it is the least likely to
    // be null on a turn that was recorded at all.
    const basis =
      factors.find((fac) => fac.id === 'responseLatencyMs') ?? factors[0];
    const totalTurns = basis ? basis.bands.reduce((a, b) => a + b.turns, 0) : 0;
    const totalFaults = basis
      ? basis.bands.reduce((a, b) => a + b.faults, 0)
      : 0;

    return {
      totalTurns,
      baselineRate: totalTurns > 0 ? totalFaults / totalTurns : null,
      factors,
    };
  }

  private correlate(
    pairs: Array<{ score: number; turns: number }>,
  ): number | null {
    const usable = (pairs ?? [])
      .map((p) => ({ x: Math.log(Number(p.turns)), y: Number(p.score) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (usable.length < 3) return null;

    const n = usable.length;
    const meanX = usable.reduce((s, p) => s + p.x, 0) / n;
    const meanY = usable.reduce((s, p) => s + p.y, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (const p of usable) {
      const a = p.x - meanX;
      const b = p.y - meanY;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    const den = Math.sqrt(dx * dy);
    return den === 0 ? null : num / den;
  }

  /**
   * Cached read path. Every miss computes the full tab and every hit skips 26
   * aggregates, which is the whole point.
   *
   * Redis is treated as an optimisation, never a dependency: a failed read
   * falls through to computing, and a failed write is logged and dropped. A
   * slow tab is a nuisance; a blank tab because a cache is down is an outage,
   * and this endpoint is not worth one.
   */
  async getWeakMetrics(
    query: WeakMetricsQueryDto,
  ): Promise<WeakMetricsResponseDto> {
    const key = WeakMetricsAnalyticsService.cacheKey(query);

    try {
      const hit = await this.redis.get(key);
      if (hit) {
        return JSON.parse(hit) as WeakMetricsResponseDto;
      }
    } catch (error) {
      this.logger.warn(
        `[weak-metrics] cache read failed, computing instead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const response = await this.computeWeakMetrics(query);

    try {
      await this.redis.set(
        key,
        JSON.stringify(response),
        WeakMetricsAnalyticsService.CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `[weak-metrics] cache write failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return response;
  }

  private async computeWeakMetrics(
    query: WeakMetricsQueryDto,
  ): Promise<WeakMetricsResponseDto> {
    const start = this.resolveStart(query.range);
    const bucket =
      query.bucket === WeakMetricsBucket.WEEK ? 'week' : ('month' as const);

    // One pin PER JUDGE FAMILY. They version independently — drift went to v2
    // for the clienthood labels, language for the dialect_lexicon rubric,
    // groundedness is on its first — so a single pin applied to all three read
    // the language series through drift's version and returned 6 annotations
    // out of 1,782, and would have made a groundedness backfill unreadable.
    const [judge, languageJudge, groundednessJudge] = await Promise.all([
      this.repo.latestDriftJudgeVersion(),
      this.repo.latestLanguageJudgeVersion(),
      this.repo.latestGroundednessJudgeVersion(),
    ]);

    const base: Omit<WeakMetricsFilters, 'judgeModel' | 'judgePromptVersion'> =
      {
        start,
        bucket,
        language: query.language ?? null,
        llmModel: query.llmModel ?? null,
        scenarioId: query.scenarioId ?? null,
        scenarioVersionId: query.scenarioVersionId ?? null,
        promptVersion: query.promptVersion ?? null,
      };

    // `f` stays the drift-pinned tuple: it is what the transcript- and
    // turn-metric-derived queries take too, and those carry no judge version at
    // all, so pinning them to anything is harmless.
    const f: WeakMetricsFilters = {
      ...base,
      judgeModel: judge?.judgeModel ?? null,
      judgePromptVersion: judge?.judgePromptVersion ?? null,
    };
    const fLang: WeakMetricsFilters = {
      ...base,
      judgeModel: languageJudge?.judgeModel ?? null,
      judgePromptVersion: languageJudge?.judgePromptVersion ?? null,
    };
    const fGround: WeakMetricsFilters = {
      ...base,
      judgeModel: groundednessJudge?.judgeModel ?? null,
      judgePromptVersion: groundednessJudge?.judgePromptVersion ?? null,
    };

    const [
      understanding,
      unresponsive,
      rePrompt,
      bargeIn,
      repetition,
      sessionLoop,
      stasis,
      resolution,
      register,
      colloquial,
      lexicon,
      offLanguage,
      fabricatedQuotes,
      groundedness,
      falseNegativeFeedback,
      tone,
      unhealthyScored,
      scorePairs,
      roleSlip,
      roleInversion,
      overCompliance,
      inappropriateStasis,
      counsellorQuestions,
      worstScenarios,
      turnConditions,
      filterOptions,
    ] = await Promise.all([
      this.repo.understandingWeightedTrend(fLang),
      this.repo.unresponsiveTurnTrend(f),
      this.repo.rePromptTrend(f),
      this.repo.bargeInTrend(f),
      this.repo.repetitionTurnTrend(f),
      this.repo.sessionLoopRateTrend(f),
      this.repo.semanticStasisTrend(f),
      this.repo.resolutionTrend(f),
      this.repo.realismWeightedTrend(fLang, 'register'),
      this.repo.realismWeightedTrend(fLang, 'colloquialness'),
      this.repo.realismWeightedTrend(fLang, 'dialect_lexicon'),
      this.repo.offLanguageTurnTrend(f),
      this.repo.fabricatedQuoteTrend(fGround),
      this.repo.groundednessTrend(fGround),
      this.repo.falseNegativeFeedbackTrend(fGround),
      this.repo.feedbackToneTrend(f),
      this.repo.unhealthyScoredTrend(f),
      this.repo.scoreVsLengthPairs(f),
      this.repo.roleSlipTrend(f),
      this.repo.roleInversionTrend(f),
      this.repo.overComplianceTrend(f),
      this.repo.inappropriateStasisTrend(f),
      this.repo.counsellorDirectedQuestionTrend(f),
      this.repo.roleSlipByScenario(f),
      this.repo.turnConditionBreakdown(
        f,
        languageJudge
          ? {
              judgeModel: languageJudge.judgeModel,
              judgePromptVersion: languageJudge.judgePromptVersion,
            }
          : null,
      ),
      this.repo.filterOptions(start),
    ]);

    // Each group's `state` here is a placeholder the DTO requires: it is
    // recomputed from the group's own series just below, so don't tune it.
    const groups: WeakMetricGroupDto[] = [
      {
        id: 'responsiveness',
        label: 'Actor responsiveness',
        description: 'Does the actor answer what was actually said?',
        state: WeakMetricState.PARTIAL,
        series: [
          this.series(
            'understanding',
            'Comprehension errors',
            'per100turns',
            WeakMetricState.MEASURED,
            understanding,
            {
              description:
                'Severity-weighted misunderstandings per 100 judged turns.',
              caveat:
                'Severity-weighted (minor 1 / major 5 / critical 10). Errors on ' +
                'garbled input are excluded — that is the STT’s fault, not the actor’s.',
            },
          ),
          this.series(
            'unresponsive_turns',
            'Misread intent',
            'percent',
            WeakMetricState.MEASURED,
            unresponsive,
            {
              description:
                'Turns that answered the wrong thing, or stayed stuck on older context.',
            },
          ),
          this.series(
            're_prompt',
            'Learner re-prompts',
            'percent',
            WeakMetricState.MEASURED,
            rePrompt,
            {
              description:
                'The learner spoke again after the actor went quiet, rather than being answered.',
              caveat:
                `Counsellor speaks again after >${WEAK_METRICS_PARAMS.rePromptGapSeconds}s ` +
                'of silence. The naive version (no AI turn after) reads 35-59% ' +
                'because STT splits one utterance across rows. Needs startSeconds, ' +
                'so no data before Apr 2026.',
            },
          ),
          this.instrumentedFrom('barge_in', 'Barge-ins', 'percent', bargeIn, {
            description:
              'Turns the learner produced by cutting the actor off mid-sentence.',
            caveat:
              'NO GOOD DIRECTION — do not read a rise as a regression. ' +
              'Interruption is ordinary conversation, and the rate is flat at ' +
              '2.5-2.8% across every actor turn length above 100 characters, ' +
              'dropping to 0.3% only on turns too short to interrupt. It ' +
              'tracks how much opportunity there was to cut in, not whether ' +
              'the actor deserved it. Useful as context on a session, not as ' +
              'a quality verdict. The flag is written by the live worker, so ' +
              'history starts at that deploy.',
            lowerIsBetter: true,
          }),
        ],
      },
      {
        id: 'progression',
        label: 'Conversational progression & resolution',
        description: 'Does the session move forward, and does it arrive?',
        state: WeakMetricState.PARTIAL,
        series: [
          this.series(
            'repetition_turns',
            'Repeated turns',
            'percent',
            WeakMetricState.MEASURED,
            repetition,
            {
              description:
                'Actor turns that repeat something the actor already said.',
              caveat:
                'Segment by model or this misleads: repetition differs 6.6x ' +
                'between models, so an unsegmented spike is usually traffic mix.',
            },
          ),
          this.series(
            'session_loop_rate',
            'Looping sessions',
            'percent',
            WeakMetricState.MEASURED,
            sessionLoop,
            {
              description:
                'Sessions containing a run of three or more repeats in a row.',
              caveat:
                'The line that matches what users report. The turn rate above ' +
                'averages looping sessions away.',
            },
          ),
          this.series(
            'inappropriate_stasis',
            'Stuck turns',
            'percent',
            WeakMetricState.MEASURED,
            inappropriateStasis,
            {
              description:
                'Turns that added nothing AND should have moved — correct resistance excluded.',
              caveat:
                'The appropriate-stuckness exclusion, made real by the v2 judge: turns ' +
                'that added nothing AND should have moved. A client rightly refusing to ' +
                'yield to a weak intervention is excluded — counting those would drive ' +
                'the actor toward agreeableness and make clienthood worse.',
            },
          ),
          this.series(
            'semantic_stasis',
            'Circling sessions',
            'percent',
            WeakMetricState.PARTIAL,
            stasis,
            {
              description:
                'Sessions where consecutive actor turns keep reusing the same words.',
              caveat:
                `Consecutive AI turns sharing >=${WEAK_METRICS_PARAMS.stasisJaccard * 100}% ` +
                'of content words. Exists because the judge label under-detects — ' +
                'it caught 14 of 30 stasis sessions. Threshold is unvalidated: a ' +
                'screen for building the metric, not the metric itself.',
            },
          ),
          this.series(
            'resolution',
            'Resolved sessions',
            'percent',
            WeakMetricState.NONE,
            resolution,
            {
              description:
                'Sessions that reached the end of their scripted arc.',
              caveat:
                'No resolved/unresolved/ruptured classification exists. This shows ' +
                'auto-termination only, which fires a handful of times a month ' +
                'platform-wide — a true reading of an unbuilt capability. Needs ' +
                'state-transition events; not backfillable.',
              lowerIsBetter: false,
            },
          ),
        ],
      },
      {
        id: 'language_realism',
        label: 'Language realism',
        description: 'Does the actor talk like a real person of that profile?',
        state: WeakMetricState.PARTIAL,
        series: [
          this.series(
            'register',
            'Over-formal speech',
            'per100turns',
            WeakMetricState.MEASURED,
            register,
            {
              description:
                'Bookish or written-register phrasing where the brief called for spoken.',
              caveat:
                'Score against the brief, never absolutely — some personas ' +
                'genuinely are formal. The brief-override share is what separates ' +
                'the two.',
            },
          ),
          this.series(
            'colloquialness',
            'Translationese',
            'per100turns',
            WeakMetricState.MEASURED,
            colloquial,
            {
              description:
                'Literal, translated-sounding phrasing no native speaker would produce.',
            },
          ),
          // Deterministic and judge-independent, so it covers all history the
          // moment it ships. It sits beside the judged dimensions because a
          // reader asking "does the actor talk like a real person" needs to
          // know it sometimes does not talk in the right LANGUAGE at all.
          this.series(
            'off_language',
            'Wrong language',
            'percent',
            WeakMetricState.MEASURED,
            offLanguage,
            {
              description:
                'Actor turns with no character of the session script — English, or romanised.',
              caveat:
                'Deterministic: an actor turn containing NO character of the ' +
                'session script — English, or the right language romanised. ' +
                'Only turns long enough to have made a language choice count, ' +
                'and code-mixing is not flagged: "maybe मैं overthink कर रही हूँ" ' +
                'is how people speak. Script fidelity misses these because it ' +
                'tolerates Latin by design, and the codeswitch judge fired once ' +
                'in 429 hi-IN turns. Concentrated in openings stored in the ' +
                'wrong script, so check the scenario before blaming the model.',
            },
          ),
          this.series(
            'dialect_lexicon',
            'Wrong word meanings',
            'per100turns',
            WeakMetricState.MEASURED,
            lexicon,
            {
              description:
                'Words used with a meaning or regional variety they do not carry.',
              caveat:
                'Counted ONLY over languages with a non-Latin script. English ' +
                'has no regional variety to get wrong, and it is two thirds of ' +
                'the corpus — dividing by it made this read near-zero and look ' +
                'blind. Scoped, it runs about 2 per 100 turns in Tamil and ' +
                'Kannada. Hindi reads ~0 because the Devanagari genuinely is ' +
                'clean; what Hindi actually gets wrong is answering in the wrong ' +
                'language entirely, which the series above measures.',
            },
          ),
        ],
      },
      {
        id: 'feedback_groundedness',
        label: 'Feedback groundedness',
        description: 'Is the feedback actually true about the session?',
        state: WeakMetricState.NONE,
        series: [
          this.series(
            'groundedness',
            'Ungrounded feedback',
            'percent',
            WeakMetricState.MEASURED,
            groundedness,
            {
              description:
                'Feedback claims the transcript does not support, contradicts, or misattributes.',
              caveat:
                'Judge verdict per claim: unsupported, contradicted or ' +
                'misattributed against the transcript. Reads empty until the ' +
                'groundedness backfill has run.',
            },
          ),
          this.series(
            'feedback_false_negatives',
            'Unfair criticism',
            'percent',
            WeakMetricState.MEASURED,
            falseNegativeFeedback,
            {
              description:
                'Learners told to improve at something the transcript shows them doing.',
              caveat:
                'Improvement claims the transcript CONTRADICTS — the harmful half. ' +
                'Separated from the rate above because an unearned compliment is a ' +
                'calibration issue, while this is what counsellors described as ' +
                'making them doubt themselves.',
            },
          ),
          this.series(
            'fabricated_quotes',
            'Fabricated quotes',
            'percent',
            WeakMetricState.MEASURED,
            fabricatedQuotes,
            {
              description:
                'Feedback that cites the transcript and cites it wrongly.',
              caveat:
                'Claims that CITE the transcript and cite it wrongly, over ' +
                'claims that cite at all — a claim making no citation cannot ' +
                'fabricate one. This replaces the old quote-match scrape, which ' +
                'regex-extracted double-quoted spans from prose and could see ' +
                'about 2.5% of quoting feedback, because the apostrophe in ' +
                '"client\'s" makes single quotes unparseable. The judge checks ' +
                'every claim instead, which is the upstream fix that caveat ' +
                'asked for.',
            },
          ),
          this.series(
            'unhealthy_scored',
            'Scored while looping',
            'percent',
            WeakMetricState.MEASURED,
            unhealthyScored,
            {
              description:
                'Sessions given a skill score although the actor was stuck in a loop.',
              caveat:
                'The interaction users described as the most damaging: the actor ' +
                'loops, then the learner is marked down for it. Gating scoring on ' +
                'session health is the fix; this is how we watch it land.',
            },
          ),
          this.series(
            'criticism_ratio',
            'Criticism ratio',
            'ratio',
            WeakMetricState.MEASURED,
            tone,
            {
              description:
                'How many improvements the learner receives per compliment.',
              caveat:
                'Improvements ÷ positives. Has exceeded 1.0 every month on record. ' +
                'Widening the score range without moving this makes the harm worse.',
            },
          ),
        ],
      },
      {
        id: 'clienthood',
        label: 'Actor clienthood',
        description:
          'Does the actor stay a client seeking help, or start being helpful?',
        state: WeakMetricState.PARTIAL,
        series: [
          this.series(
            'role_inversion',
            'Role inversion',
            'percent',
            WeakMetricState.MEASURED,
            roleInversion,
            {
              description:
                'Turns where the actor advised the counsellor, or asked about them.',
              caveat:
                'The judge label (v2): the actor asked about the counsellor or advised ' +
                'them. A client asking "what should I do?" is not inversion. Denominator ' +
                'counts only turns carrying the label, so a window still holding v1 rows ' +
                'reports the v2 share of itself rather than diluting.',
            },
          ),
          this.series(
            'over_compliance',
            'Over-compliance',
            'percent',
            WeakMetricState.MEASURED,
            overCompliance,
            {
              description:
                'Sessions where a resistant client solved its own problem unprompted.',
              caveat:
                `Sessions offering more than ${WEAK_METRICS_PARAMS.solutionOfferThreshold} ` +
                'solutions unprompted — a real client offers one or two. Scoped to briefs ' +
                'that call for resistance: a cooperative persona offering ideas is correct ' +
                'portrayal, not a failure. The judge counts; the threshold is set here, so ' +
                'changing it re-reads history rather than re-judging it.',
            },
          ),
          this.series(
            'role_slip',
            'Role slip (legacy)',
            'percent',
            WeakMetricState.PARTIAL,
            roleSlip,
            {
              description:
                'The older, broader label this metric used before role inversion existed.',
              caveat:
                'Superseded by role inversion above. Kept because it is the only line ' +
                'with history before the v2 judge: it also absorbs "too formal", "took ' +
                'the initiative to close" and pronoun errors, so only about one turn in ' +
                'six of it is verified inversion. Do not compare the two directly.',
            },
          ),
          this.series(
            'counsellor_directed_questions',
            'Questions at the counsellor',
            'percent',
            WeakMetricState.PARTIAL,
            counsellorQuestions,
            {
              description:
                'Actor turns that put a question to the counsellor about the counsellor.',
              caveat:
                'Deterministic proxy, English patterns only, and it over-counts — a ' +
                'client may legitimately ask "what should I do?". It ships beside the ' +
                'judge label, not instead of it: the two disagreeing is the signal.',
            },
          ),
        ],
      },
    ];

    for (const g of groups) g.state = this.groupState(g.series);

    return {
      metricsVersion: WEAK_METRICS_VERSION,
      parameters: { ...WEAK_METRICS_PARAMS },
      judgeModel: judge?.judgeModel ?? null,
      judgePromptVersion: judge?.judgePromptVersion ?? null,
      judgeVersions: {
        drift: judge,
        language: languageJudge,
        groundedness: groundednessJudge,
      },
      bucket,
      start: start.toISOString(),
      inProgressBucket: WeakMetricsAnalyticsService.inProgressBucketOf(bucket),
      groups,
      worstScenarios: (worstScenarios ?? []).map((r) => ({
        scenarioId: Number(r.scenarioId),
        title: r.title ?? null,
        language: r.language ?? null,
        sessions: Number(r.sessions ?? 0),
        turns: Number(r.denominator ?? 0),
        slips: Number(r.numerator ?? 0),
        rate:
          Number(r.denominator) > 0
            ? Number(r.numerator) / Number(r.denominator)
            : 0,
      })),
      turnConditions: this.turnConditions(turnConditions),
      scoreLengthCorrelation: this.correlate(scorePairs),
      filterOptions: {
        languages: filterOptions.languages,
        models: filterOptions.models,
        promptVersions: filterOptions.promptVersions,
        scenarios: filterOptions.scenarios.map((s) => ({
          id: Number(s.id),
          title: s.title ?? null,
        })),
      },
    };
  }
}

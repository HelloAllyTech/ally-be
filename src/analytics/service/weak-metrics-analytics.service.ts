import { Injectable } from '@nestjs/common';
import {
  TrendPoint,
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
@Injectable()
export class WeakMetricsAnalyticsService {
  constructor(private readonly repo: WeakMetricsAnalyticsRepository) {}

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
    opts: { caveat?: string | null; lowerIsBetter?: boolean } = {},
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
    opts: { caveat?: string | null; lowerIsBetter?: boolean } = {},
  ): WeakMetricSeriesDto {
    const points = this.toPoints(rows);
    const withValues = points.filter((p) => p.value !== null);
    return {
      id,
      label,
      unit,
      state,
      lowerIsBetter: opts.lowerIsBetter ?? true,
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

  async getWeakMetrics(
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
      quoteMatch,
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
      this.repo.quoteMatchTrend(f),
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
            'Comprehension errors per 100 turns',
            'per100turns',
            WeakMetricState.MEASURED,
            understanding,
            {
              caveat:
                'Severity-weighted (minor 1 / major 5 / critical 10). Errors on ' +
                'garbled input are excluded — that is the STT’s fault, not the actor’s.',
            },
          ),
          this.series(
            'unresponsive_turns',
            'Turns misreading intent or locked on old context',
            'percent',
            WeakMetricState.MEASURED,
            unresponsive,
          ),
          this.series(
            're_prompt',
            'Learner had to re-prompt',
            'percent',
            WeakMetricState.MEASURED,
            rePrompt,
            {
              caveat:
                `Counsellor speaks again after >${WEAK_METRICS_PARAMS.rePromptGapSeconds}s ` +
                'of silence. The naive version (no AI turn after) reads 35-59% ' +
                'because STT splits one utterance across rows. Needs startSeconds, ' +
                'so no data before Apr 2026.',
            },
          ),
          this.instrumentedFrom(
            'barge_in',
            'Turns interrupted by the learner',
            'percent',
            bargeIn,
            {
              caveat:
                'Share of turns the learner produced by cutting the actor off — a ' +
                'high rate means the actor is talking past them. The one metric ' +
                'here that cannot be backfilled: the flag is written by the live ' +
                'worker, so history starts at that deploy and earlier buckets are ' +
                'dropped rather than drawn as zeroes.',
              lowerIsBetter: true,
            },
          ),
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
            'Turns repeating an earlier turn',
            'percent',
            WeakMetricState.MEASURED,
            repetition,
            {
              caveat:
                'Segment by model or this misleads: repetition differs 6.6x ' +
                'between models, so an unsegmented spike is usually traffic mix.',
            },
          ),
          this.series(
            'session_loop_rate',
            `Sessions with a run of ${WEAK_METRICS_PARAMS.loopRunLength}+ consecutive repeats`,
            'percent',
            WeakMetricState.MEASURED,
            sessionLoop,
            {
              caveat:
                'The line that matches what users report. The turn rate above ' +
                'averages looping sessions away.',
            },
          ),
          this.series(
            'inappropriate_stasis',
            'Turns that failed to advance, excluding correct resistance',
            'percent',
            WeakMetricState.MEASURED,
            inappropriateStasis,
            {
              caveat:
                'The appropriate-stuckness exclusion, made real by the v2 judge: turns ' +
                'that added nothing AND should have moved. A client rightly refusing to ' +
                'yield to a weak intervention is excluded — counting those would drive ' +
                'the actor toward agreeableness and make clienthood worse.',
            },
          ),
          this.series(
            'semantic_stasis',
            'Sessions going in circles (judge-independent)',
            'percent',
            WeakMetricState.PARTIAL,
            stasis,
            {
              caveat:
                `Consecutive AI turns sharing >=${WEAK_METRICS_PARAMS.stasisJaccard * 100}% ` +
                'of content words. Exists because the judge label under-detects — ' +
                'it caught 14 of 30 stasis sessions. Threshold is unvalidated: a ' +
                'screen for building the metric, not the metric itself.',
            },
          ),
          this.series(
            'resolution',
            'Sessions reaching a terminal state',
            'percent',
            WeakMetricState.NONE,
            resolution,
            {
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
            'Too formal for spoken register, per 100 turns',
            'per100turns',
            WeakMetricState.MEASURED,
            register,
            {
              caveat:
                'Score against the brief, never absolutely — some personas ' +
                'genuinely are formal. The brief-override share is what separates ' +
                'the two.',
            },
          ),
          this.series(
            'colloquialness',
            'Translationese / literal-translation stilt, per 100 turns',
            'per100turns',
            WeakMetricState.MEASURED,
            colloquial,
          ),
          // Deterministic and judge-independent, so it covers all history the
          // moment it ships. It sits beside the judged dimensions because a
          // reader asking "does the actor talk like a real person" needs to
          // know it sometimes does not talk in the right LANGUAGE at all.
          this.series(
            'off_language',
            'Turns not in the session language at all',
            'percent',
            WeakMetricState.MEASURED,
            offLanguage,
            {
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
            'Wrong or odd word meanings, per 100 turns',
            'per100turns',
            WeakMetricState.NONE,
            lexicon,
            {
              caveat:
                'Treat as UNMEASURED. Two partner orgs name this as their blocking ' +
                'issue while the detector fires on almost nothing — that is a rubric ' +
                'failure, not a low incidence. Fix the rubric before reading this line.',
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
            'Feedback claims the transcript does not bear out',
            'percent',
            WeakMetricState.MEASURED,
            groundedness,
            {
              caveat:
                'Judge verdict per claim: unsupported, contradicted or ' +
                'misattributed against the transcript. Reads empty until the ' +
                'groundedness backfill has run.',
            },
          ),
          this.series(
            'feedback_false_negatives',
            'Learners marked down for work they actually did',
            'percent',
            WeakMetricState.MEASURED,
            falseNegativeFeedback,
            {
              caveat:
                'Improvement claims the transcript CONTRADICTS — the harmful half. ' +
                'Separated from the rate above because an unearned compliment is a ' +
                'calibration issue, while this is what counsellors described as ' +
                'making them doubt themselves.',
            },
          ),
          this.series(
            'quote_match',
            'Feedback quotes not found in the transcript (sample)',
            'percent',
            WeakMetricState.NONE,
            quoteMatch,
            {
              caveat:
                'A SAMPLE, not a rate — do not read it as the fabrication rate. ' +
                'Only double-quoted spans are extractable: of 14,752 feedback items ' +
                'just 172 use double quotes while 6,736 use single quotes, and single ' +
                'quotes cannot be parsed because the apostrophe is the same character ' +
                '("client’s" opens a span). So this sees ~2.5% of quoting feedback. ' +
                'The fix is upstream — have feedback emit a structured evidenceQuote ' +
                'field instead of prose with embedded quotation marks; then the check ' +
                'becomes exact.',
            },
          ),
          this.series(
            'unhealthy_scored',
            'Scored sessions that were actually looping',
            'percent',
            WeakMetricState.MEASURED,
            unhealthyScored,
            {
              caveat:
                'The interaction users described as the most damaging: the actor ' +
                'loops, then the learner is marked down for it. Gating scoring on ' +
                'session health is the fix; this is how we watch it land.',
            },
          ),
          this.series(
            'criticism_ratio',
            'Criticisms per compliment',
            'ratio',
            WeakMetricState.MEASURED,
            tone,
            {
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
            'Turns where the actor took the counsellor’s chair',
            'percent',
            WeakMetricState.MEASURED,
            roleInversion,
            {
              caveat:
                'The judge label (v2): the actor asked about the counsellor or advised ' +
                'them. A client asking "what should I do?" is not inversion. Denominator ' +
                'counts only turns carrying the label, so a window still holding v1 rows ' +
                'reports the v2 share of itself rather than diluting.',
            },
          ),
          this.series(
            'over_compliance',
            'Sessions where the actor solved its own problem',
            'percent',
            WeakMetricState.MEASURED,
            overCompliance,
            {
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
            'Turns flagged role_slip (legacy proxy)',
            'percent',
            WeakMetricState.PARTIAL,
            roleSlip,
            {
              caveat:
                'Superseded by role inversion above. Kept because it is the only line ' +
                'with history before the v2 judge: it also absorbs "too formal", "took ' +
                'the initiative to close" and pronoun errors, so only about one turn in ' +
                'six of it is verified inversion. Do not compare the two directly.',
            },
          ),
          this.series(
            'counsellor_directed_questions',
            'AI turns questioning the counsellor (regex proxy)',
            'percent',
            WeakMetricState.PARTIAL,
            counsellorQuestions,
            {
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

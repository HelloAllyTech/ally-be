import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AnalyticsRange,
  LanguageDimensionDeltaDto,
  LanguageDimensionErrorRateDto,
  LanguageEvalReferenceDto,
  LanguageLayerTrendPointDto,
  LanguageQualityQueryDto,
  LanguageQualityResponseDto,
  LanguageRateByExperimentDto,
  SetLanguageEvalReferenceDto,
} from '../dto/platform-analytics.dto';
import {
  EvalReferenceFilters,
  LanguageAnalyticsFilters,
  LanguageAnalyticsRepository,
} from '../repository/language-analytics.repository';

/** Severity weights — the normative constants from language-eval-judge-schema.md. */
const SEVERITY_WEIGHT: Record<string, number> = {
  minor: 1,
  major: 5,
  critical: 10,
};

/** Layer per dimension (fixed mapping; mirrors ally-ai schemas.DIMENSION_LAYER). */
const DIMENSION_LAYER: Record<string, string> = {
  understanding: 'comprehension',
  adequacy: 'content',
  fluency: 'content',
  coherence: 'content',
  register: 'appropriateness',
  dialect_lexicon: 'appropriateness',
  colloquialness: 'appropriateness',
  persona_social: 'appropriateness',
  codeswitch: 'appropriateness',
};

/** Dimensions whose denominator excludes garbled-input turns (conditioning). */
const CONDITIONED_DIMENSIONS = new Set(['understanding', 'adequacy']);

/**
 * Trailing day counts per range. `all` is deliberately absent: this endpoint
 * measures a rolling window from today rather than resolving one against the
 * platform's data floor, so it cannot answer "all time" — the guard in
 * getLanguageQuality rejects that range instead of quietly returning 90 days.
 */
const RANGE_DAYS: Record<Exclude<AnalyticsRange, 'all'>, number> = {
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Assembles the language-quality dashboard payload: aggregates over the same
 * per-session judgment rows the Roleplay Session Logs detail shows raw.
 * All numbers are pinned to the latest judge version (comparisons across
 * judge versions are invalid — NFR3); categorized weighted error rates only,
 * never a scalar quality score (FR14).
 */
@Injectable()
export class LanguageAnalyticsService {
  constructor(private readonly repo: LanguageAnalyticsRepository) {}

  /** Weighted rate grouped by one experiment dimension (denominator-aware). */
  private async byExperiment(
    filters: LanguageAnalyticsFilters,
    column: 'scenarioVersionId' | 'promptVersion' | 'llmModel',
  ): Promise<LanguageRateByExperimentDto[]> {
    const [totals, weighted] = await Promise.all([
      this.repo.sessionTotalsBy(filters, column),
      this.repo.weightedBy(filters, column),
    ]);
    const weightedByValue = new Map<string, number>();
    for (const row of weighted) {
      const key = row.value ?? 'unknown';
      weightedByValue.set(
        key,
        (weightedByValue.get(key) ?? 0) +
          Number(row.count) * (SEVERITY_WEIGHT[row.severity] ?? 1),
      );
    }
    return totals
      .map((t) => {
        const value = t.value ?? 'unknown';
        const nTurns = Number(t.turns);
        return {
          value,
          sessionsJudged: Number(t.sessions),
          nTurns,
          weightedRatePer100:
            nTurns > 0
              ? round2(((weightedByValue.get(value) ?? 0) / nTurns) * 100)
              : 0,
        };
      })
      .sort((a, b) => b.weightedRatePer100 - a.weightedRatePer100);
  }

  /** The pinned reference experiment (FR13); null when none. */
  async getReference(): Promise<LanguageEvalReferenceDto | null> {
    return this.repo.getPinnedReference();
  }

  /** Pin a reference experiment (unpins the previous one). */
  async setReference(
    body: SetLanguageEvalReferenceDto,
    createdBy?: number,
  ): Promise<LanguageEvalReferenceDto | null> {
    const filters: EvalReferenceFilters = body.filters ?? {};
    const name =
      body.name?.trim() ||
      `reference (${
        Object.entries(filters)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ') || 'all sessions'
      })`;
    await this.repo.setPinnedReference(name, filters, createdBy);
    return this.repo.getPinnedReference();
  }

  /** Per-dimension weighted rates for an arbitrary slice (reference deltas). */
  private async dimensionRatesFor(
    filters: LanguageAnalyticsFilters,
  ): Promise<Map<string, number>> {
    const [totals, counts] = await Promise.all([
      this.repo.sessionTotalsByLanguage(filters),
      this.repo.annotationCounts(filters),
    ]);
    const turnsJudged = totals.reduce((n, t) => n + Number(t.turns), 0);
    const turnsGarbled = totals.reduce(
      (n, t) => n + Number(t.turns_garbled),
      0,
    );
    const weightedByDim = new Map<string, number>();
    for (const row of counts) {
      weightedByDim.set(
        row.dimension,
        (weightedByDim.get(row.dimension) ?? 0) +
          Number(row.count) * (SEVERITY_WEIGHT[row.severity] ?? 1),
      );
    }
    const rates = new Map<string, number>();
    for (const dimension of Object.keys(DIMENSION_LAYER)) {
      const nTurns = CONDITIONED_DIMENSIONS.has(dimension)
        ? Math.max(0, turnsJudged - turnsGarbled)
        : turnsJudged;
      rates.set(
        dimension,
        nTurns > 0
          ? round2(((weightedByDim.get(dimension) ?? 0) / nTurns) * 100)
          : 0,
      );
    }
    return rates;
  }

  async getLanguageQuality(
    query: LanguageQualityQueryDto,
  ): Promise<LanguageQualityResponseDto> {
    // Validated BEFORE the no-judgments early return, so an unsupported range is
    // rejected on its own terms rather than depending on whether the tenant
    // happens to have judged sessions yet.
    const range = query.range ?? '90d';
    if (range === 'all') {
      throw new BadRequestException(
        'range=all is not supported by this endpoint',
      );
    }

    const empty: LanguageQualityResponseDto = {
      judgeModel: null,
      judgePromptVersion: null,
      sessionsJudged: 0,
      turnsJudged: 0,
      turnsGarbled: 0,
      totalWeightedRatePer100: 0,
      errorRateByDimension: [],
      rateByLanguage: [],
      categoryBreakdown: [],
      isolationBasisBreakdown: [],
      errorLog: [],
      languageOverview: [],
      objectiveMetrics: { scriptFidelityPct: null, roundTripWerPct: null },
      layerTrend: [],
      rateByScenarioVersion: [],
      rateByPromptVersion: [],
      rateByModel: [],
      werByVoice: [],
      reference: null,
      deltaByDimension: [],
    };

    const judgeVersion = await this.repo.latestJudgeVersion();
    if (!judgeVersion) return empty;

    const days = RANGE_DAYS[range];
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filters = {
      start,
      language: query.language ?? null,
      ...judgeVersion,
    };

    const [
      totals,
      counts,
      byLanguage,
      isolation,
      errorLog,
      turnsByBucket,
      countsByBucketDim,
      byScenarioVersion,
      byPromptVersion,
      byModel,
      reference,
      werByVoiceRows,
    ] = await Promise.all([
      this.repo.sessionTotalsByLanguage(filters),
      this.repo.annotationCounts(filters),
      this.repo.weightedByLanguage(filters),
      this.repo.isolationBasisCounts(filters),
      this.repo.errorLog(filters),
      this.repo.turnsByBucket(filters),
      this.repo.countsByBucketAndDimension(filters),
      this.byExperiment(filters, 'scenarioVersionId'),
      this.byExperiment(filters, 'promptVersion'),
      this.byExperiment(filters, 'llmModel'),
      this.repo.getPinnedReference(),
      this.repo.roundTripWerByVoice(filters),
    ]);

    // changed_from_prev (FR18): name the config element(s) each scenario
    // version changed vs its parent — the "implicates" attribution.
    const changedByVersion = await this.repo.changedElementsByScenarioVersion(
      byScenarioVersion
        .map((r) => r.value)
        .filter((v): v is string => !!v && v !== 'unknown'),
    );
    const rateByScenarioVersion = byScenarioVersion.map((r) => ({
      ...r,
      changedFromPrev:
        r.value && changedByVersion[r.value] !== undefined
          ? changedByVersion[r.value]
          : undefined,
    }));

    // Reference rates (FR16): same judge version + time window as the current
    // view, with the reference's own slice filters applied. Deltas are
    // computed after the current per-dimension rates exist (below).
    const refRates = reference
      ? await this.dimensionRatesFor({
          start,
          ...judgeVersion,
          language: reference.filters?.language ?? null,
          scenarioVersionId: reference.filters?.scenarioVersionId ?? null,
          promptVersion: reference.filters?.promptVersion ?? null,
          llmModel: reference.filters?.llmModel ?? null,
        })
      : null;

    const sessionsJudged = totals.reduce((n, t) => n + Number(t.sessions), 0);
    const turnsJudged = totals.reduce((n, t) => n + Number(t.turns), 0);
    const turnsGarbled = totals.reduce(
      (n, t) => n + Number(t.turns_garbled),
      0,
    );
    if (sessionsJudged === 0) return { ...empty, ...judgeVersion };

    // --- By dimension: severity-stacked counts + weighted rate --------------
    const byDimension = new Map<
      string,
      {
        minor: number;
        major: number;
        critical: number;
        byCategory: Map<string, number>;
      }
    >();
    for (const row of counts) {
      const d = byDimension.get(row.dimension) ?? {
        minor: 0,
        major: 0,
        critical: 0,
        byCategory: new Map<string, number>(),
      };
      const count = Number(row.count);
      if (row.severity === 'minor') d.minor += count;
      else if (row.severity === 'major') d.major += count;
      else if (row.severity === 'critical') d.critical += count;
      d.byCategory.set(
        row.category,
        (d.byCategory.get(row.category) ?? 0) +
          count * (SEVERITY_WEIGHT[row.severity] ?? 1),
      );
      byDimension.set(row.dimension, d);
    }

    const errorRateByDimension: LanguageDimensionErrorRateDto[] = Object.keys(
      DIMENSION_LAYER,
    ).map((dimension) => {
      const d = byDimension.get(dimension);
      const nTurns = CONDITIONED_DIMENSIONS.has(dimension)
        ? Math.max(0, turnsJudged - turnsGarbled)
        : turnsJudged;
      const weighted = d
        ? d.minor * SEVERITY_WEIGHT.minor +
          d.major * SEVERITY_WEIGHT.major +
          d.critical * SEVERITY_WEIGHT.critical
        : 0;
      let dominantCategory: string | null = null;
      if (d) {
        for (const [cat, w] of d.byCategory) {
          if (
            dominantCategory === null ||
            w > (d.byCategory.get(dominantCategory) ?? 0)
          )
            dominantCategory = cat;
        }
      }
      return {
        dimension,
        layer: DIMENSION_LAYER[dimension],
        nTurns,
        minorCount: d?.minor ?? 0,
        majorCount: d?.major ?? 0,
        criticalCount: d?.critical ?? 0,
        weightedRatePer100: nTurns > 0 ? round2((weighted / nTurns) * 100) : 0,
        dominantCategory,
      };
    });

    const totalWeighted = errorRateByDimension.reduce(
      (n, d) =>
        n +
        d.minorCount * SEVERITY_WEIGHT.minor +
        d.majorCount * SEVERITY_WEIGHT.major +
        d.criticalCount * SEVERITY_WEIGHT.critical,
      0,
    );

    // --- By language ---------------------------------------------------------
    // byLanguage rows are (language, dimension, severity, count): total
    // weighted per language plus each language's worst dimension.
    const weightedPerLanguage = new Map<string, number>();
    const weightedPerLanguageDim = new Map<string, Map<string, number>>();
    for (const row of byLanguage) {
      const key = row.language ?? 'unknown';
      const weighted = Number(row.count) * (SEVERITY_WEIGHT[row.severity] ?? 1);
      weightedPerLanguage.set(
        key,
        (weightedPerLanguage.get(key) ?? 0) + weighted,
      );
      const dims = weightedPerLanguageDim.get(key) ?? new Map<string, number>();
      dims.set(row.dimension, (dims.get(row.dimension) ?? 0) + weighted);
      weightedPerLanguageDim.set(key, dims);
    }
    const rateByLanguage = totals
      .map((t) => {
        const language = t.language ?? 'unknown';
        const nTurns = Number(t.turns);
        return {
          language,
          sessionsJudged: Number(t.sessions),
          nTurns,
          weightedRatePer100:
            nTurns > 0
              ? round2(
                  ((weightedPerLanguage.get(language) ?? 0) / nTurns) * 100,
                )
              : 0,
        };
      })
      .sort((a, b) => b.weightedRatePer100 - a.weightedRatePer100);

    // Per-language performance overview — the tab's default view. One row per
    // language: rate, objective metrics, worst dimension. Aggregates only;
    // per-session detail lives in session logs.
    const languageOverview = totals
      .map((t) => {
        const language = t.language ?? 'unknown';
        const nTurns = Number(t.turns);
        const dims = weightedPerLanguageDim.get(language);
        let worstDimension: string | null = null;
        let worstWeighted = 0;
        if (dims) {
          for (const [dimension, weighted] of dims) {
            if (weighted > worstWeighted) {
              worstWeighted = weighted;
              worstDimension = dimension;
            }
          }
        }
        return {
          language,
          sessionsJudged: Number(t.sessions),
          nTurns,
          weightedRatePer100:
            nTurns > 0
              ? round2(
                  ((weightedPerLanguage.get(language) ?? 0) / nTurns) * 100,
                )
              : 0,
          scriptFidelityPct:
            t.script_fidelity == null
              ? null
              : round2(Number(t.script_fidelity)),
          roundTripWerPct:
            t.round_trip_wer == null ? null : round2(Number(t.round_trip_wer)),
          garbledInputPct:
            nTurns > 0 ? round2((Number(t.turns_garbled) / nTurns) * 100) : 0,
          worstDimension,
          worstDimensionRatePer100:
            nTurns > 0 ? round2((worstWeighted / nTurns) * 100) : 0,
        };
      })
      .sort((a, b) => b.weightedRatePer100 - a.weightedRatePer100);

    // --- Categories ----------------------------------------------------------
    const byCategory = new Map<string, { count: number; weighted: number }>();
    for (const row of counts) {
      const key = `${row.dimension}\u0000${row.category}`;
      const cur = byCategory.get(key) ?? { count: 0, weighted: 0 };
      cur.count += Number(row.count);
      cur.weighted += Number(row.count) * (SEVERITY_WEIGHT[row.severity] ?? 1);
      byCategory.set(key, cur);
    }
    const categoryBreakdown = [...byCategory.entries()]
      .map(([key, v]) => {
        const [dimension, category] = key.split('\u0000');
        return { dimension, category, ...v };
      })
      .sort((a, b) => b.weighted - a.weighted);

    // --- Per-layer trend (FR10 isolation check), weekly buckets -------------
    const turnsPerBucket = new Map<string, number>();
    for (const row of turnsByBucket) {
      turnsPerBucket.set(
        new Date(row.bucket).toISOString().slice(0, 10),
        Number(row.turns),
      );
    }
    const weightedPerBucketLayer = new Map<string, number>();
    for (const row of countsByBucketDim) {
      const bucket = new Date(row.bucket).toISOString().slice(0, 10);
      const layer = DIMENSION_LAYER[row.dimension];
      if (!layer) continue;
      const key = `${bucket}|${layer}`;
      weightedPerBucketLayer.set(
        key,
        (weightedPerBucketLayer.get(key) ?? 0) +
          Number(row.count) * (SEVERITY_WEIGHT[row.severity] ?? 1),
      );
    }
    const layerTrend: LanguageLayerTrendPointDto[] = [];
    const layers = ['comprehension', 'content', 'appropriateness'];
    for (const [bucket, nTurns] of [...turnsPerBucket.entries()].sort()) {
      for (const layer of layers) {
        const weighted = weightedPerBucketLayer.get(`${bucket}|${layer}`) ?? 0;
        layerTrend.push({
          bucket,
          layer,
          nTurns,
          weightedRatePer100:
            nTurns > 0 ? round2((weighted / nTurns) * 100) : 0,
        });
      }
    }

    // --- Objective metrics (Phase 2 fills these; null = masked, not fine) ---
    const fidelityValues = totals
      .map((t) => t.script_fidelity)
      .filter((v) => v != null)
      .map(Number);
    const scriptFidelityPct = fidelityValues.length
      ? round2(
          fidelityValues.reduce((a, b) => a + b, 0) / fidelityValues.length,
        )
      : null;
    const werValues = totals
      .map((t) => t.round_trip_wer)
      .filter((v) => v != null)
      .map(Number);
    const roundTripWerPct = werValues.length
      ? round2(werValues.reduce((a, b) => a + b, 0) / werValues.length)
      : null;

    const deltaByDimension: LanguageDimensionDeltaDto[] = refRates
      ? errorRateByDimension.map((d) => {
          const referenceRatePer100 = refRates.get(d.dimension) ?? 0;
          return {
            dimension: d.dimension,
            referenceRatePer100,
            delta: round2(d.weightedRatePer100 - referenceRatePer100),
          };
        })
      : [];

    return {
      ...judgeVersion,
      sessionsJudged,
      turnsJudged,
      turnsGarbled,
      totalWeightedRatePer100:
        turnsJudged > 0 ? round2((totalWeighted / turnsJudged) * 100) : 0,
      errorRateByDimension,
      rateByLanguage,
      languageOverview,
      categoryBreakdown,
      objectiveMetrics: { scriptFidelityPct, roundTripWerPct },
      layerTrend,
      rateByScenarioVersion,
      rateByPromptVersion: byPromptVersion,
      rateByModel: byModel,
      werByVoice: werByVoiceRows.map((r) => ({
        voiceId: r.voice_id,
        voiceName: r.voice_name,
        sessions: Number(r.sessions),
        avgRoundTripWerPct: round2(Number(r.avg_wer)),
      })),
      reference,
      deltaByDimension,
      isolationBasisBreakdown: isolation
        .map((r) => ({ basis: r.basis ?? 'unknown', count: Number(r.count) }))
        .sort((a, b) => b.count - a.count),
      errorLog: errorLog.map((r) => ({
        scenarioSessionId: r.scenario_session_id,
        turnIndex: Number(r.turn_index),
        language: r.language,
        dimension: r.dimension,
        category: r.category,
        severity: r.severity,
        isolationBasis: r.isolation_basis,
        evidenceQuote: r.evidence_quote,
        reasoning: r.reasoning,
        aiText: r.ai_text,
        occurredAt: r.occurred_at,
      })),
    };
  }
}

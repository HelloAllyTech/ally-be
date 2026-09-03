import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Granularities this endpoint will truncate to. */
export type FillerBucket = 'day' | 'week' | 'month' | 'year';

/**
 * Read surface over the thinking-filler judge's rows.
 *
 * Rates are computed HERE, at read time, from the finding rows plus the
 * session-row denominators — never stored. That is the same rule the language
 * judge follows, and it is what lets a weighting or a threshold change without
 * re-judging the corpus.
 *
 * The denominator is played fillers, not sessions and not turns. A session that
 * played forty fillers and a session that played two are not comparable units,
 * and the whole point of the eval is per-utterance quality.
 */
@Injectable()
export class FillerAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Finding rates per 100 played fillers, bucketed by day.
   *
   * `conditionedOut` findings are excluded from the model-facing rates: those
   * are fillers marked generic on a character the scenario never gave a voice
   * to, which is a configuration gap. Counting them would make a push to
   * configure more scenarios look like a model regression. They are surfaced
   * separately so the configuration gap stays visible rather than vanishing.
   */
  async findingRates(opts: {
    since: string;
    until: string;
    bucket?: FillerBucket;
    language?: string;
    scenarioId?: number;
  }): Promise<
    {
      bucket: string;
      fillersJudged: number;
      characterFitPer100: number | null;
      contextFitPer100: number | null;
      safetyPer100: number | null;
      unconfiguredStylePer100: number | null;
      repeatedPct: number | null;
      distinctPhraseRatio: number | null;
    }[]
  > {
    const params: any[] = [opts.since, opts.until];
    let filter = '';
    if (opts.language) {
      params.push(opts.language);
      filter += ` AND j."language" = $${params.length}`;
    }
    if (opts.scenarioId != null) {
      params.push(opts.scenarioId);
      filter += ` AND j."scenarioId" = $${params.length}`;
    }
    // Whitelisted before interpolation. `bucket` reaches here from a query
    // string, and it is the one part of this SQL that is not a bound
    // parameter.
    const trunc = this.resolveBucket(opts.bucket);

    return this.dataSource.query(
      `WITH sessions AS (
         SELECT j.id,
                to_char(date_trunc('${trunc}', j."occurredAt"), 'YYYY-MM-DD')
                  AS bucket,
                j."fillersJudged",
                j."repeatedFillers",
                j."distinctPhraseRatio"
           FROM filler_judgment_sessions j
          WHERE j."occurredAt" >= $1 AND j."occurredAt" <= $2${filter}
       ),
       findings AS (
         SELECT a."sessionJudgmentId",
                COUNT(*) FILTER (
                  WHERE a."dimension" = 'character_fit'
                    AND NOT a."conditionedOut") AS character_fit,
                COUNT(*) FILTER (
                  WHERE a."dimension" = 'context_fit'
                    AND NOT a."conditionedOut") AS context_fit,
                COUNT(*) FILTER (
                  WHERE a."dimension" = 'safety'
                    AND NOT a."conditionedOut") AS safety,
                COUNT(*) FILTER (WHERE a."conditionedOut") AS unconfigured_style
           FROM filler_finding_annotations a
          GROUP BY a."sessionJudgmentId"
       )
       SELECT s.bucket,
              SUM(s."fillersJudged")::int AS "fillersJudged",
              CASE WHEN SUM(s."fillersJudged") > 0
                   THEN ROUND(100.0 * SUM(COALESCE(f.character_fit, 0))
                              / SUM(s."fillersJudged"), 2)
              END AS "characterFitPer100",
              CASE WHEN SUM(s."fillersJudged") > 0
                   THEN ROUND(100.0 * SUM(COALESCE(f.context_fit, 0))
                              / SUM(s."fillersJudged"), 2)
              END AS "contextFitPer100",
              CASE WHEN SUM(s."fillersJudged") > 0
                   THEN ROUND(100.0 * SUM(COALESCE(f.safety, 0))
                              / SUM(s."fillersJudged"), 2)
              END AS "safetyPer100",
              CASE WHEN SUM(s."fillersJudged") > 0
                   THEN ROUND(100.0 * SUM(COALESCE(f.unconfigured_style, 0))
                              / SUM(s."fillersJudged"), 2)
              END AS "unconfiguredStylePer100",
              CASE WHEN SUM(s."fillersJudged") > 0
                   THEN ROUND(100.0 * SUM(s."repeatedFillers")
                              / SUM(s."fillersJudged"), 2)
              END AS "repeatedPct",
              ROUND(AVG(s."distinctPhraseRatio")::numeric, 4)
                AS "distinctPhraseRatio"
         FROM sessions s
         LEFT JOIN findings f ON f."sessionJudgmentId" = s.id
        GROUP BY s.bucket
        ORDER BY s.bucket`,
      params,
    );
  }

  /**
   * Whitelist the granularity before it is interpolated into SQL.
   *
   * Anything unrecognised becomes `day` rather than throwing: this is the
   * bucketing of a chart, so a stale client sending an unknown value should
   * get the finest honest granularity, not an error page.
   */
  private resolveBucket(bucket?: FillerBucket): FillerBucket {
    if (bucket === 'week') return 'week';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'day';
  }

  /**
   * Finding rates split by where the phrase came from.
   *
   * This is the one slice that settles an open design question. `in_turn` is
   * the only generation path that had seen the learner's current utterance, and
   * it costs an extra LLM call per turn to get that. If its context_fit finding
   * rate is not measurably lower than the others', the path is not earning its
   * cost and should be turned off.
   */
  async findingRatesBySource(opts: {
    since: string;
    until: string;
    language?: string;
  }): Promise<
    {
      source: string;
      findings: number;
      contextFitFindings: number;
      characterFitFindings: number;
    }[]
  > {
    const params: any[] = [opts.since, opts.until];
    let filter = '';
    if (opts.language) {
      params.push(opts.language);
      filter += ` AND a."language" = $${params.length}`;
    }
    return this.dataSource.query(
      `SELECT COALESCE(a."source", 'unknown') AS source,
              COUNT(*)::int AS findings,
              COUNT(*) FILTER (WHERE a."dimension" = 'context_fit')::int
                AS "contextFitFindings",
              COUNT(*) FILTER (WHERE a."dimension" = 'character_fit')::int
                AS "characterFitFindings"
         FROM filler_finding_annotations a
        WHERE a."occurredAt" >= $1 AND a."occurredAt" <= $2${filter}
          AND NOT a."conditionedOut"
        GROUP BY COALESCE(a."source", 'unknown')
        ORDER BY findings DESC`,
      params,
    );
  }
}

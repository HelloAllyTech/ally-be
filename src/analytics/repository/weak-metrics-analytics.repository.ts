import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  excludeTestTenants,
  excludeTestTenantsBySession,
} from '../util/test-tenant.util';
import {
  languageCheckEligibleSql,
  offLanguageSql,
} from '../util/off-language.util';

/**
 * Slice tuple for the Weak Performing Metrics tab. Every query in here accepts
 * the same shape so a reader can hold one filter bar over five metrics that
 * come from four different tables.
 */
export interface WeakMetricsFilters {
  start: Date;
  /** Week or month bucket for every trend series. */
  bucket: 'week' | 'month';
  language?: string | null;
  llmModel?: string | null;
  scenarioId?: number | null;
  scenarioVersionId?: string | null;
  /**
   * Main-agent prompt version — the slice you want when the question is "did
   * the prompt change fix it?". Distinct from `judgePromptVersion` below, which
   * versions the RUBRIC rather than the product.
   */
  promptVersion?: string | null;
  /** Judge pin — mixing judge versions makes rates incomparable (NFR3). */
  judgeModel?: string | null;
  judgePromptVersion?: string | null;
}

export interface TrendPoint {
  bucket: string;
  numerator: number;
  denominator: number;
}

export interface BreakdownRow {
  key: string;
  numerator: number;
  denominator: number;
}

/**
 * A session's main-agent prompt version, read from
 * `scenario_sessions.metadata->'promptVersions'` — a map of prompt code to
 * version, since a session renders several prompts.
 *
 * This MIRRORS `mainPromptVersion()` in drift-judge.repository.ts, which stamps
 * the same value onto every judgment row: prefer the main-agent/base-role
 * prompt, else fall back to whichever entry comes first. The two must agree,
 * because a judge-derived series filters on the stored column while a
 * transcript-derived one filters through this expression, and a reader
 * comparing them across one filter selection would otherwise be comparing
 * different populations.
 *
 * The fallback branch is the one place they can disagree: "first entry" is
 * insertion order in JS and key order in `jsonb_each` (length, then bytewise).
 * It only bites for a session whose map has no main-agent key at all, which is
 * why the preferred branch is tried first rather than relying on ordering.
 */
function mainPromptVersionSql(sessionAlias: string): string {
  const entries = `jsonb_each_text(${sessionAlias}.metadata->'promptVersions')`;
  return `COALESCE(
    (SELECT value FROM ${entries} AS pv(key, value)
      WHERE pv.key LIKE '%main_agent%' OR pv.key LIKE '%base_role%' LIMIT 1),
    (SELECT value FROM ${entries} AS pv(key, value) LIMIT 1)
  )`;
}

/**
 * Languages whose script is NOT Latin — the only ones where "wrong regional
 * variety" or "wrong word sense" is a question that can be asked. Mirrors the
 * keys of TARGET_SCRIPT_RANGES in off-language.util.ts.
 */
const NON_LATIN_SCRIPT_LANGS = [
  'hi',
  'mr',
  'bn',
  'as',
  'pa',
  'gu',
  'or',
  'ta',
  'te',
  'kn',
  'ml',
  'ur',
];

/** Severity -> weight. Applied HERE, never asked of the judge. */
const SEVERITY_WEIGHT_SQL = `CASE a."severity"
  WHEN 'minor' THEN 1 WHEN 'major' THEN 5 WHEN 'critical' THEN 10 ELSE 1 END`;

/**
 * ---------------------------------------------------------------------------
 * Deterministic parameters. These are the metric's definition, not tuning
 * knobs: change one and every historical point silently moves.
 *
 * Treat an edit here exactly like a judge-prompt change — bump
 * WEAK_METRICS_VERSION so a shift in a chart can be told apart from a shift in
 * the product. The version is returned with every payload and rendered in the
 * tab header.
 * ---------------------------------------------------------------------------
 */
export const WEAK_METRICS_PARAMS = {
  /** Learner speaks again after N seconds of agent silence => a re-prompt. */
  rePromptGapSeconds: 3,
  /** Consecutive repeating AI turns that constitute a "stuck loop". */
  loopRunLength: 3,
  /** Content-word overlap between consecutive AI turns that counts as stale. */
  stasisJaccard: 0.5,
  /** Stale consecutive pairs in a session before it counts as stasis. */
  stasisMinPairs: 2,
  /** Min comparable pairs for a session to be eligible for the stasis test. */
  stasisMinComparablePairs: 4,
  /** Word length above which a token counts as a content word. */
  stasisMinWordLength: 4,
  /** A real client offers one or two solutions; above this is over-compliance. */
  solutionOfferThreshold: 2,
} as const;

export const WEAK_METRICS_VERSION = 'v1';

/**
 * Read-side aggregations for the Weak Performing Metrics tab and for the
 * per-session panel in Roleplay Session Logs — one write path, two read
 * surfaces, same as language-analytics.
 *
 * Division of labour, enforced by construction: the LLM judges emit only
 * booleans, enum labels and counts (see ally-ai/app/core/drift/schemas.py);
 * every rate, weight, ratio and correlation below is computed in SQL from those
 * labels. Nothing here asks a model for a number.
 *
 * Each method returns raw numerator/denominator pairs rather than a percentage
 * so the caller can re-bucket, and so a zero denominator renders as "no data"
 * instead of a misleading 0%.
 *
 * MIX WARNING, and the reason every method takes the same filters: three
 * separate findings in this data turned out to be composition artefacts rather
 * than regressions (branching fire rate, role_slip by language, hi-IN latency
 * across a prompt version). A single global trend line here would reproduce all
 * three. Callers should always offer model / language / scenario segmentation.
 */
@Injectable()
export class WeakMetricsAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Most recent judge version per judge FAMILY.
   *
   * Three judges write here and they version independently: drift went to v2
   * when the clienthood labels were added, language when the dialect_lexicon
   * rubric was widened, groundedness is on its first rubric. There was never a
   * reason those numbers should refer to the same thing.
   *
   * A single pin across all three was a real bug, not a simplification. It
   * resolved to drift's version and then filtered the OTHER tables by it, so
   * the language series read the 6 annotations that happened to be v2 and
   * ignored 1,776 under v1 — and a groundedness backfill would have written
   * rows nothing could read, because those land under the groundedness judge's
   * own version.
   *
   * Ordered by `updatedAt` rather than by version string: versions are opaque
   * labels, not sortable values, and "latest" means most recently written.
   */
  private async latestVersionIn(
    table: string,
  ): Promise<{ judgeModel: string; judgePromptVersion: string } | null> {
    const rows = await this.dataSource.query(
      `SELECT j."judgeModel" AS judge_model,
              j."judgePromptVersion" AS judge_prompt_version
         FROM ${table} j
        WHERE ${excludeTestTenants('j."tenant_id"')}
        ORDER BY j."updatedAt" DESC LIMIT 1`,
    );
    if (!rows?.length) return null;
    return {
      judgeModel: rows[0].judge_model,
      judgePromptVersion: rows[0].judge_prompt_version,
    };
  }

  async latestDriftJudgeVersion() {
    return this.latestVersionIn('turn_drift_judgment');
  }

  /** Denominator table, not the annotations: a clean session has a row here and no annotations. */
  async latestLanguageJudgeVersion() {
    return this.latestVersionIn('language_judgment_sessions');
  }

  async latestGroundednessJudgeVersion() {
    return this.latestVersionIn('feedback_claim_judgment');
  }

  /**
   * Shared dimension predicate for the two judgment tables, both of which carry
   * the same denormalised slice columns.
   */
  private judgmentWhere(
    alias: string,
    f: WeakMetricsFilters,
    params: unknown[],
    opts: { pinJudge?: boolean; promptVersionVia?: 'column' | 'session' } = {},
  ): string {
    params.push(f.start);
    let where = `COALESCE(${alias}."occurredAt", ${alias}."createdAt") >= $${params.length}
      AND ${excludeTestTenants(`${alias}."tenant_id"`)}`;

    if (opts.pinJudge !== false && f.judgeModel && f.judgePromptVersion) {
      params.push(f.judgeModel);
      where += ` AND ${alias}."judgeModel" = $${params.length}`;
      params.push(f.judgePromptVersion);
      where += ` AND ${alias}."judgePromptVersion" = $${params.length}`;
    }

    const dims: Array<[string, unknown]> = [
      ['language', f.language],
      ['llmModel', f.llmModel],
      ['scenarioId', f.scenarioId],
      ['scenarioVersionId', f.scenarioVersionId],
    ];
    for (const [column, value] of dims) {
      if (value !== null && value !== undefined && value !== '') {
        params.push(value);
        where += ` AND ${alias}."${column}" = $${params.length}`;
      }
    }

    // The drift and language judges stamp `promptVersion` onto every row, so
    // they filter on the column. feedback_claim_judgment does not carry it and
    // reaches the same value through its session — same population either way,
    // because both derive from the session's promptVersions map.
    if (f.promptVersion) {
      if (opts.promptVersionVia === 'session') {
        where += this.sessionScopedFilter(
          `${alias}."scenarioSessionId"`,
          {
            ...f,
            language: null,
            llmModel: null,
            scenarioId: null,
            scenarioVersionId: null,
          },
          params,
        );
      } else {
        params.push(f.promptVersion);
        where += ` AND ${alias}."promptVersion" = $${params.length}`;
      }
    }

    return where;
  }

  private bucketExpr(alias: string, f: WeakMetricsFilters): string {
    return `date_trunc('${f.bucket}', COALESCE(${alias}."occurredAt", ${alias}."createdAt"))`;
  }

  /**
   * The same slice, for a table that has no denormalised dimension columns of
   * its own — transcripts, feedback, turn metrics. Every dimension is reached
   * through the owning session, so one filter bar governs the whole tab.
   *
   * This exists because the alternative is worse in a specific way: a chart
   * that quietly ignores the filter above it doesn't look broken, it looks like
   * a finding. Any series that cannot honour a dimension must say so, and the
   * ones here all can.
   *
   * `language` and `llmModel` are properties of the turns, not the session row,
   * so they are matched against the session's turn metrics.
   */
  private sessionScopedFilter(
    sessionIdExpr: string,
    f: WeakMetricsFilters,
    params: unknown[],
  ): string {
    let filter = '';

    const turnDims: Array<[string, unknown]> = [
      ['language', f.language],
      ['llmModel', f.llmModel],
      ['scenarioId', f.scenarioId],
    ];
    for (const [column, value] of turnDims) {
      if (value !== null && value !== undefined && value !== '') {
        params.push(value);
        filter += ` AND EXISTS (SELECT 1 FROM scenario_session_turn_metrics tm
           WHERE tm."scenarioSessionId" = ${sessionIdExpr}
             AND tm."${column}" = $${params.length})`;
      }
    }

    if (f.scenarioVersionId) {
      params.push(f.scenarioVersionId);
      filter += ` AND EXISTS (SELECT 1 FROM scenario_sessions ss
         WHERE ss.id = ${sessionIdExpr}
           AND ss."scenarioVersionId" = $${params.length}::uuid)`;
    }

    if (f.promptVersion) {
      params.push(f.promptVersion);
      filter += ` AND EXISTS (SELECT 1 FROM scenario_sessions sp
         WHERE sp.id = ${sessionIdExpr}
           AND ${mainPromptVersionSql('sp')} = $${params.length})`;
    }

    return filter;
  }

  // =========================================================================
  // 1. ACTOR RESPONSIVENESS
  // =========================================================================

  /**
   * Judge-labelled comprehension failures, severity-weighted per 100 AI turns.
   *
   * Numerator = Σ severity weights over `understanding` annotations that were
   * not conditioned out (an understanding error on a garbled-input turn is the
   * STT's fault, not the actor's — the judge flags it and we exclude it here).
   * Denominator = AI turns judged in the same window.
   */
  async understandingWeightedTrend(
    f: WeakMetricsFilters,
  ): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const annWhere = this.judgmentWhere('a', f, params);
    // The denominator subquery builds its own $n sequence starting at 1, so it
    // is renumbered to continue after the numerator's before the two are
    // concatenated into one statement.
    const denParams: unknown[] = [];
    const sessWhere = this.shiftPlaceholders(
      this.judgmentWhere('s', f, denParams),
      params.length,
    );

    return this.dataSource.query(
      `WITH num AS (
         SELECT ${this.bucketExpr('a', f)} AS bucket,
                SUM(${SEVERITY_WEIGHT_SQL}) AS weighted
           FROM language_error_annotations a
          WHERE ${annWhere}
            AND a."dimension" = 'understanding'
            AND a."conditionedOut" = false
          GROUP BY 1
       ), den AS (
         SELECT ${this.bucketExpr('s', f)} AS bucket,
                SUM(s."turnsJudged") AS turns
           FROM language_judgment_sessions s
          WHERE ${sessWhere}
          GROUP BY 1
       )
       SELECT to_char(den.bucket, 'YYYY-MM-DD') AS bucket,
              COALESCE(num.weighted, 0)::float AS numerator,
              den.turns::float AS denominator
         FROM den LEFT JOIN num ON num.bucket = den.bucket
        WHERE den.turns > 0
        ORDER BY den.bucket`,
      [...params, ...denParams],
    );
  }

  /**
   * Renumber `$n` placeholders in a fragment that was built against its own
   * parameter array, so it can be appended after another fragment's parameters.
   * Descending order matters: rewriting $1 -> $4 before $2 would otherwise
   * rewrite the freshly-written $4 again on a later pass.
   */
  private shiftPlaceholders(fragment: string, offset: number): string {
    if (offset === 0) return fragment;
    return fragment.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + offset}`);
  }

  /**
   * Share of AI turns the drift judge labelled with an unresponsive failure
   * mode (`wrong_intent` = misread this turn, `context_lockin` = stuck on an
   * earlier state). Denominator is every judged turn, so this is directly
   * comparable across windows.
   */
  async unresponsiveTurnTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    return this.dataSource.query(
      `SELECT to_char(${this.bucketExpr('j', f)}, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (
                WHERE j."aiReplyFailureMode" IN ('wrong_intent', 'context_lockin')
              )::float AS numerator,
              COUNT(*)::float AS denominator
         FROM turn_drift_judgment j
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Re-prompt rate — the deterministic half of responsiveness, and the only
   * measure here that reflects what the LEARNER had to do.
   *
   * A counsellor turn followed by another counsellor turn after more than
   * `rePromptGapSeconds` of silence means the learner spoke, got nothing, and
   * spoke again.
   *
   * Deliberately NOT "a counsellor turn with no AI turn after it": that reads
   * 35-59% because STT splits one spoken utterance across several rows. The
   * gap threshold is what makes this a metric rather than a transcript
   * artefact.
   *
   * Needs `startSeconds` / `endSeconds`, which only began populating in
   * Apr 2026 — earlier buckets return no rows rather than a false zero.
   */
  async rePromptTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [f.start, WEAK_METRICS_PARAMS.rePromptGapSeconds];
    const sessionFilter = this.sessionScopedFilter(
      'm."scenarioSessionId"',
      f,
      params,
    );

    return this.dataSource.query(
      `WITH ordered AS (
         SELECT m."scenarioSessionId" AS sid,
                m."createdAt" AS ts,
                (m."senderId" = -1) AS is_ai,
                m."startSeconds" AS ss,
                m."endSeconds" AS es,
                ROW_NUMBER() OVER (
                  PARTITION BY m."scenarioSessionId"
                  ORDER BY COALESCE(m."startSeconds", 0), m."createdAt", m.id
                ) AS rn
           FROM scenario_session_messages m
          WHERE m."createdAt" >= $1
            AND m."startSeconds" IS NOT NULL
            AND ${excludeTestTenantsBySession('m."scenarioSessionId"')}
            ${sessionFilter}
       ), paired AS (
         SELECT o.*,
                LEAD(o.is_ai) OVER (PARTITION BY o.sid ORDER BY o.rn) AS next_is_ai,
                LEAD(o.ss) OVER (PARTITION BY o.sid ORDER BY o.rn) AS next_ss
           FROM ordered o
       )
       SELECT to_char(date_trunc('${f.bucket}', ts), 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (
                WHERE NOT is_ai AND next_is_ai IS FALSE AND (next_ss - es) > $2
              )::float AS numerator,
              COUNT(*) FILTER (WHERE NOT is_ai)::float AS denominator
         FROM paired
        GROUP BY 1 HAVING COUNT(*) FILTER (WHERE NOT is_ai) > 0
        ORDER BY 1`,
      params,
    );
  }

  /**
   * Barge-in rate: share of turns the learner produced by cutting the actor off.
   *
   * `interrupted` is written by ally-ai-learn's playback-finished handler, which
   * means a bucket predating that deploy reads a true zero out of a full
   * denominator — "not recorded", not "never happened". The two cases are
   * indistinguishable in SQL, so the service drops the leading all-zero buckets
   * rather than drawing them (see `instrumentedFrom`). Raw rows are returned
   * untrimmed here so manual queries see the whole window.
   *
   * `source = 'pipeline'` excludes transcript-backfilled rows, which have no
   * live handler behind them and could only ever contribute a zero.
   */
  async bargeInTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [f.start];
    let where = `tm."occurredAt" >= $1 AND tm.source = 'pipeline'
      AND ${excludeTestTenantsBySession('tm."scenarioSessionId"')}`;
    // Turn metrics carry language/model/scenario on the row itself; only the
    // prompt version has to be reached through the session.
    const dims: Array<[string, unknown]> = [
      ['language', f.language],
      ['llmModel', f.llmModel],
      ['scenarioId', f.scenarioId],
    ];
    for (const [column, value] of dims) {
      if (value !== null && value !== undefined && value !== '') {
        params.push(value);
        where += ` AND tm."${column}" = $${params.length}`;
      }
    }
    where += this.sessionScopedFilter(
      'tm."scenarioSessionId"',
      {
        ...f,
        language: null,
        llmModel: null,
        scenarioId: null,
      },
      params,
    );
    return this.dataSource.query(
      `SELECT to_char(date_trunc('${f.bucket}', tm."occurredAt"), 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE tm."interrupted")::float AS numerator,
              COUNT(*)::float AS denominator
         FROM scenario_session_turn_metrics tm
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  // =========================================================================
  // 2. CONVERSATIONAL PROGRESSION AND RESOLUTION
  // =========================================================================

  /** Share of judged AI turns labelled `repetition`. */
  async repetitionTurnTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    return this.dataSource.query(
      `SELECT to_char(${this.bucketExpr('j', f)}, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE j."aiReplyFailureMode" = 'repetition')::float AS numerator,
              COUNT(*)::float AS denominator
         FROM turn_drift_judgment j
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Session-level loop rate: share of sessions containing a RUN of
   * `loopRunLength` or more consecutive repeating AI turns.
   *
   * This is the line that matches what users report. The flat turn-rate above
   * averages looping sessions away — a session that loops ten turns straight
   * and a session with one isolated repeat land in the same number.
   *
   * Runs are found with the classic gaps-and-islands trick: for consecutive
   * rows sharing a flag, (turnIndex - row_number()) is constant within a run.
   */
  async sessionLoopRateTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    params.push(WEAK_METRICS_PARAMS.loopRunLength);
    const runLenParam = `$${params.length}`;

    return this.dataSource.query(
      `WITH turns AS (
         SELECT j."scenarioSessionId" AS sid,
                j."turnIndex" AS ti,
                (j."aiReplyFailureMode" = 'repetition') AS rep,
                ${this.bucketExpr('j', f)} AS bucket
           FROM turn_drift_judgment j
          WHERE ${where}
       ), islands AS (
         SELECT sid, bucket, rep, ti,
                ti - ROW_NUMBER() OVER (PARTITION BY sid, rep ORDER BY ti) AS grp
           FROM turns
       ), runs AS (
         SELECT sid, MIN(bucket) AS bucket, COUNT(*) AS run_len
           FROM islands WHERE rep GROUP BY sid, grp
       ), per_session AS (
         SELECT sid, MAX(run_len) AS longest FROM runs GROUP BY sid
       ), sessions AS (
         SELECT sid, MIN(bucket) AS bucket FROM turns GROUP BY sid
       )
       SELECT to_char(s.bucket, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE p.longest >= ${runLenParam})::float AS numerator,
              COUNT(*)::float AS denominator
         FROM sessions s LEFT JOIN per_session p ON p.sid = s.sid
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Semantic stasis — judge-INDEPENDENT, and the reason it exists: the judge
   * label under-detects badly. Of 30 sessions showing lexical stasis the judge
   * flagged 14, a 53% miss rate, because the common failure is the client
   * agreeing in different words rather than repeating a line verbatim.
   *
   * A pair of consecutive AI turns is "stale" when their content-word sets
   * (tokens longer than `stasisMinWordLength`) overlap by at least
   * `stasisJaccard`. A session counts when it has `stasisMinPairs` such pairs.
   *
   * Requires `stasisMinComparablePairs` comparable pairs, so very short
   * sessions are excluded rather than counted clean.
   *
   * Runs over raw messages, so it carries history back to Oct 2025 — further
   * than either judge.
   */
  async semanticStasisTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const P = WEAK_METRICS_PARAMS;
    const params: unknown[] = [
      f.start,
      P.stasisMinWordLength,
      P.stasisJaccard,
      P.stasisMinPairs,
      P.stasisMinComparablePairs,
    ];
    const sessionFilter = this.sessionScopedFilter(
      'm."scenarioSessionId"',
      f,
      params,
    );

    return this.dataSource.query(
      `WITH ai AS (
         SELECT m."scenarioSessionId" AS sid,
                m."createdAt" AS ts,
                ROW_NUMBER() OVER (
                  PARTITION BY m."scenarioSessionId" ORDER BY m."createdAt", m.id
                ) AS rn,
                ARRAY(
                  SELECT DISTINCT w FROM unnest(
                    regexp_split_to_array(
                      lower(regexp_replace(m.content, '[^[:alnum:][:space:]]', '', 'g')),
                      '\\s+')
                  ) w WHERE length(w) > $2
                ) AS ws
           FROM scenario_session_messages m
          WHERE m."senderId" = -1
            AND m."createdAt" >= $1
            AND length(btrim(m.content)) > 40
            AND ${excludeTestTenantsBySession('m."scenarioSessionId"')}
            ${sessionFilter}
       ), paired AS (
         SELECT a.sid, a.ts, a.ws,
                LEAD(a.ws) OVER (PARTITION BY a.sid ORDER BY a.rn) AS next_ws
           FROM ai a
       ), sim AS (
         SELECT sid, ts,
                CASE WHEN array_length(ws, 1) > 2 AND array_length(next_ws, 1) > 2
                  THEN (SELECT COUNT(*) FROM unnest(ws) x WHERE x = ANY(next_ws))::numeric
                       / GREATEST(array_length(ws, 1), array_length(next_ws, 1))
                  ELSE NULL END AS jaccard
           FROM paired
       ), per_session AS (
         SELECT sid,
                MIN(ts) AS ts,
                COUNT(*) FILTER (WHERE jaccard >= $3) AS stale_pairs,
                COUNT(*) FILTER (WHERE jaccard IS NOT NULL) AS comparable_pairs
           FROM sim GROUP BY sid
       )
       SELECT to_char(date_trunc('${f.bucket}', ts), 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE stale_pairs >= $4)::float AS numerator,
              COUNT(*)::float AS denominator
         FROM per_session
        WHERE comparable_pairs >= $5
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Resolution outcome mix.
   *
   * Until a terminal-state event exists this can only report what IS recorded:
   * whether any auto-termination event fired. That machinery is effectively
   * dormant (6-24 firings a month platform-wide against tens of thousands of
   * session events), so a near-zero series here is a true reading of an unbuilt
   * capability, not a measurement failure. The tab labels it as such.
   */
  async resolutionTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [f.start];
    let where = `ss."startedAt" >= $1
      AND ${excludeTestTenants('ss."tenant_id"')}`;
    if (f.scenarioId) {
      params.push(f.scenarioId);
      where += ` AND ss."scenarioId" = $${params.length}`;
    }
    if (f.scenarioVersionId) {
      params.push(f.scenarioVersionId);
      where += ` AND ss."scenarioVersionId" = $${params.length}::uuid`;
    }
    if (f.promptVersion) {
      params.push(f.promptVersion);
      where += ` AND ${mainPromptVersionSql('ss')} = $${params.length}`;
    }
    // Language and model were missing entirely: this query filtered scenario,
    // scenario version and prompt version straight off the session row and
    // silently ignored the other two, so picking Hindi left it showing
    // platform-wide numbers. A filter that does nothing is worse than one that
    // empties the chart — nothing on screen says the selection was dropped.
    //
    // Scenario/version/prompt stay on the session row above (more accurate than
    // reaching through turn metrics, which would drop a session that has none);
    // the helper supplies only the two that were absent.
    where += this.sessionScopedFilter(
      'ss.id',
      { ...f, scenarioId: null, scenarioVersionId: null, promptVersion: null },
      params,
    );
    return this.dataSource.query(
      `SELECT to_char(date_trunc('${f.bucket}', ss."startedAt"), 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM scenario_session_events e
                 WHERE e."scenarioSessionId" = ss.id
                   AND e."autoTerminationStatus" = true))::float AS numerator,
              COUNT(*)::float AS denominator
         FROM scenario_sessions ss
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Turns the actor rendered with NO target-script content — a Hindi session
   * answered in English, or in romanised Hindi.
   *
   * Judge-INDEPENDENT and deterministic, which is the point: it covers every
   * session ever recorded the moment it ships, needs no backfill, and costs
   * nothing to recompute if the rule changes.
   *
   * It exists because two mechanisms that should have caught this did not.
   * Script fidelity tolerates Latin by design so code-switching is not punished,
   * so a 100% English turn scores a perfect 1.0 — hi-IN read 99.3% over a
   * corpus containing whole English turns. The `codeswitch` judge dimension
   * fired once in 429 hi-IN turns.
   *
   * Only turns with enough letters to have MADE a language choice are counted,
   * and only a total absence of the target script counts as a failure: heavy
   * code-mixing is how people actually speak and a proportional threshold would
   * flag it.
   */
  async offLanguageTurnTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [f.start];
    const sessionFilter = this.sessionScopedFilter(
      'm."scenarioSessionId"',
      f,
      params,
    );
    const lang = `COALESCE(l.value, 'en')`;
    return this.dataSource.query(
      `SELECT to_char(date_trunc('${f.bucket}', m."createdAt"), 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE ${offLanguageSql('m.content', lang)})::float AS numerator,
              COUNT(*)::float AS denominator
         FROM scenario_session_messages m
         JOIN scenario_sessions s ON s.id = m."scenarioSessionId"
         LEFT JOIN languages l ON l.id = NULLIF(s.metadata->>'languageId', '')::int
        WHERE m."senderId" = -1
          AND m."createdAt" >= $1
          AND ${excludeTestTenantsBySession('m."scenarioSessionId"')}
          AND ${languageCheckEligibleSql('m.content', lang)}
          ${sessionFilter}
        GROUP BY 1 HAVING COUNT(*) > 0
        ORDER BY 1`,
      params,
    );
  }

  // =========================================================================
  // 3. LANGUAGE REALISM
  // =========================================================================

  /**
   * Severity-weighted error rate per 100 AI turns for the realism dimensions.
   * `register` = literary where spoken was required; `colloquialness` =
   * translationese; `dialect_lexicon` = wrong or odd word meanings.
   *
   * `dialect_lexicon` currently fires on almost nothing while two partner orgs
   * name it as their blocking issue — the tab surfaces its annotation COUNT
   * next to the rate so a near-zero line reads as under-detection rather than
   * as a solved problem.
   */
  async realismWeightedTrend(
    f: WeakMetricsFilters,
    dimension: 'register' | 'colloquialness' | 'dialect_lexicon',
  ): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const annWhere = this.judgmentWhere('a', f, params);
    params.push(dimension);
    const dimParam = `$${params.length}`;
    // dialect_lexicon asks whether a word carries the right MEANING in the
    // configured regional variety. English has no such variety to get wrong, so
    // en-IN turns can only ever contribute to the denominator — and they are two
    // thirds of the corpus. Dividing by them made a working detector read as
    // broken: near-zero globally, while it fires at 2.06 and 2.36 per 100 turns
    // for Tamil and Kannada, the languages our partners actually use.
    const nonLatinOnly =
      dimension === 'dialect_lexicon'
        ? ` AND lower(split_part(COALESCE(%ALIAS%."language", 'en'), '-', 1)) IN (${NON_LATIN_SCRIPT_LANGS.map(
            (l) => `'${l}'`,
          ).join(',')})`
        : '';
    const denParams: unknown[] = [];
    const shiftedSessWhere = this.shiftPlaceholders(
      this.judgmentWhere('s', f, denParams),
      params.length,
    );

    return this.dataSource.query(
      `WITH num AS (
         SELECT ${this.bucketExpr('a', f)} AS bucket,
                SUM(${SEVERITY_WEIGHT_SQL}) AS weighted,
                COUNT(*) AS annotations
           FROM language_error_annotations a
          WHERE ${annWhere} AND a."dimension" = ${dimParam}
                ${nonLatinOnly.replace('%ALIAS%', 'a')}
          GROUP BY 1
       ), den AS (
         SELECT ${this.bucketExpr('s', f)} AS bucket,
                SUM(s."turnsJudged") AS turns
           FROM language_judgment_sessions s
          WHERE ${shiftedSessWhere}
                ${nonLatinOnly.replace('%ALIAS%', 's')}
          GROUP BY 1
       )
       SELECT to_char(den.bucket, 'YYYY-MM-DD') AS bucket,
              COALESCE(num.weighted, 0)::float AS numerator,
              den.turns::float AS denominator,
              COALESCE(num.annotations, 0)::float AS annotations
         FROM den LEFT JOIN num ON num.bucket = den.bucket
        WHERE den.turns > 0
        ORDER BY den.bucket`,
      [...params, ...denParams],
    );
  }

  /**
   * Brief-override share: of the annotations in a dimension, how many carry
   * `isolationBasis = 'persona_specified'` — i.e. the brief explicitly asked
   * for that register and the model overrode it anyway.
   *
   * This is what separates "the persona genuinely is formal" from "we are not
   * following instructions", and it is why the metric is scored against the
   * brief rather than absolutely.
   */
  async briefOverrideBreakdown(f: WeakMetricsFilters): Promise<BreakdownRow[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('a', f, params);
    return this.dataSource.query(
      `SELECT a."dimension" AS key,
              COUNT(*) FILTER (WHERE a."isolationBasis" = 'persona_specified')::float AS numerator,
              COUNT(*)::float AS denominator
         FROM language_error_annotations a
        WHERE ${where}
          AND a."dimension" IN ('register', 'colloquialness', 'dialect_lexicon')
        GROUP BY 1 ORDER BY 3 DESC`,
      params,
    );
  }

  // =========================================================================
  // 4. FEEDBACK GROUNDEDNESS
  // =========================================================================

  /**
   * Fabricated citations: feedback claims whose quote is not actually in the
   * transcript, over claims that quote at all.
   *
   * This REPLACES the quote-match scrape, which regex-extracted double-quoted
   * spans from feedback prose and could therefore see about 2.5% of quoting
   * feedback — single quotes are unparseable because the apostrophe in
   * "client's" opens a span. Its own caveat said the fix was upstream: have the
   * check run where the claim and the transcript are both structured. That is
   * what the groundedness judge does, on every claim rather than a sample.
   *
   * Denominator is claims that CARRY a quote, not all claims: a claim making no
   * citation cannot fabricate one, and counting it would dilute the rate with
   * cases the metric has nothing to say about.
   */
  async fabricatedQuoteTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('c', f, params, {
      promptVersionVia: 'session',
    });
    return this.dataSource.query(
      `SELECT to_char(${this.bucketExpr('c', f)}, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE c."quoteIsAccurate" IS FALSE)::float AS numerator,
              COUNT(*)::float AS denominator
         FROM feedback_claim_judgment c
        WHERE ${where} AND c."quotesTranscript" IS TRUE
        GROUP BY 1 HAVING COUNT(*) > 0
        ORDER BY 1`,
      params,
    );
  }

  /**
   * Feedback groundedness — the share of feedback claims the transcript does
   * not bear out. This is the definitive line for metric 4; quote-match was
   * only ever a fabricated-citation sample.
   *
   * Numerator counts `unsupported`, `contradicted` and `misattributed`
   * together; denominator is every judged claim.
   */
  async groundednessTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    // feedback_claim_judgment has no promptVersion column — routed via session.
    const where = this.judgmentWhere('c', f, params, {
      promptVersionVia: 'session',
    });
    return this.dataSource.query(
      `SELECT to_char(${this.bucketExpr('c', f)}, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (
                WHERE c."verdict" <> 'supported'
              )::float AS numerator,
              COUNT(*)::float AS denominator
         FROM feedback_claim_judgment c
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * The harmful half, isolated: `improvement` claims the transcript
   * CONTRADICTS — the learner marked down for work they visibly did.
   *
   * Separated from the rate above because the two are different product
   * problems and only this one matches what counsellors described. An unearned
   * compliment is a calibration issue; being told you failed at something you
   * did is what left one of them doubting whether she was a good therapist.
   */
  async falseNegativeFeedbackTrend(
    f: WeakMetricsFilters,
  ): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    // feedback_claim_judgment has no promptVersion column — routed via session.
    const where = this.judgmentWhere('c', f, params, {
      promptVersionVia: 'session',
    });
    return this.dataSource.query(
      `SELECT to_char(${this.bucketExpr('c', f)}, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE c."verdict" = 'contradicted')::float AS numerator,
              COUNT(*)::float AS denominator
         FROM feedback_claim_judgment c
        WHERE ${where} AND c."claimKind" = 'improvement'
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Criticism-to-praise balance: improvements per positive, per bucket.
   *
   * Returned as a numerator/denominator pair like every other series so the
   * caller divides consistently — here the ratio is the point rather than a
   * percentage, and the tab renders it as "x criticisms per compliment".
   */
  async feedbackToneTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [f.start];
    const sessionFilter = this.sessionScopedFilter(
      'd."scenarioSessionId"',
      f,
      params,
    );
    return this.dataSource.query(
      `SELECT to_char(date_trunc('${f.bucket}', d."createdAt"), 'YYYY-MM-DD') AS bucket,
              SUM(jsonb_array_length(d.summary->'feedback'->'improvements'))::float AS numerator,
              SUM(jsonb_array_length(d.summary->'feedback'->'positives'))::float AS denominator
         FROM scenario_session_details d
        WHERE d."createdAt" >= $1
          AND d.summary->'feedback' ? 'positives'
          AND d.summary->'feedback' ? 'improvements'
          AND ${excludeTestTenants('d."tenant_id"')}
          ${sessionFilter}
        GROUP BY 1 HAVING SUM(jsonb_array_length(d.summary->'feedback'->'positives')) > 0
        ORDER BY 1`,
      params,
    );
  }

  /**
   * Sessions that were scored despite the transcript showing a stuck loop.
   *
   * This is the interaction two interviewees described as the worst thing the
   * product did to them: the actor looped, the learner was then marked down
   * across the board for it, and one of them described being left doubting
   * whether she was a good therapist. Gating scoring on session health is the
   * fix; this series is how we watch it land.
   */
  async unhealthyScoredTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    params.push(WEAK_METRICS_PARAMS.loopRunLength);
    const runLen = `$${params.length}`;
    return this.dataSource.query(
      `WITH turns AS (
         SELECT j."scenarioSessionId" AS sid, j."turnIndex" AS ti,
                (j."aiReplyFailureMode" = 'repetition') AS rep,
                ${this.bucketExpr('j', f)} AS bucket
           FROM turn_drift_judgment j
          WHERE ${where}
       ), islands AS (
         SELECT sid, bucket, rep, ti,
                ti - ROW_NUMBER() OVER (PARTITION BY sid, rep ORDER BY ti) AS grp
           FROM turns
       ), looped AS (
         SELECT sid FROM islands WHERE rep
          GROUP BY sid, grp HAVING COUNT(*) >= ${runLen}
       ), sessions AS (
         SELECT sid, MIN(bucket) AS bucket FROM turns GROUP BY sid
       )
       SELECT to_char(s.bucket, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (
                WHERE l.sid IS NOT NULL AND d."scenarioSessionId" IS NOT NULL
              )::float AS numerator,
              COUNT(*) FILTER (WHERE d."scenarioSessionId" IS NOT NULL)::float AS denominator
         FROM sessions s
         LEFT JOIN looped l ON l.sid = s.sid
         LEFT JOIN scenario_session_details d
           ON d."scenarioSessionId" = s.sid
          AND d.summary->'feedback' ? 'skillCoverage'
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Score-vs-length: the discrimination check, returned as raw pairs so the
   * service can compute the correlation rather than the database doing it in a
   * way nobody can inspect.
   */
  async scoreVsLengthPairs(
    f: WeakMetricsFilters,
  ): Promise<Array<{ score: number; turns: number }>> {
    const params: unknown[] = [f.start];
    const sessionFilter = this.sessionScopedFilter(
      'd."scenarioSessionId"',
      f,
      params,
    );
    return this.dataSource.query(
      `WITH sc AS (
         SELECT d."scenarioSessionId" AS sid,
                AVG((e->>'percentage')::numeric) AS score
           FROM scenario_session_details d
          CROSS JOIN LATERAL jsonb_array_elements(
            d.summary->'feedback'->'skillCoverage') e
          WHERE d."createdAt" >= $1
            AND d.summary->'feedback' ? 'skillCoverage'
            AND ${excludeTestTenants('d."tenant_id"')}
            ${sessionFilter}
          GROUP BY 1
       ), len AS (
         SELECT m."scenarioSessionId" AS sid, COUNT(*) AS turns
           FROM scenario_session_messages m GROUP BY 1
       )
       SELECT sc.score::float AS score, len.turns::float AS turns
         FROM sc JOIN len ON len.sid = sc.sid
        WHERE len.turns > 0`,
      params,
    );
  }

  // =========================================================================
  // 5. ACTOR CLIENTHOOD
  // =========================================================================

  /**
   * Share of judged AI turns where the actor stopped being a client.
   *
   * `role_slip` is the label available today and it is deliberately broad — it
   * also absorbs "too formal", "took the initiative to close" and pronoun
   * errors, and only about one in six of its turns is verified role inversion.
   * A dedicated `role_inversion` label is the fix; until it exists the tab
   * captions this as an over-broad proxy rather than presenting it as the
   * metric.
   */
  async roleSlipTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    return this.dataSource.query(
      `SELECT to_char(${this.bucketExpr('j', f)}, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE j."aiReplyFailureMode" = 'role_slip')::float AS numerator,
              COUNT(*)::float AS denominator
         FROM turn_drift_judgment j
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Role inversion, measured directly — the actor taking the counsellor's
   * chair (asking about the counsellor, or advising them).
   *
   * This is the v2 judge label, and it replaces `role_slip` as the headline
   * for clienthood. `role_slip` was always an over-broad stand-in: it also
   * absorbs "too formal", "took the initiative to close" and pronoun errors,
   * and only about one turn in six of it is verified inversion.
   *
   * The denominator counts only turns that CARRY the label, so a window that
   * still holds v1 rows reports the v2 share of itself rather than diluting
   * against unjudged turns. Combined with the judge pin, v1 and v2 never mix.
   */
  async roleInversionTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    return this.dataSource.query(
      `SELECT to_char(${this.bucketExpr('j', f)}, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE j."roleInversion" IS TRUE)::float AS numerator,
              COUNT(*) FILTER (WHERE j."roleInversion" IS NOT NULL)::float AS denominator
         FROM turn_drift_judgment j
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Over-compliance — the actor solving its own problem instead of being a
   * client, which is the half of clienthood that had no measurement at all.
   *
   * Deliberately a SESSION rate over a threshold rather than a turn rate: the
   * complaint was quantitative ("a real patient offers at most one or two
   * solutions; the AI offers four to five"), so the metric counts sessions
   * whose total exceeds `solutionOfferThreshold`. The judge only ever counts;
   * the threshold is a product decision applied here, and changing it re-reads
   * history rather than re-judging it.
   *
   * Scoped to sessions the brief marks as resistant when that label is
   * present — a persona written to be cooperative offering ideas is not a
   * failure, and scoring it as one would punish correct portrayal.
   */
  async overComplianceTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    params.push(WEAK_METRICS_PARAMS.solutionOfferThreshold);
    const threshold = `$${params.length}`;
    return this.dataSource.query(
      `WITH per_session AS (
         SELECT j."scenarioSessionId" AS sid,
                MIN(${this.bucketExpr('j', f)}) AS bucket,
                SUM(COALESCE(j."solutionsOffered", 0)) AS solutions,
                COUNT(*) FILTER (WHERE j."solutionsOffered" IS NOT NULL) AS labelled,
                bool_or(j."resistanceBriefed" IS TRUE) AS resistant
           FROM turn_drift_judgment j
          WHERE ${where}
          GROUP BY 1
       )
       SELECT to_char(bucket, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (WHERE solutions > ${threshold})::float AS numerator,
              COUNT(*)::float AS denominator
         FROM per_session
        WHERE labelled > 0 AND resistant
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Turns that failed to advance the conversation, EXCLUDING the ones where
   * standing still was the right portrayal.
   *
   * This is the appropriate-stuckness exclusion made real. `stuckIsAppropriate`
   * is true when the client correctly refused to yield to a weak or premature
   * intervention; counting those as failures would drive the actor toward
   * agreeableness and make clienthood worse — the exact tension that made this
   * metric dangerous to optimise before the label existed.
   */
  async inappropriateStasisTrend(f: WeakMetricsFilters): Promise<TrendPoint[]> {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    return this.dataSource.query(
      `SELECT to_char(${this.bucketExpr('j', f)}, 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (
                WHERE j."introducedNewInformation" IS FALSE
                  AND j."stuckIsAppropriate" IS FALSE
              )::float AS numerator,
              COUNT(*) FILTER (WHERE j."introducedNewInformation" IS NOT NULL)::float
                AS denominator
         FROM turn_drift_judgment j
        WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Counsellor-directed question rate — a deterministic proxy for role
   * inversion that needs no judge and therefore reaches back as far as the
   * transcripts do.
   *
   * Matches AI turns that ask a question AND address the counsellor in the
   * second person. It WILL over-count (a client legitimately asks "what should
   * I do?"), which is exactly why it ships beside the judge label rather than
   * instead of it — the two disagreeing is the signal to fix the proxy.
   *
   * English-only patterns for now, so read it as an en-IN measure.
   */
  async counsellorDirectedQuestionTrend(
    f: WeakMetricsFilters,
  ): Promise<TrendPoint[]> {
    const params: unknown[] = [f.start];
    let sessionFilter = '';
    const dims: Array<[string, unknown]> = [
      ['language', f.language],
      ['llmModel', f.llmModel],
      ['scenarioId', f.scenarioId],
    ];
    for (const [column, value] of dims) {
      if (value !== null && value !== undefined && value !== '') {
        params.push(value);
        sessionFilter += ` AND EXISTS (SELECT 1 FROM scenario_session_turn_metrics tm
           WHERE tm."scenarioSessionId" = m."scenarioSessionId"
             AND tm."${column}" = $${params.length})`;
      }
    }
    return this.dataSource.query(
      `SELECT to_char(date_trunc('${f.bucket}', m."createdAt"), 'YYYY-MM-DD') AS bucket,
              COUNT(*) FILTER (
                WHERE m.content LIKE '%?%'
                  AND m.content ~* '\\y(you|your|yourself)\\y'
              )::float AS numerator,
              COUNT(*)::float AS denominator
         FROM scenario_session_messages m
        WHERE m."senderId" = -1
          AND m."createdAt" >= $1
          AND ${excludeTestTenantsBySession('m."scenarioSessionId"')}
          ${sessionFilter}
        GROUP BY 1 ORDER BY 1`,
      params,
    );
  }

  /**
   * Per-scenario role-slip concentration — the most actionable cut on this
   * page.
   *
   * role_slip is concentrated, not diffuse: a small number of scenarios carry a
   * quarter of every slip, and an English scenario sits among the worst, which
   * is why the aggregate language gradient is a composition artefact rather
   * than a language problem. The unit of action is the scenario brief.
   */
  async roleSlipByScenario(
    f: WeakMetricsFilters,
    minTurns = 40,
  ): Promise<
    Array<
      BreakdownRow & {
        scenarioId: number;
        title: string | null;
        language: string | null;
        sessions: number;
      }
    >
  > {
    const params: unknown[] = [];
    const where = this.judgmentWhere('j', f, params);
    params.push(minTurns);
    return this.dataSource.query(
      `SELECT j."scenarioId"::text AS key,
              j."scenarioId" AS "scenarioId",
              MAX(s.title) AS title,
              j."language" AS language,
              COUNT(DISTINCT j."scenarioSessionId")::float AS sessions,
              COUNT(*) FILTER (WHERE j."aiReplyFailureMode" = 'role_slip')::float AS numerator,
              COUNT(*)::float AS denominator
         FROM turn_drift_judgment j
         LEFT JOIN scenarios s ON s.id = j."scenarioId"
        WHERE ${where} AND j."scenarioId" IS NOT NULL
        GROUP BY j."scenarioId", j."language"
       HAVING COUNT(*) >= $${params.length}
        ORDER BY (COUNT(*) FILTER (WHERE j."aiReplyFailureMode" = 'role_slip'))::numeric
                 / NULLIF(COUNT(*), 0) DESC
        LIMIT 25`,
      params,
    );
  }

  // =========================================================================
  // Slice option lists for the filter bar
  // =========================================================================

  async filterOptions(start: Date): Promise<{
    languages: string[];
    models: string[];
    scenarios: Array<{ id: number; title: string | null }>;
    promptVersions: string[];
  }> {
    const [languages, models, scenarios, promptVersions] = await Promise.all([
      this.dataSource.query(
        `SELECT DISTINCT j."language" AS v FROM turn_drift_judgment j
          WHERE j."language" IS NOT NULL
            AND COALESCE(j."occurredAt", j."createdAt") >= $1
          ORDER BY 1`,
        [start],
      ),
      this.dataSource.query(
        `SELECT DISTINCT j."llmModel" AS v FROM turn_drift_judgment j
          WHERE j."llmModel" IS NOT NULL
            AND COALESCE(j."occurredAt", j."createdAt") >= $1
          ORDER BY 1`,
        [start],
      ),
      this.dataSource.query(
        `SELECT DISTINCT j."scenarioId" AS id, s.title AS title
           FROM turn_drift_judgment j
           LEFT JOIN scenarios s ON s.id = j."scenarioId"
          WHERE j."scenarioId" IS NOT NULL
            AND COALESCE(j."occurredAt", j."createdAt") >= $1
          ORDER BY 2 NULLS LAST`,
        [start],
      ),
      // Offered from the judged corpus, not from every session that ever ran:
      // a version with no judgments behind it would select an empty tab and
      // read as "this prompt fixed everything".
      this.dataSource.query(
        `SELECT DISTINCT j."promptVersion" AS v FROM turn_drift_judgment j
          WHERE j."promptVersion" IS NOT NULL
            AND COALESCE(j."occurredAt", j."createdAt") >= $1
          ORDER BY 1`,
        [start],
      ),
    ]);
    return {
      languages: languages.map((r: { v: string }) => r.v),
      models: models.map((r: { v: string }) => r.v),
      promptVersions: promptVersions.map((r: { v: string }) => r.v),
      scenarios,
    };
  }
}
